"""Subagent nền cho lĩnh vực `property` và `map`, bọc MCP tool đọc của service Location (nhánh `QuangDung`).

Chủ service có thể thay bằng subagent riêng (manifest + `run_task`) mà không sửa graph (D13). Bản nền
này tất định, không LLM: `search_housing` chỉ lọc nên subagent tự xếp hạng; tìm gần địa danh thì
`resolve_location` trước rồi mới tìm theo toạ độ.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime
from typing import Any

from src.agents.common import utcnow
from src.agents.contracts import AgentTaskRequest, AgentTaskResult, reject_unsupported
from src.agents.models import AgentName, AgentUsage, Question, Quote
from src.agents.subagents.capabilities import BASELINE_CAPABILITIES
from src.agents.subagents.services.common import BudgetExceededError, CountingClient, first, tool_failure
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
ADDRESS_ORDER = ("house_number", "street", "ward", "district", "city", "province")


def format_address(address: dict[str, Any] | None) -> str | None:
    if not address:
        return None
    parts = [str(address[k]) for k in ADDRESS_ORDER if address.get(k)]
    if not parts:
        parts = [str(v) for v in address.values() if isinstance(v, str) and v]
    return ", ".join(dict.fromkeys(parts)) or None


def city_of(address: dict[str, Any] | None) -> str | None:
    if not address:
        return None
    return next((str(address[k]) for k in ("city", "province") if address.get(k)), None)


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
    amenities = {a.lower() for a in r.get("amenities") or []}
    location = r.get("location") or {}
    candidate = {
        "id": r["listing_id"],
        "title": r.get("title") or "Tin nhà",
        "price_vnd": int(price["amount"]) if monthly_vnd and price.get("amount") is not None else None,
        "deposit_vnd": None,  # service chưa có trường tiền cọc: không suy đoán
        "area_m2": (r.get("area") or {}).get("value"),
        "address": format_address(r.get("address")),
        "city": city_of(r.get("address")),
        "lat": location.get("lat"),
        "lng": location.get("lng"),
        "wifi": True if ("wifi" in amenities or "wi-fi" in amenities) else None,
    }
    missing = [k for k in ("price_vnd", "deposit_vnd", "area_m2", "address") if candidate[k] is None]
    missing += [m for m in must_have if m.lower() not in amenities]
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

    async def _resolve(self, tools: CountingClient, text: str) -> dict | None:
        resolved = await tools.call("resolve_location", {"text": text, "limit": 3})
        return first((resolved or {}).get("results"))

    async def _property(self, req: AgentTaskRequest, tools: CountingClient) -> AgentTaskResult:
        inp = req.inputs
        limit = int(inp.get("limit") or 5)
        soft = inp.get("soft_filters") or {}
        area: dict[str, Any] = {}
        area_name = None
        if inp.get("near"):
            place = await self._resolve(tools, inp["near"])
            if place is None:
                return self._not_found(req, tools, "near", inp["near"])
            area = {"center": place["location"], "radius_m": DEFAULT_RADIUS_M}
            area_name = (place.get("parent") or {}).get("name") or place.get("name")
        elif inp.get("city"):
            found = first((await tools.call("search_areas", {"text": inp["city"], "limit": 1}) or {}).get("results"))
            if found is None:
                return self._not_found(req, tools, "city", inp["city"])
            area = {"administrative_area_ids": [found["area_id"]]}
            area_name = found.get("name")

        def request(filters: dict[str, Any]) -> dict[str, Any]:
            body: dict[str, Any] = {"listing_type": "rent", "pagination": {"limit": min(25, limit * 3)}, **area}
            if filters.get("max_price_vnd"):
                body["max_price"] = {"amount": filters["max_price_vnd"], "currency": "VND", "period": "month"}
            room = ROOM_TYPES.get(str(filters.get("room_type", "")).lower())
            if room:
                body["property_type"] = room
            if filters.get("must_have"):
                body["amenities"] = list(filters["must_have"])
            return body

        hard = {k: inp[k] for k in ("max_price_vnd", "room_type", "must_have") if inp.get(k)}
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
        data = {"area_name": area_name, "candidates": candidates, "excluded_without_price_or_address": excluded}
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
        radius = int(inp.get("radius_m") or 1500)
        constraints = [{"category": c, "max_distance_m": radius} for c in inp["categories"]]
        origins: dict[str, dict] = {}
        if inp.get("near"):
            place = await self._resolve(tools, inp["near"])
            if place is None:
                return self._not_found(req, tools, "near", inp["near"])
            origins[place.get("name") or inp["near"]] = place["location"]
        else:
            wanted = set(inp.get("listing_ids") or [])
            for upstream in req.upstream.values():
                for c in upstream.data.get("candidates", []):
                    if (not wanted or c.get("id") in wanted) and c.get("lat") is not None and c.get("lng") is not None:
                        origins[c["id"]] = {"lat": c["lat"], "lng": c["lng"]}
            origins = dict(list(origins.items())[:3])
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
        return self._result(
            req, tools, status="done", data={"nearby": nearby}, missing_fields=missing, source_refs=refs
        )
