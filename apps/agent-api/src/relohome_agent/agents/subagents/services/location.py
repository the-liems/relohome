"""Subagent nền cho lĩnh vực `property` và `map`, bọc MCP tool đọc của service Location (nhánh `QuangDung`).

Service Location chỉ cung cấp tool và dữ liệu; việc chọn tool, chọn ứng viên, xếp hạng và hỏi lại thuộc
subagent (do nhóm AI phát triển, 2026-09-29). Bản này tất định, không LLM: `search_housing` chỉ lọc nên
subagent tự xếp hạng; tên khu vực / địa danh mơ hồ thì hỏi lại thay vì lấy kết quả đầu.
"""

from __future__ import annotations

import math
import re
import unicodedata
from collections.abc import Callable
from datetime import datetime
from itertools import combinations
from typing import Any

from jsonschema import Draft202012Validator
from relohome_agent.agents.common import utcnow
from relohome_agent.agents.contracts import AgentTaskRequest, AgentTaskResult, failed_result, reject_unsupported
from relohome_agent.agents.housing_constraints import HOUSING_INPUT_KEYS, HOUSING_NUMERIC_FILTERS
from relohome_agent.agents.location_names import city_search_text
from relohome_agent.agents.models import AgentName, AgentUsage, LocationChoice, Question, Quote
from relohome_agent.agents.subagents.capabilities import BASELINE_CAPABILITIES
from relohome_agent.agents.subagents.services.common import BudgetExceededError, CountingClient, tool_failure
from relohome_agent.services.adapters.mcp import McpToolClient, ToolCallError

SOURCE = "lifeflow-location"
DEFAULT_RADIUS_M = 3000
# Sanity bound for two representations of the SAME OSM object, not a same-name merge rule.
SAME_PLACE_RADIUS_M = 150
# Độ đầy đủ hình học theo loại phần tử OSM của bản ghi nguồn: vùng > đường > điểm.
_GEOMETRY_RANK = {"relation": 3, "area": 3, "way": 2, "node": 1}
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
DEFAULT_NEARBY_RADIUS_M = 1500  # "gần <tiện ích>" without a stated distance; same default as Map nearby
MIN_SUGGESTION_SCORE = 0.8  # fuzzy suggestions require strong similarity, never auto-selection


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
    if item.get("display_name"):
        return str(item["display_name"])
    parent = (item.get("parent") or {}).get("name")
    return f"{item.get('name')} ({parent})" if parent else str(item.get("name"))


def _distinct(results: list[dict]) -> list[dict]:
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
    return unique


def _encloses(outer: dict, inner: dict) -> bool:
    return (
        outer["west"] <= inner["west"]
        and outer["south"] <= inner["south"]
        and outer["east"] >= inner["east"]
        and outer["north"] >= inner["north"]
    )


def pick_city_area(results: list[dict]) -> dict | None:
    """Vùng hành chính cho field `city` (phạm vi tỉnh/thành do người dùng nêu).

    Ngoài các luật của `pick_clear`, dùng cấu trúc dữ liệu Location trả về, không dựa vào tên:
    trong các vùng khớp tên (không fuzzy) ở cấp cao nhất (`parent` rỗng), nếu đúng một vùng có
    ranh giới bao trọn các vùng còn lại thì đó là đơn vị người dùng gọi tên ("Hà Nội" bao
    "Trung tâm Hà Nội"). Không có vùng như vậy thì vẫn hỏi lại."""
    unique = _distinct(results)
    exact = [r for r in unique if r.get("match_type") == "exact"]
    if len(exact) == 1:
        return exact[0]
    named = [r for r in unique if not r.get("parent") and r.get("match_type") != "fuzzy" and r.get("bounding_box")]
    if len(named) == 1:
        return named[0]
    enclosing = [r for r in named if all(_encloses(r["bounding_box"], o["bounding_box"]) for o in named)]
    if len(enclosing) == 1:
        return enclosing[0]
    return pick_clear(unique)


def pick_clear(results: list[dict]) -> dict | None:
    """Chọn ứng viên khi rõ ràng: chỉ một kết quả, đúng một kết quả khớp chính xác, hoặc điểm đầu vượt
    hẳn điểm thứ hai. Không thì trả None để hỏi lại (Location không tự chọn thay graph)."""
    results = _distinct(results)
    if not results:
        return None
    if len(results) == 1:
        return results[0]
    exact = [r for r in results if r.get("match_type") == "exact"]
    if len(exact) == 1:
        return exact[0]
    first_score, second_score = (r.get("match_score") or 0 for r in results[:2])
    return results[0] if first_score - second_score >= CLEAR_MARGIN else None


def normalized_name(value: str) -> str:
    value = unicodedata.normalize("NFD", value.casefold().replace("đ", "d"))
    return " ".join("".join(c for c in value if not unicodedata.combining(c)).split())


def area_search_args(
    text: str, *, city_scope: dict | None = None, bounding_box: dict | None = None, include_geometry: bool = False
) -> dict:
    """Bind a known city ID before the provider applies its candidate limit."""
    arguments: dict[str, Any] = {"text": text, "limit": 5}
    bbox = bounding_box or (city_scope or {}).get("bounding_box")
    if bbox:
        arguments["bounding_box"] = bbox
    if (city_scope or {}).get("area_id"):
        arguments["within_area_id"] = city_scope["area_id"]
    if include_geometry:
        arguments["include_geometry"] = True
    return arguments


def named_areas(results: list[dict], text: str, city_bbox: dict | None = None) -> list[dict]:
    """Never turn a partial name/numeric match or another administrative unit into a polygon.

    Bare names may match the current dataset's unit (e.g. Cầu Giấy → Phường
    Cầu Giấy). An explicit unit remains explicit (Quận 5 ≠ Phường 5).
    City bounds further exclude same-name candidates from another city.
    """

    unit = r"^(?:quan|huyen|phuong|xa|thi tran|thi xa|thanh pho|tinh)\s+"
    query = normalized_name(text)
    spelling = " ".join(unicodedata.normalize("NFC", text).casefold().split())
    explicit_unit = bool(re.match(unit, query))
    matching = []
    for area in results:
        if area.get("match_type") == "fuzzy":
            continue
        name = normalized_name(str(area.get("name") or ""))
        if (name if explicit_unit else re.sub(unit, "", name)) != query:
            continue
        # Accent-free input stays supported. Explicit Vietnamese spelling must not
        # turn Thành into Thạnh (or the reverse) merely because unaccent() agrees.
        if spelling != query:
            candidate = " ".join(unicodedata.normalize("NFC", str(area.get("name") or "")).casefold().split())
            prefix = re.match(unit, name) if not explicit_unit else None
            if prefix:
                candidate = " ".join(candidate.split()[len(prefix.group().split()) :])
            if candidate != spelling and candidate != query:
                continue
        bbox = area.get("bounding_box")
        if city_bbox and bbox and not _encloses(city_bbox, bbox):
            continue
        matching.append(area)
    return _distinct(matching)


def pick_named_area(results: list[dict], text: str, city_bbox: dict | None = None) -> dict | None:
    return pick_clear(named_areas(results, text, city_bbox))


def requested_area_query(req: AgentTaskRequest) -> str | None:
    """Recover an explicit area request mis-extracted as near, never a 'gần X' request.

    This only enables a catalog lookup, not an inferred city, polygon or ID.
    The merged goal preserves scope intent on subsequent price/amenity edits.
    """
    near = req.inputs.get("near")
    if not isinstance(near, str) or any(
        req.inputs.get(key)
        for key in ("district", "search_radius_m", "near_coordinate", "near_place_id", "bounding_box")
    ):
        return None
    query = near.strip()
    city = city_search_text(str(req.inputs.get("city") or ""))
    words = query.split()
    city_words = city.split()
    if city_words and normalized_name(" ".join(words[-len(city_words) :])) == normalized_name(city):
        query = " ".join(words[: -len(city_words)]).rstrip(", ")
    if not query:
        return None
    name = normalized_name(query)
    bare = re.sub(r"^(?:quan|huyen|phuong|xa|thi tran|thi xa)\s+", "", name)
    for text in (req.user_request, req.goal):
        text = normalized_name(text)
        if re.search(r"\bgan\b", text):
            # An explicit latest 'near' instruction wins over a stale scope goal.
            return None
        if re.search(
            r"\b(?:khu vuc|khu do thi|khu dan cu|khu|dia ban|quan|huyen|phuong|xa|o|trong|tai)\s+(?:sang\s+)?"
            + re.escape(bare)
            + r"(?!\w)",
            text,
        ):
            return query
    return None


def _meters(a: dict, b: dict) -> float:
    lat = math.radians((a["lat"] + b["lat"]) / 2)
    dx = math.radians(b["lng"] - a["lng"]) * math.cos(lat)
    dy = math.radians(b["lat"] - a["lat"])
    return 6_371_000 * math.hypot(dx, dy)


def _geometry_rank(item: dict) -> int:
    source_id = str((item.get("source") or {}).get("source_id") or "")
    return _GEOMETRY_RANK.get(source_id.split("/", 1)[0], 0)


def _osm_identity(item: dict) -> str | None:
    source = item.get("source") or {}
    if source.get("type") not in (None, "osm"):
        return None
    match = re.fullmatch(r"(node|way|relation|area)/(\d+)", str(source.get("source_id") or ""))
    if not match:
        return None
    kind, identifier = match[1], int(match[2])
    if kind == "area":
        kind, identifier = ("way" if identifier % 2 == 0 else "relation"), identifier // 2
    return f"{kind}/{identifier}"


def pick_place(results: list[dict], radius_m: float = SAME_PLACE_RADIUS_M) -> dict | None:
    """Điểm đến cho Map route / tiện ích / tìm nhà gần một địa danh.

    Chỉ gộp hai biểu diễn cùng đối tượng OSM và cùng category. Các trạm/cổng gần nhau
    hoặc cùng tên vẫn là địa điểm khác nhau, phải giữ khả năng hỏi lại."""
    unique = _distinct([r for r in results if r.get("match_type") != "fuzzy"])
    exact = [r for r in unique if r.get("match_type") == "exact" and (r.get("location") or {}).get("lat") is not None]
    identities = {_osm_identity(item) for item in exact}
    categories = {item.get("category") for item in exact}
    if (
        len(exact) >= 2
        and len(identities) == 1
        and None not in identities
        and len(categories) == 1
        and all(_meters(a["location"], b["location"]) <= radius_m for a, b in combinations(exact, 2))
    ):
        return max(exact, key=_geometry_rank)
    return pick_clear(unique)


def location_choices(options: list[dict]) -> list[LocationChoice]:
    """Ứng viên có ID và toạ độ thật để client hiện pin; chỉ lấy từ kết quả Location."""
    choices: list[LocationChoice] = []
    for item in _distinct(options)[:5]:
        point = item.get("location") or item.get("center") or {}
        identifier = item.get("canonical_id") or item.get("area_id")
        if not identifier:
            continue
        choices.append(
            LocationChoice(
                id=str(identifier),
                label=label_of(item),
                entity_type=str(item.get("entity_type") or "area"),
                category=item.get("category"),
                lat=point.get("lat"),
                lng=point.get("lng"),
            )
        )
    return choices


def bbox_around(center: dict, radius_m: float) -> dict:
    dlat = radius_m / 111_320
    dlng = radius_m / (111_320 * max(math.cos(math.radians(center["lat"])), 0.01))
    return {
        "west": center["lng"] - dlng,
        "south": center["lat"] - dlat,
        "east": center["lng"] + dlng,
        "north": center["lat"] + dlat,
    }


def bbox_of_points(points: list[dict], min_span_m: float = 400) -> dict | None:
    points = [p for p in points if p.get("lat") is not None and p.get("lng") is not None]
    if not points:
        return None
    lats, lngs = [p["lat"] for p in points], [p["lng"] for p in points]
    center = {"lat": (min(lats) + max(lats)) / 2, "lng": (min(lngs) + max(lngs)) / 2}
    pad = bbox_around(center, min_span_m / 2)
    return {
        "west": min(min(lngs), pad["west"]),
        "south": min(min(lats), pad["south"]),
        "east": max(max(lngs), pad["east"]),
        "north": max(max(lats), pad["north"]),
    }


def union_bbox(a: dict, b: dict | None) -> dict:
    if not b:
        return a
    return {
        "west": min(a["west"], b["west"]),
        "south": min(a["south"], b["south"]),
        "east": max(a["east"], b["east"]),
        "north": max(a["north"], b["north"]),
    }


def rank_listings(results: list[dict]) -> list[dict]:
    """Xếp hạng tất định: đã xác minh trước, ít field chưa biết, giá thấp."""

    def key(r: dict):
        verified = (r.get("verification") or {}).get("status") != "unverified"
        price_flagged = any(str(f).startswith("price_") for f in r.get("quality_flags", []))
        price = (r.get("price") or {}).get("amount")
        return (
            price_flagged,
            not verified,
            len(r.get("unknown_fields") or []),
            price if price is not None else float("inf"),
        )

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
        # Places that satisfied a proximity filter, as Location measured them (straight-line metres).
        "nearby": [
            {"name": n.get("name"), "category": n.get("category"), "distance_m": n.get("distance_meters")}
            for n in r.get("nearby") or []
            if isinstance(n, dict)
        ],
        "price": price,
        "thumbnail_url": r.get("thumbnail_url"),
        "source": r.get("source"),
        "verification": r.get("verification"),
        "unknown_fields": r.get("unknown_fields") or [],
        "quality_flags": r.get("quality_flags") or [],
        "price_unverified": any(str(f).startswith("price_") for f in r.get("quality_flags", [])),
    }
    # Ratings are already calculated by code. Never forward review text or author identities to the Agent.
    management = r.get("management")
    if isinstance(management, dict):
        candidate.update({k: management[k] for k in ("host_rating", "host_review_count") if k in management})
    missing = [k for k in ("price_vnd", "deposit_vnd", "area_m2", "address") if candidate[k] is None]
    missing += [m for m in must_have if m not in amenities]
    return candidate, missing


class LocationSubagent:
    def __init__(self, client: McpToolClient, agent: AgentName, clock: Callable[[], datetime] = utcnow):
        if agent not in (AgentName.PROPERTY, AgentName.MAP):
            raise ValueError("LocationSubagent serves property and map only")
        self.capability = BASELINE_CAPABILITIES[agent]
        self.input_validator = Draft202012Validator(self.capability.input_schema)
        self.client, self.clock = client, clock

    async def run(self, req: AgentTaskRequest) -> AgentTaskResult:
        if (rejected := reject_unsupported(req, SOURCE, "live")) is not None:
            return rejected
        if not self.input_validator.is_valid(req.inputs):
            return failed_result(
                req, "invalid_input", "Location task inputs do not match the capability schema.", False, SOURCE, "live"
            )
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

    async def _resolve(
        self, tools: CountingClient, text: str, bounding_box: dict | None = None
    ) -> tuple[dict | None, list[dict]]:
        """(ứng viên rõ ràng hoặc None, danh sách ứng viên để hỏi lại)."""
        arguments = {"text": text, "limit": 5}
        if bounding_box is not None:
            arguments["bounding_box"] = bounding_box
        results = ((await tools.call("resolve_location", arguments)) or {}).get("results") or []
        return pick_place(results), results

    async def _areas_for_near(
        self, req: AgentTaskRequest, tools: CountingClient, city_scope: dict | None
    ) -> list[dict]:
        query = requested_area_query(req)
        if not query:
            return []
        city_bbox = (city_scope or {}).get("bounding_box")
        arguments = area_search_args(query, city_scope=city_scope, include_geometry=True)
        options = ((await tools.call("search_areas", arguments)) or {}).get("results") or []
        return [a for a in named_areas(options, query, city_bbox) if a.get("area_id") and a.get("bounding_box")]

    def _choose(
        self, req: AgentTaskRequest, tools: CountingClient, field: str, text: str, options: list[dict]
    ) -> AgentTaskResult:
        if not options:
            return self._not_found(req, tools, field, text)
        # Fuzzy records are suggestions for an explicit user choice, never an
        # automatic coordinate. Dropping them here hides useful real matches
        # whenever the user's natural name differs from the OSM formal name.
        suggested = all(o.get("match_type") == "fuzzy" for o in options)
        candidate_count = len(options)
        if suggested:
            options = [o for o in options if (o.get("match_score") or 0) >= MIN_SUGGESTION_SCORE]
            if not options:
                return self._not_found(
                    req, tools, field, text, resolution="below_suggestion_threshold", candidate_count=candidate_count
                )
        labels = list(dict.fromkeys(label_of(o) for o in options))[:5]
        question = Question(
            field=field,
            reason="location_ambiguous",
            text=(
                f'Mình tìm thấy các địa điểm có tên gần với "{text}". Bạn chọn đúng địa điểm trên bản đồ nhé.'
                if suggested
                else f'"{text}" khớp nhiều nơi. Bạn muốn nói tới nơi nào?'
            ),
            options=labels,
            choices=location_choices(options),
        )
        return self._result(
            req,
            tools,
            status="needs_input",
            questions=[question],
            data={
                "location_resolution": {
                    "field": field,
                    "status": "suggestions" if suggested else "ambiguous",
                    "candidate_count": candidate_count,
                    "offered_count": len(options),
                }
            },
        )

    async def _property(self, req: AgentTaskRequest, tools: CountingClient) -> AgentTaskResult:
        inp = req.inputs
        if inp.get("housing_mode") == "compare":
            return await self._comparison(req, tools)
        search_compare = inp.get("housing_mode") == "search_compare"
        limit = int(inp.get("limit") or 5)
        query_limit = 20 if search_compare else limit
        search_radius = int(inp.get("search_radius_m") or DEFAULT_RADIUS_M)
        soft = inp.get("soft_filters") or {}
        area: dict[str, Any] = {}
        area_name = None
        city_scope = None
        administrative_scope: dict | None = None
        scope_bbox: dict | None = None
        if inp.get("bounding_box"):
            # Khung bản đồ người dùng đang xem (API đã kiểm biên); thay cho thành phố / địa danh.
            area = {"bounding_box": dict(inp["bounding_box"])}
            area_name = "khu vực đang xem trên bản đồ"
        if not area and inp.get("city") and inp.get("near"):
            areas = ((await tools.call("search_areas", {"text": city_search_text(inp["city"]), "limit": 5})) or {}).get(
                "results"
            ) or []
            city_scope = pick_city_area(areas)
            if city_scope is None:
                return self._choose(req, tools, "city", inp["city"], areas)
            scope_bbox = city_scope.get("bounding_box")
        if area:
            pass
        elif inp.get("near") and inp.get("near_coordinate"):
            area = {"center": inp["near_coordinate"], "radius_m": search_radius}
            area_name = inp["near"]
        elif inp.get("near_place_id"):
            # Người dùng đã chọn ứng viên trên bản đồ: dùng đúng ID đó, không resolve lại tên.
            place = await tools.call("get_place", {"place_id": inp["near_place_id"]})
            location = (place or {}).get("location") or {}
            if location.get("lat") is None:
                return self._not_found(req, tools, "near", inp.get("near") or "", resolution="missing_coordinates")
            area = {"center": location, "radius_m": search_radius}
            area_name = place.get("name") or inp.get("near")
        elif inp.get("near"):
            query = requested_area_query(req)
            if query:
                matching = await self._areas_for_near(req, tools, city_scope)
                if len(matching) > 1:
                    return self._choose(req, tools, "district", query, matching)
                if matching and matching[0].get("area_id"):
                    administrative_scope = matching[0]
                    area = {"administrative_area_ids": [administrative_scope["area_id"]]}
                    area_name = administrative_scope.get("name")
                    scope_bbox = administrative_scope.get("bounding_box")
            if not area:
                place, options = await self._resolve(tools, inp["near"], (city_scope or {}).get("bounding_box"))
                if place is None:
                    return self._choose(req, tools, "near", inp["near"], options)
                area = {"center": place["location"], "radius_m": search_radius}
                area_name = (place.get("parent") or {}).get("name") or place.get("name")
        elif inp.get("city"):
            areas = (
                (
                    await tools.call(
                        "search_areas", {"text": city_search_text(inp["city"]), "limit": 5, "include_geometry": True}
                    )
                )
                or {}
            ).get("results") or []
            found = pick_city_area(areas)
            if found is None:
                return self._choose(req, tools, "city", inp["city"], areas)
            area = {"administrative_area_ids": [found["area_id"]]}
            area_name = found.get("name")
            scope_bbox = found.get("bounding_box")
            administrative_scope = found
            city_scope = found
        elif inp.get("district"):
            # A district alone is a valid scope only after Location resolves it uniquely.
            areas = (
                (await tools.call("search_areas", {"text": inp["district"], "limit": 5, "include_geometry": True}))
                or {}
            ).get("results") or []
            found = pick_named_area(areas, inp["district"])
            if found is None:
                return self._choose(req, tools, "district", inp["district"], areas)
            area = {"administrative_area_ids": [found["area_id"]]}
            area_name = found.get("name")
            scope_bbox = found.get("bounding_box")
            administrative_scope = found
        if city_scope and not administrative_scope:
            area["administrative_area_ids"] = [city_scope["area_id"]]

        # Resolve the user's named sub-area inside the city, using the current dataset's
        # actual unit/name. Never infer an old district from admin_level or from a ward.
        if inp.get("district") and not area.get("bounding_box"):
            arguments = area_search_args(
                inp["district"], city_scope=city_scope, bounding_box=scope_bbox, include_geometry=True
            )
            areas = ((await tools.call("search_areas", arguments)) or {}).get("results") or []
            found = pick_named_area(areas, inp["district"], scope_bbox)
            if found is not None:
                administrative_scope = found
                # administrative_area_ids uses OR, not AND: keep only the narrowest scope.
                area["administrative_area_ids"] = [found["area_id"]]
                if not area.get("center"):
                    area_name = found.get("name")
                scope_bbox = found.get("bounding_box")
            elif not area.get("center"):
                # Legacy addresses remain searchable, but cannot supply a real polygon.
                administrative_scope = None
                area_name = inp["district"]

        def request(filters: dict[str, Any]) -> dict[str, Any]:
            body: dict[str, Any] = {
                "listing_type": "rent",
                "currency": "VND",
                "price_period": "month",
                "pagination": {"limit": query_limit, "cursor": inp.get("cursor")},
                **area,
            }
            if filters.get("max_price_vnd") is not None:
                body["max_price"] = {"amount": filters["max_price_vnd"], "currency": "VND", "period": "month"}
            if filters.get("min_price_vnd") is not None:
                body["min_price"] = {"amount": filters["min_price_vnd"], "currency": "VND", "period": "month"}
            for key in HOUSING_NUMERIC_FILTERS:
                if filters.get(key) is not None:
                    body[key] = filters[key]
            if filters.get("district") and not administrative_scope:
                body["district"] = filters["district"]
            room = ROOM_TYPES.get(str(filters.get("room_type", "")).lower())
            if room:
                body["property_type"] = room
            if filters.get("must_have"):
                body["amenities"] = list(filters["must_have"])
            if filters.get("nearby_categories"):
                radius = filters.get("nearby_radius_m") or DEFAULT_NEARBY_RADIUS_M
                body["nearby"] = [{"category": c, "max_distance_m": radius} for c in filters["nearby_categories"]]
            return body

        hard = {k: inp[k] for k in HOUSING_INPUT_KEYS if inp.get(k) is not None}
        search_request = request({**soft, **hard})
        response = await tools.call("search_housing", search_request)
        results = (response or {}).get("results") or []
        relaxed: list[str] = []
        if (
            not results
            and soft
            and not inp.get("cursor")
            and not ((response or {}).get("page") or {}).get("next_cursor")
        ):
            # Bộ lọc tự điền cho 0 kết quả: tìm lại không có chúng; bộ lọc người dùng tự nói thì giữ.
            search_request = request(hard)
            response = await tools.call("search_housing", search_request)
            results = (response or {}).get("results") or []
            relaxed = sorted(soft)
        must_have = list(search_request.get("amenities") or [])
        candidates, missing, quotes = [], [], []
        excluded = 0
        ordered = (
            sorted(
                results,
                key=lambda r: (
                    bool(any(str(f).startswith("price_") for f in r.get("quality_flags", []))),
                    (r.get("price") or {}).get("amount") or float("inf"),
                ),
            )
            if search_compare
            else rank_listings(results)
        )
        for r in ordered:
            if len(candidates) >= limit:
                break
            candidate, unknown = to_candidate(r, must_have)
            if candidate["price_vnd"] is None or candidate["address"] is None:
                excluded += 1  # không so sánh được nếu thiếu giá thuê tháng / địa chỉ; không tự điền
                continue
            missing += [f"candidates[{len(candidates)}].{k}" for k in unknown]
            candidates.append(candidate)
            if candidate["price_unverified"]:
                missing.append(f"candidates[{len(candidates) - 1}].price_quality")
                continue
            quotes.append(
                Quote(
                    option_id=candidate["id"],
                    label=candidate["title"],
                    amount_vnd=candidate["price_vnd"],
                    recurrence="monthly",
                )
            )
        viewport = (
            scope_bbox
            if administrative_scope and not area.get("center")
            else await self._viewport(tools, area, search_request, candidates, scope_bbox)
        )
        search_envelope = area.get("bounding_box") or (viewport if search_request.get("district") else scope_bbox)
        data = {
            "area_name": area_name,
            "distance_basis": "straight_line" if area.get("center") else "administrative_or_viewport",
            "search_radius_m": area.get("radius_m"),
            "radius_is_default": bool(area.get("center") and not inp.get("search_radius_m")),
            "candidates": candidates,
            "excluded_without_price_or_address": excluded,
            # Xếp hạng chỉ trong trang đã lấy; còn trang sau thì không nói là tốt nhất toàn bộ dữ liệu.
            "has_more": bool(((response or {}).get("page") or {}).get("next_cursor")),
            "next_cursor": ((response or {}).get("page") or {}).get("next_cursor"),
            "query_id": (response or {}).get("query_id"),
            "search_request": search_request,
            "diagnostics": (response or {}).get("diagnostics") or {},
            "map_context": {
                "scope": "returned_candidates",
                "listing_ids": [c["id"] for c in candidates],
                "viewport": viewport,
                "search_scope": {
                    "center": area.get("center"),
                    "radius_m": area.get("radius_m"),
                    "bounding_box": search_envelope,
                    "label": area_name,
                    "geometry": administrative_scope.get("geometry")
                    if administrative_scope and not area.get("center")
                    else None,
                    "area_id": administrative_scope.get("area_id") if administrative_scope else None,
                    "boundary_kind": "search_radius"
                    if area.get("center")
                    else "administrative_polygon"
                    if administrative_scope
                    else "search_envelope_not_administrative_polygon",
                    "boundary_unavailable": bool(
                        inp.get("district") and not administrative_scope and not area.get("center")
                    ),
                },
            },
        }
        if relaxed:
            data["relaxed_filters"] = relaxed
        if search_compare:
            rows = []
            for candidate in candidates:
                rent = candidate["price_vnd"] if not candidate["price_unverified"] else None
                area_m2 = candidate["area_m2"]
                deposit = candidate["deposit_vnd"]
                rows.append(
                    {
                        **candidate,
                        "rent_vnd": rent,
                        "rent_per_m2_vnd": round(rent / area_m2)
                        if rent is not None and isinstance(area_m2, (int, float)) and area_m2 > 0
                        else None,
                        "known_move_in_vnd": rent + deposit if rent is not None and deposit is not None else None,
                        "cost_basis": "rent_plus_deposit_only_not_final_total",
                        "unknown_cost_fields": ["electricity", "water", "service_fees"],
                    }
                )
            data["comparison"] = {
                "rows": rows,
                "scope": "new_search_results_only",
                "fees_verified": False,
                "has_more": data["has_more"],
            }
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

    async def _comparison(self, req: AgentTaskRequest, tools: CountingClient) -> AgentTaskResult:
        """Re-read explicit listings, never replace them with new search results."""
        candidates, rows, missing = [], [], []
        for identifier in req.inputs["listing_ids"]:
            raw = await tools.call("get_housing", {"listing_id": identifier})
            if raw.get("listing_id") != identifier:
                return failed_result(
                    req, "invalid_input", "Không đọc được đúng căn cần so sánh.", False, SOURCE, "live"
                )
            candidate, unknown = to_candidate(raw, req.inputs.get("must_have", []))
            candidates.append(candidate)
            rent = candidate["price_vnd"] if not candidate["price_unverified"] else None
            deposit = candidate["deposit_vnd"]
            area = candidate["area_m2"]
            rows.append(
                {
                    **candidate,
                    "rent_vnd": rent,
                    "rent_per_m2_vnd": round(rent / area)
                    if rent is not None and isinstance(area, (int, float)) and area > 0
                    else None,
                    "known_move_in_vnd": rent + deposit if rent is not None and deposit is not None else None,
                    "cost_basis": "rent_plus_deposit_only_not_final_total",
                    "unknown_cost_fields": ["electricity", "water", "service_fees"],
                }
            )
            missing += [f"candidates[{len(candidates) - 1}].{key}" for key in unknown]
        return self._result(
            req,
            tools,
            status="done",
            source_refs=list(req.inputs["listing_ids"]),
            missing_fields=missing,
            quotes=[],  # Read-only facts, not selectable/budgeted housing options.
            data={
                "candidates": candidates,
                "comparison": {
                    "rows": rows,
                    "scope": "requested_listings_only",
                    "fees_verified": False,
                    "price_outside_requested_range_ids": [
                        row["id"]
                        for row in rows
                        if row["rent_vnd"] is not None
                        and (
                            (
                                req.inputs.get("min_price_vnd") is not None
                                and row["rent_vnd"] < req.inputs["min_price_vnd"]
                            )
                            or (
                                req.inputs.get("max_price_vnd") is not None
                                and row["rent_vnd"] > req.inputs["max_price_vnd"]
                            )
                        )
                    ],
                },
                "map_context": {
                    "scope": "returned_candidates",
                    "listing_ids": list(req.inputs["listing_ids"]),
                    "viewport": bbox_of_points(candidates),
                },
            },
            summary=f"Đã đọc lại {len(candidates)} căn để so sánh; chưa chọn hay liên hệ chủ nhà.",
        )

    async def _viewport(
        self, tools: CountingClient, area: dict, search_request: dict, candidates: list[dict], scope_bbox: dict | None
    ) -> dict | None:
        """Khung bản đồ cho client bay tới, lấy từ dữ liệu Location (không do LLM sinh).

        Ưu tiên: tâm + bán kính đã tìm > khung bản đồ người dùng gửi > ranh giới quận người dùng nêu
        > bao các căn trả về > ranh giới thành phố."""
        if area.get("center"):
            return bbox_around(area["center"], area.get("radius_m") or DEFAULT_RADIUS_M)
        if area.get("bounding_box"):
            return area["bounding_box"]
        if search_request.get("district"):
            ids = area.get("administrative_area_ids") or []
            city_scope = {"area_id": ids[0]} if len(ids) == 1 else None
            arguments = area_search_args(search_request["district"], city_scope=city_scope, bounding_box=scope_bbox)
            try:
                areas = ((await tools.call("search_areas", arguments)) or {}).get("results") or []
            except (ToolCallError, BudgetExceededError):
                areas = []
            # Only a real name match may move the map; a fuzzy neighbour (e.g. no polygon for a
            # legacy district) falls back to the listings actually returned.
            found = pick_named_area(areas, search_request["district"], scope_bbox)
            if found and found.get("bounding_box"):
                # Listings may carry a legacy district larger than today's polygon of the same
                # name; cover both the polygon and the listings actually returned.
                return union_bbox(found["bounding_box"], bbox_of_points(candidates))
        return bbox_of_points(candidates) or scope_bbox

    def _not_found(
        self,
        req: AgentTaskRequest,
        tools: CountingClient,
        field: str,
        text: str,
        *,
        resolution: str = "no_results",
        candidate_count: int = 0,
    ) -> AgentTaskResult:
        question = (
            f'Mình chưa có tọa độ đáng tin cậy cho "{text}". Bạn có thể ghim địa điểm trên bản đồ '
            "hoặc yêu cầu tìm theo quận/thành phố thay thế."
            if field == "near"
            else f'Mình chưa xác định được vị trí "{text}". Bạn nói rõ hơn được không?'
        )
        if req.agent == AgentName.PROPERTY:
            question = (
                f'Mình chưa có tọa độ đáng tin cậy cho "{text}". Bạn gửi tên đầy đủ kèm địa chỉ hoặc '
                "quận/thành phố để mình tra lại nhé. Mình giữ nguyên các tiêu chí tìm nhà còn lại; "
                "chưa mở rộng sang khu vực khác."
            )
        return self._result(
            req,
            tools,
            status="needs_input",
            questions=[Question(field=field, text=question, reason="location_not_found")],
            data={
                "location_resolution": {
                    "field": field,
                    "status": resolution,
                    "candidate_count": candidate_count,
                    "offered_count": 0,
                }
            },
        )

    async def _map(self, req: AgentTaskRequest, tools: CountingClient) -> AgentTaskResult:
        inp = req.inputs
        if inp.get("map_mode") == "route":
            return await self._route(req, tools)
        radius = int(inp.get("radius_m") or 1500)
        constraints = [{"category": c, "max_distance_m": radius} for c in inp["categories"]]
        origins: dict[str, dict] = {}
        approximate: list[str] = []
        if inp.get("near_place_id"):
            place = await tools.call("get_place", {"place_id": inp["near_place_id"]})
            if not ((place or {}).get("location") or {}).get("lat"):
                return self._not_found(req, tools, "near", inp.get("near") or "")
            origins[place.get("name") or inp.get("near") or inp["near_place_id"]] = place["location"]
        elif inp.get("near"):
            place, options = await self._resolve(tools, inp["near"])
            if place is None:
                return self._choose(req, tools, "near", inp["near"], options)
            origins[place.get("name") or inp["near"]] = place["location"]
        else:
            requested_ids = (
                [inp["selected_listing_id"]] if inp.get("selected_listing_id") else inp.get("listing_ids") or []
            )
            wanted = set(requested_ids)
            for upstream in req.upstream.values():
                if upstream.agent != AgentName.PROPERTY:
                    continue
                for c in upstream.data.get("candidates", []):
                    if (not wanted or c.get("id") in wanted) and c.get("lat") is not None and c.get("lng") is not None:
                        origins[c["id"]] = {"lat": c["lat"], "lng": c["lng"]}
                        if c.get("location_accuracy") != "rooftop":
                            approximate.append(c["id"])
            # Explicit IDs remain usable after a selection or without a property
            # search dependency. Missing IDs never fall back to an unrelated home.
            for listing_id in requested_ids:
                if listing_id in origins:
                    continue
                item = await tools.call("get_housing", {"listing_id": listing_id})
                location = (item or {}).get("location") or {}
                if location.get("lat") is not None and location.get("lng") is not None:
                    origins[listing_id] = location
                    if item.get("location_accuracy") != "rooftop":
                        approximate.append(listing_id)
            origins = dict(list(origins.items())[:3])
            approximate = [a for a in approximate if a in origins]
        if not origins:
            return self._result(
                req,
                tools,
                status="needs_input",
                questions=[Question(field="near", text="Bạn muốn xem tiện ích quanh căn nhà hoặc địa điểm nào?")],
            )
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
                    "distance_kind": "straight_line",
                    "location": p.get("location"),
                    "source": p.get("source"),
                    "verification": p.get("verification"),
                }
                for p in items
            ]
            refs += [p["place_id"] for p in items if p.get("place_id")]
            if not items:
                missing.append(f"nearby.{key}")
        data: dict[str, Any] = {"nearby": nearby, "origins": origins, "coverage": "nearest_per_category"}
        if approximate:  # vị trí phòng chỉ gần đúng: khoảng cách tới tiện ích cũng chỉ gần đúng
            data["approximate_origins"] = approximate
        return self._result(req, tools, status="done", data=data, missing_fields=missing, source_refs=refs)

    async def _route(self, req: AgentTaskRequest, tools: CountingClient) -> AgentTaskResult:
        inp = req.inputs
        cities = {"hồ chí minh": "hcm", "hà nội": "hanoi", "đà nẵng": "danang"}
        search_city = city_search_text(inp["city"])
        city = next((v for k, v in cities.items() if k in search_city.lower()), None)
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
        areas = (await tools.call("search_areas", {"text": search_city, "limit": 5})).get("results") or []
        area = pick_city_area(areas)
        if not area or not area.get("bounding_box"):
            return self._choose(req, tools, "city", inp["city"], areas)
        endpoints = {}
        refs = []
        for field in ("route_from", "route_to"):
            if inp[field] == "selected:property":
                listing_id = inp.get("selected_listing_id")
                if not listing_id:
                    return self._result(
                        req,
                        tools,
                        status="needs_input",
                        questions=[
                            Question(
                                field="selected:property",
                                text="Bạn muốn tính đường cho căn nhà nào? Hãy chọn một căn trước.",
                            )
                        ],
                    )
                endpoints[field] = {"type": "housing", "listing_id": listing_id}
                refs.append(listing_id)
                continue
            if inp.get(field + "_place_id"):
                # Ứng viên người dùng đã chọn trên bản đồ; Location vẫn kiểm place còn hoạt động.
                endpoints[field] = {"type": "place", "place_id": inp[field + "_place_id"]}
                refs.append(inp[field + "_place_id"])
                continue
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
            place = pick_place(options)
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
