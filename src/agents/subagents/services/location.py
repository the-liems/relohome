"""Subagent nền cho lĩnh vực `property` và `map`, bọc MCP tool đọc của service Location (nhánh `QuangDung`).

Service Location chỉ cung cấp tool và dữ liệu; việc chọn tool, chọn ứng viên, xếp hạng và hỏi lại thuộc
subagent (do nhóm AI phát triển, 2026-09-29). Bản này tất định, không LLM: `search_housing` chỉ lọc nên
subagent tự xếp hạng; tên khu vực / địa danh mơ hồ thì hỏi lại thay vì lấy kết quả đầu.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime
from typing import Any

from src.agents.common import utcnow
from src.agents.contracts import AgentTaskRequest, AgentTaskResult, reject_unsupported
from src.agents.housing_constraints import HOUSING_INPUT_KEYS, HOUSING_NUMERIC_FILTERS
from src.agents.models import AgentName, AgentUsage, Question, Quote
from src.agents.subagents.capabilities import BASELINE_CAPABILITIES
from src.agents.subagents.services.common import BudgetExceededError, CountingClient, tool_failure
from src.services.adapters.mcp import McpToolClient, ToolCallError

SOURCE = "lifeflow-location"
DEFAULT_RADIUS_M = 3000
ROOM_TYPES = {
    "phòng": "room",
    "phòng trọ": "room",
    "room": "room",
    "studio": "studio",
    "căn hộ": "apartment",
    "chung cư": "apartment",
    "apartment": "apartment",
    "nhà": "house",
    "nhà nguyên căn": "house",
    "house": "house",
    "căn hộ dịch vụ": "serviced_apartment",
    "homestay": "homestay",
}
# Khoá `address_normalized` của importer housing (Location); `raw` là chuỗi địa chỉ gốc của nguồn.
ADDRESS_ORDER = ("housenumber", "street", "ward", "district", "city")
CLEAR_MARGIN = 0.15  # chênh match_score tối thiểu để coi ứng viên đầu là rõ ràng


def format_address(address: dict[str, Any] | None) -> str | None:
    if not address:
        return None
    raw = address.get("raw")
    if isinstance(raw, str) and raw.strip():
        return raw.strip()
    parts = [str(address[k]) for k in ADDRESS_ORDER if address.get(k)]
    return ", ".join(dict.fromkeys(parts)) or None


def city_of(address: dict[str, Any] | None) -> str | None:
    return str(address["city"]) if address and address.get("city") else None


def label_of(item: dict) -> str:
    parent = (item.get("parent") or {}).get("name")
    return f"{item.get('name')} ({parent})" if parent else str(item.get("name"))


def pick_clear(results: list[dict]) -> dict | None:
    """Chọn ứng viên khi rõ ràng: chỉ một kết quả, đúng một kết quả khớp chính xác, hoặc điểm đầu vượt
    hẳn điểm thứ hai. Không thì trả None để hỏi lại (Location không tự chọn thay graph)."""
    # Snapshot may contain both an OSM administrative relation and a local copy
    # of the same boundary. Collapse only when name AND exact bbox agree.
    unique: list[dict] = []
    seen = set()
    for item in results:
        bbox = item.get("bounding_box")
        if bbox and item.get("area_id"):
            key = (item.get("name"), tuple(sorted(bbox.items())))
            if key in seen:
                continue
            seen.add(key)
        unique.append(item)
    results = unique
    if not results:
        return None
    if len(results) == 1:
        return results[0]
    exact = [r for r in results if r.get("match_type") == "exact"]
    if len(exact) == 1:
        return exact[0]
    first_score, second_score = (r.get("match_score") or 0 for r in results[:2])
    return results[0] if first_score - second_score >= CLEAR_MARGIN else None


def rank_listings(results: list[dict]) -> list[dict]:
    """Xếp hạng tất định: đã xác minh trước, ít field chưa biết, giá thấp."""

    def key(r: dict):
        verified = (r.get("verification") or {}).get("status") != "unverified"
        price = (r.get("price") or {}).get("amount")
        return (not verified, len(r.get("unknown_fields") or []), price if price is not None else float("inf"))

    return sorted(results, key=key)


def to_candidate(r: dict, must_have: list[str]) -> tuple[dict, list[str]]:
    price = r.get("price") or {}
    monthly_vnd = price.get("currency") == "VND" and price.get("period") == "month"
    amenities = [a for a in r.get("amenities") or [] if isinstance(a, str)]
    location = r.get("location") or {}
    deposit = r.get("deposit") or {}  # null = chưa biết cọc, không phải 0
    candidate = {
        "id": r["listing_id"],
        "title": r.get("title") or "Tin nhà",
        "price_vnd": int(price["amount"]) if monthly_vnd and price.get("amount") is not None else None,
        "deposit_vnd": int(deposit["amount"])
        if deposit.get("currency") == "VND" and deposit.get("amount") is not None
        else None,
        "area_m2": (r.get("area") or {}).get("value"),
        "bedrooms": r.get("bedrooms"),
        "bathrooms": r.get("bathrooms"),
        "address": format_address(r.get("address")),
        "city": city_of(r.get("address")),
        "lat": location.get("lat"),
        "lng": location.get("lng"),
        "location_accuracy": r.get("location_accuracy") or "unknown",
        "location_method": r.get("location_method"),
        "amenities": amenities,
    }
    missing = [k for k in ("price_vnd", "deposit_vnd", "area_m2", "address") if candidate[k] is None]
    missing += [m for m in must_have if m not in amenities]
    return candidate, missing


class LocationSubagent:
    def __init__(self, client: McpToolClient, agent: AgentName, clock: Callable[[], datetime] = utcnow):
        if agent not in (AgentName.PROPERTY, AgentName.MAP):
            raise ValueError("LocationSubagent serves property and map only")
        self.capability = BASELINE_CAPABILITIES[agent]
        self.client, self.clock = client, clock

    async def run(self, req: AgentTaskRequest) -> AgentTaskResult:
        if (rejected := reject_unsupported(req, SOURCE, "live")) is not None:
            return rejected
        tools = CountingClient(self.client, req.budget.max_provider_calls)
        try:
            if req.agent == AgentName.PROPERTY:
                return await self._property(req, tools)
            return await self._map(req, tools)
        except (ToolCallError, BudgetExceededError) as exc:
            return tool_failure(req, exc, SOURCE, "live", tools.calls)

    def _result(self, req: AgentTaskRequest, tools: CountingClient, **kw) -> AgentTaskResult:
        return AgentTaskResult(
            task_id=req.task_id,
            plan_version=req.plan_version,
            source=SOURCE,
            source_kind="live",
            fetched_at=self.clock(),
            usage=AgentUsage(provider_calls=tools.calls),
            **kw,
        )

    async def _resolve(self, tools: CountingClient, text: str) -> tuple[dict | None, list[dict]]:
        """(ứng viên rõ ràng hoặc None, danh sách ứng viên để hỏi lại)."""
        results = ((await tools.call("resolve_location", {"text": text, "limit": 5})) or {}).get("results") or []
        return pick_clear(results), results

    def _choose(
        self, req: AgentTaskRequest, tools: CountingClient, field: str, text: str, options: list[dict]
    ) -> AgentTaskResult:
        if not options:
            return self._not_found(req, tools, field, text)
        labels = list(dict.fromkeys(label_of(o) for o in options))[:5]
        question = Question(field=field, text=f'"{text}" khớp nhiều nơi. Bạn muốn nói tới nơi nào?', options=labels)
        return self._result(req, tools, status="needs_input", questions=[question])

    async def _property(self, req: AgentTaskRequest, tools: CountingClient) -> AgentTaskResult:
        inp = req.inputs
        limit = int(inp.get("limit") or 5)
        soft = inp.get("soft_filters") or {}
        area: dict[str, Any] = {}
        area_name = None
        if inp.get("near") and inp.get("near_coordinate"):
            area = {"center": inp["near_coordinate"], "radius_m": DEFAULT_RADIUS_M}
            area_name = inp["near"]
        elif inp.get("near"):
            place, options = await self._resolve(tools, inp["near"])
            if place is None:
                return self._choose(req, tools, "near", inp["near"], options)
            area = {"center": place["location"], "radius_m": DEFAULT_RADIUS_M}
            area_name = (place.get("parent") or {}).get("name") or place.get("name")
        elif inp.get("city"):
            areas = ((await tools.call("search_areas", {"text": inp["city"], "limit": 5})) or {}).get("results") or []
            found = pick_clear(areas)
            if found is None:
                return self._choose(req, tools, "city", inp["city"], areas)
            area = {"administrative_area_ids": [found["area_id"]]}
            area_name = found.get("name")

        def request(filters: dict[str, Any]) -> dict[str, Any]:
            body: dict[str, Any] = {
                "listing_type": "rent",
                "currency": "VND",
                "price_period": "month",
                "pagination": {"limit": min(25, limit * 3)},
                **area,
            }
            if filters.get("max_price_vnd"):
                body["max_price"] = {"amount": filters["max_price_vnd"], "currency": "VND", "period": "month"}
            if filters.get("min_price_vnd") is not None:
                body["min_price"] = {"amount": filters["min_price_vnd"], "currency": "VND", "period": "month"}
            for key in HOUSING_NUMERIC_FILTERS:
                if filters.get(key) is not None:
                    body[key] = filters[key]
            if filters.get("district"):
                body["district"] = filters["district"]
            room = ROOM_TYPES.get(str(filters.get("room_type", "")).lower())
            if room:
                body["property_type"] = room
            if filters.get("must_have"):
                body["amenities"] = list(filters["must_have"])
            return body

        hard = {k: inp[k] for k in HOUSING_INPUT_KEYS if inp.get(k) is not None}
        response = await tools.call("search_housing", request({**soft, **hard}))
        results = (response or {}).get("results") or []
        relaxed: list[str] = []
        if not results and soft:
            # Bộ lọc tự điền cho 0 kết quả: tìm lại không có chúng; bộ lọc người dùng tự nói thì giữ.
            response = await tools.call("search_housing", request(hard))
            results = (response or {}).get("results") or []
            relaxed = sorted(soft)
        must_have = list(inp.get("must_have") or soft.get("must_have") or [])
        candidates, missing, quotes = [], [], []
        excluded = 0
        for r in rank_listings(results):
            if len(candidates) >= limit:
                break
            candidate, unknown = to_candidate(r, must_have)
            if candidate["price_vnd"] is None or candidate["address"] is None:
                excluded += 1  # không so sánh được nếu thiếu giá thuê tháng / địa chỉ; không tự điền
                continue
            missing += [f"candidates[{len(candidates)}].{k}" for k in unknown]
            candidates.append(candidate)
            quotes.append(
                Quote(
                    option_id=candidate["id"],
                    label=candidate["title"],
                    amount_vnd=candidate["price_vnd"],
                    recurrence="monthly",
                )
            )
        data = {
            "area_name": area_name,
            "candidates": candidates,
            "excluded_without_price_or_address": excluded,
            # Xếp hạng chỉ trong trang đã lấy; còn trang sau thì không nói là tốt nhất toàn bộ dữ liệu.
            "has_more": bool(((response or {}).get("page") or {}).get("next_cursor")),
        }
        if relaxed:
            data["relaxed_filters"] = relaxed
        return self._result(
            req,
            tools,
            status="done",
            data=data,
            quotes=quotes,
            missing_fields=missing,
            source_refs=[c["id"] for c in candidates],
            summary=f"{len(candidates)} tin phù hợp" if candidates else "Chưa có tin phù hợp",
        )

    def _not_found(self, req: AgentTaskRequest, tools: CountingClient, field: str, text: str) -> AgentTaskResult:
        return self._result(
            req,
            tools,
            status="needs_input",
            questions=[
                Question(field=field, text=f'Mình chưa xác định được vị trí "{text}". Bạn nói rõ hơn được không?')
            ],
        )

    async def _map(self, req: AgentTaskRequest, tools: CountingClient) -> AgentTaskResult:
        inp = req.inputs
        if inp.get("map_mode") == "route":
            return await self._route(req, tools)
        radius = int(inp.get("radius_m") or 1500)
        constraints = [{"category": c, "max_distance_m": radius} for c in inp["categories"]]
        origins: dict[str, dict] = {}
        approximate: list[str] = []
        if inp.get("near"):
            place, options = await self._resolve(tools, inp["near"])
            if place is None:
                return self._choose(req, tools, "near", inp["near"], options)
            origins[place.get("name") or inp["near"]] = place["location"]
        else:
            wanted = set(inp.get("listing_ids") or [])
            for upstream in req.upstream.values():
                for c in upstream.data.get("candidates", []):
                    if (not wanted or c.get("id") in wanted) and c.get("lat") is not None and c.get("lng") is not None:
                        origins[c["id"]] = {"lat": c["lat"], "lng": c["lng"]}
                        if c.get("location_accuracy") not in (None, "rooftop"):
                            approximate.append(c["id"])
            origins = dict(list(origins.items())[:3])
            approximate = [a for a in approximate if a in origins]
        nearby: dict[str, list[dict]] = {}
        refs: list[str] = []
        missing: list[str] = []
        for key, origin in origins.items():
            found = await tools.call("find_nearby_places", {"origin": origin, "constraints": constraints})
            items = (found or {}).get("results") or []
            nearby[key] = [
                {
                    "id": p.get("place_id"),
                    "name": p.get("name"),
                    "category": p.get("category"),
                    "distance_m": p.get("distance_meters"),
                }
                for p in items
            ]
            refs += [p["place_id"] for p in items if p.get("place_id")]
            if not items:
                missing.append(f"nearby.{key}")
        data: dict[str, Any] = {"nearby": nearby}
        if approximate:  # vị trí phòng chỉ gần đúng: khoảng cách tới tiện ích cũng chỉ gần đúng
            data["approximate_origins"] = approximate
        return self._result(req, tools, status="done", data=data, missing_fields=missing, source_refs=refs)

    async def _route(self, req: AgentTaskRequest, tools: CountingClient) -> AgentTaskResult:
        inp = req.inputs
        cities = {"hồ chí minh": "hcm", "hà nội": "hanoi", "đà nẵng": "danang"}
        city = next((v for k, v in cities.items() if k in inp["city"].lower()), None)
        if not city:
            return self._result(
                req,
                tools,
                status="needs_input",
                questions=[
                    Question(
                        field="city", text="Routing local hiện có Hồ Chí Minh, Hà Nội và Đà Nẵng. Bạn muốn tra ở đâu?"
                    )
                ],
            )
        areas = (await tools.call("search_areas", {"text": inp["city"], "limit": 5})).get("results") or []
        area = pick_clear(areas)
        if not area or not area.get("bounding_box"):
            return self._choose(req, tools, "city", inp["city"], areas)
        endpoints = {}
        refs = []
        for field in ("route_from", "route_to"):
            options = (
                await tools.call(
                    "resolve_location",
                    {
                        "text": inp[field],
                        "entity_types": ["place"],
                        "bounding_box": area["bounding_box"],
                        "limit": 10,
                    },
                )
            ).get("results") or []
            place = pick_clear(options)
            if place is None or place.get("entity_type") != "place" or not place.get("canonical_id"):
                return self._choose(req, tools, field, inp[field], options)
            endpoints[field] = {"type": "place", "place_id": place["canonical_id"]}
            refs.append(place["canonical_id"])
        result = await tools.call(
            "calculate_route_between_entities",
            {
                "city": city,
                "origin": endpoints["route_from"],
                "destination": endpoints["route_to"],
                "profile": inp.get("route_profile", "motorcycle"),
            },
        )
        return self._result(req, tools, status="done", data={"nearby": {}, "routing": result}, source_refs=refs)
