"""Capability tối thiểu theo lĩnh vực (agent-graph.md §6.3.8).

Manifest của subagent thật phải bao được các schema dưới đây (được thêm field, không được bớt).
`FakeAgent` và subagent nền (`subagents/services/`) dùng đúng các capability này.
"""

from __future__ import annotations

from relohome_agent.agents.contracts import AgentCapability
from relohome_agent.agents.housing_constraints import HOUSING_INPUT_KEYS, HOUSING_NUMERIC_FILTERS
from relohome_agent.agents.models import AgentBudget, AgentName, CommitActionKind
from relohome_roommate.models import RoommateSearchCriteria

_STR = {"type": "string", "minLength": 1}
_INT = {"type": "integer", "minimum": 0}
_DATE = {"type": "string", "pattern": r"^\d{4}-\d{2}-\d{2}$"}
_OPT_NUM = {"type": ["number", "null"]}
_OPT_STR = {"type": ["string", "null"]}
_BBOX = {
    "type": "object",
    "properties": {
        "west": {"type": "number", "minimum": -180, "maximum": 180},
        "south": {"type": "number", "minimum": -90, "maximum": 90},
        "east": {"type": "number", "minimum": -180, "maximum": 180},
        "north": {"type": "number", "minimum": -90, "maximum": 90},
    },
    "required": ["west", "south", "east", "north"],
    "additionalProperties": False,
}

PROPERTY = AgentCapability(
    agent=AgentName.PROPERTY,
    input_schema={
        "type": "object",
        "properties": {
            "housing_mode": {"enum": ["search", "compare", "search_compare"]},
            "listing_ids": {"type": "array", "items": _STR, "minItems": 2, "maxItems": 4, "uniqueItems": True},
            "city": _STR,
            "district": _STR,
            "near": _STR,
            "search_radius_m": {"type": "integer", "minimum": 50, "maximum": 20000},
            "near_place_id": _STR,  # ứng viên người dùng đã chọn trên bản đồ (LocationChoice.id)
            "bounding_box": _BBOX,  # khung bản đồ người dùng đang xem, do API kiểm, không do LLM sinh
            "near_coordinate": {
                "type": "object",
                "properties": {
                    "lat": {"type": "number", "minimum": -90, "maximum": 90},
                    "lng": {"type": "number", "minimum": -180, "maximum": 180},
                },
                "required": ["lat", "lng"],
                "additionalProperties": False,
            },
            "min_price_vnd": _INT,
            **{k: {"type": "integer" if "bedrooms" in k else "number", "minimum": 0} for k in HOUSING_NUMERIC_FILTERS},
            # Rent and floor area are strictly positive: an upper bound of 0 can only exclude every listing.
            "max_area_m2": {"type": "number", "exclusiveMinimum": 0},
            "max_price_vnd": {"type": "integer", "exclusiveMinimum": 0},
            "room_type": _STR,
            "must_have": {"type": "array", "items": _STR},
            "nearby_categories": {"type": "array", "items": _STR, "minItems": 1, "maxItems": 10},
            "nearby_radius_m": {"type": "integer", "minimum": 50, "maximum": 20000},
            "soft_filters": {"type": "object"},
            "limit": {"type": "integer", "minimum": 1, "maximum": 20},
            "cursor": {"type": ["string", "null"], "maxLength": 1000},
        },
        "anyOf": [
            {"properties": {"housing_mode": {"const": "compare"}}, "required": ["housing_mode", "listing_ids"]},
            {"required": ["city"]},
            {"required": ["near"]},
            {"required": ["district"]},
            {"required": ["bounding_box"]},
        ],
        "allOf": [
            {
                "if": {"properties": {"housing_mode": {"const": "compare"}}, "required": ["housing_mode"]},
                "then": {"required": ["listing_ids"]},
            }
        ],
        "additionalProperties": False,
    },
    output_schema={
        "type": "object",
        "properties": {
            "area_name": _OPT_STR,
            "candidates": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": _STR,
                        "title": _STR,
                        "price_vnd": {"type": ["integer", "null"]},
                        "deposit_vnd": {"type": ["integer", "null"]},
                        "area_m2": _OPT_NUM,
                        "address": _OPT_STR,
                        "city": _OPT_STR,
                        "lat": _OPT_NUM,
                        "lng": _OPT_NUM,
                        "wifi": {"type": ["boolean", "null"]},
                        "location_accuracy": {"enum": ["rooftop", "approximate", "unknown"]},
                        "location_method": _OPT_STR,
                        "amenities": {"type": "array", "items": _STR},
                        "price": {"type": "object"},
                        "thumbnail_url": _OPT_STR,
                        "source": {"type": ["object", "null"]},
                        "verification": {"type": ["object", "null"]},
                        "unknown_fields": {"type": "array", "items": _STR},
                    },
                    "required": ["id", "title", "price_vnd", "address"],
                },
            },
            "relaxed_filters": {"type": "array", "items": _STR},
            "has_more": {"type": "boolean"},
            "next_cursor": _OPT_STR,
            "query_id": _OPT_STR,
            "search_request": {"type": "object"},
            "diagnostics": {"type": "object"},
            "map_context": {
                "type": "object",
                "properties": {
                    "scope": {"const": "returned_candidates"},
                    "listing_ids": {"type": "array", "items": _STR},
                    "viewport": {"anyOf": [_BBOX, {"type": "null"}]},
                },
                "required": ["scope", "listing_ids"],
            },
        },
        "required": ["candidates"],
    },
    required_fields=["candidates", "candidates[].price_vnd", "candidates[].address"],
    stale_ttl_s=6 * 3600,
    cost_tier="cheap",
    default_budget=AgentBudget(max_llm_calls=0, max_provider_calls=6),
    constraint_keys=[
        *HOUSING_INPUT_KEYS,
        "household_size",
        "has_pet",
        "has_motorbike",
    ],
)

MAP = AgentCapability(
    agent=AgentName.MAP,
    input_schema={
        "type": "object",
        "properties": {
            "map_mode": {"enum": ["route", "nearby"]},
            "route_from": _STR,
            "route_to": _STR,
            "route_from_place_id": _STR,
            "route_to_place_id": _STR,
            "near_place_id": _STR,
            "selected_listing_id": _STR,
            "city": _STR,
            "route_profile": {"enum": ["walking", "motorcycle", "driving"]},
            "categories": {"type": "array", "items": _STR, "minItems": 1, "maxItems": 10},
            "radius_m": {"type": "integer", "minimum": 50, "maximum": 20000},
            "near": _STR,
            "listing_ids": {"type": "array", "items": _STR, "minItems": 1, "maxItems": 3, "uniqueItems": True},
        },
        "anyOf": [
            {
                "required": ["categories"],
                "not": {"required": ["map_mode"], "properties": {"map_mode": {"const": "route"}}},
            },
            {
                "required": ["map_mode", "route_from", "route_to", "city"],
                "properties": {"map_mode": {"const": "route"}},
            },
        ],
        "allOf": [
            {"not": {"required": ["near", "selected_listing_id"]}},
            {"not": {"required": ["near", "listing_ids"]}},
            {"not": {"required": ["selected_listing_id", "listing_ids"]}},
        ],
        "additionalProperties": False,
    },
    output_schema={
        "type": "object",
        "properties": {
            "nearby": {
                "type": "object",
                "additionalProperties": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": _OPT_STR,
                            "category": _STR,
                            "distance_m": {"type": "number"},
                            "location": {"type": ["object", "null"]},
                            "distance_kind": {"const": "straight_line"},
                            "source": {"type": ["object", "null"]},
                            "verification": {"type": ["object", "null"]},
                        },
                        "required": ["category", "distance_m"],
                    },
                },
            },
            "routing": {"type": "object"},
            "origins": {"type": "object"},
            "coverage": {"const": "nearest_per_category"},
            "approximate_origins": {"type": "array", "items": _STR},
        },
        "required": ["nearby"],
    },
    required_fields=["nearby|routing"],
    stale_ttl_s=7 * 24 * 3600,
    cost_tier="cheap",
    default_budget=AgentBudget(max_llm_calls=0, max_provider_calls=12),
    constraint_keys=[
        "near",
        "map_mode",
        "map_categories",
        "map_radius_m",
        "route_from",
        "route_to",
        "city",
        "route_profile",
    ],
)

FLIGHT = AgentCapability(
    agent=AgentName.FLIGHT,
    input_schema={
        "type": "object",
        "properties": {
            "origin": _STR,
            "destination": _STR,
            "date": _DATE,
            "trip_type": {"type": "string", "enum": ["one_way", "round_trip"]},
            "return_date": _DATE,
            "passengers": {
                "type": "object",
                "properties": {"adults": {"type": "integer", "minimum": 1}, "children": _INT, "infants": _INT},
                "additionalProperties": False,
            },
            "booking_ref": _STR,
        },
        "anyOf": [{"required": ["origin", "date"]}, {"required": ["booking_ref"]}],
        "additionalProperties": False,
    },
    output_schema={
        "type": "object",
        "properties": {
            "offers": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": _STR,
                        "carrier": _STR,
                        "fare_vnd": {"type": ["integer", "null"]},
                        "baggage_kg": {"type": ["integer", "null"]},
                        "depart_at": _OPT_STR,
                        "arrive_at": _OPT_STR,
                        "seats_left": {"type": ["integer", "null"]},
                    },
                    "required": ["id", "carrier", "fare_vnd", "depart_at"],
                },
            },
            "booking": {"type": "object"},
        },
    },
    required_fields=["offers|booking", "offers[].fare_vnd", "offers[].depart_at"],
    stale_ttl_s=15 * 60,
    cost_tier="paid",
    default_budget=AgentBudget(max_llm_calls=0, max_provider_calls=4),
    constraint_keys=["origin", "destination", "flight_date", "trip_type", "return_date", "passengers"],
    hint_keys=["preferred_airline"],
    commit_kinds=[CommitActionKind.FLIGHT_BOOKING, CommitActionKind.CANCEL_ORDER],
)

RELOCATION = AgentCapability(
    agent=AgentName.RELOCATION,
    input_schema={
        "type": "object",
        "properties": {
            "mode": {"enum": ["quote", "order_status"]},
            "from_address": _STR,
            "to_address": _STR,
            "move_date": _DATE,
            "move_time": {"type": "string", "pattern": r"^([01]\d|2[0-3]):[0-5]\d$"},
            "selected_listing_id": _STR,
            "volume": _STR,
            "moving_options": {"type": "object"},
            "order_id": _STR,
            "tracking_number": _STR,
        },
        "required": ["mode"],
        "allOf": [
            {
                "if": {"properties": {"mode": {"const": "quote"}}},
                "then": {
                    "required": ["from_address", "move_date", "move_time"],
                    "anyOf": [{"required": ["to_address"]}, {"required": ["selected_listing_id"]}],
                },
            },
            {
                "if": {"properties": {"mode": {"const": "order_status"}}},
                "then": {"anyOf": [{"required": ["order_id"]}, {"required": ["tracking_number"]}]},
            },
        ],
        "additionalProperties": False,
    },
    output_schema={
        "type": "object",
        "properties": {
            "quotes": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": _STR,
                        "provider": _STR,
                        "price_vnd": {"type": ["integer", "null"]},
                        "vehicle": _OPT_STR,
                        "movers": {"type": ["integer", "null"]},
                        "date": _OPT_STR,
                    },
                    "required": ["id", "provider", "price_vnd"],
                },
            },
            "order": {"type": "object"},
        },
    },
    required_fields=["quotes|order", "quotes[].price_vnd"],
    stale_ttl_s=300,  # báo giá AhaMove mặc định hết hạn sau 5 phút (AHAMOVE_QUOTE_TTL_SECONDS)
    cost_tier="paid",
    default_budget=AgentBudget(max_llm_calls=0, max_provider_calls=8),
    constraint_keys=["from_address", "to_address", "move_date", "move_time", "volume", "moving_options"],
    hint_keys=["preferred_mover"],
    commit_kinds=[CommitActionKind.MOVING_BOOKING, CommitActionKind.CANCEL_ORDER, CommitActionKind.UPDATE_ORDER],
)

PAYMENT = AgentCapability(
    agent=AgentName.PAYMENT,
    input_schema={
        "type": "object",
        "properties": {"payment_id": _STR},
        "required": ["payment_id"],
        "additionalProperties": False,
    },
    output_schema={
        "type": "object",
        "properties": {
            "payment": {
                "type": "object",
                "properties": {
                    "payment_id": _STR,
                    "status": {"enum": ["PENDING", "PAID", "FAILED", "CANCELLED", "EXPIRED", "REFUNDED"]},
                    "provider": {"const": "zalopay"},
                    "amount": _INT,
                    "currency": {"const": "VND"},
                },
                "required": ["payment_id", "status", "provider", "amount", "currency"],
            }
        },
        "required": ["payment"],
    },
    required_fields=["payment"],
    stale_ttl_s=60,
    cost_tier="cheap",
    default_budget=AgentBudget(max_llm_calls=0, max_provider_calls=1),
    constraint_keys=["payment_id"],
)

_roommate_criteria_schema = RoommateSearchCriteria.model_json_schema()
_roommate_defs = _roommate_criteria_schema.pop("$defs", {})
ROOMMATE = AgentCapability(
    agent=AgentName.ROOMMATE,
    input_schema={
        "type": "object",
        "$defs": _roommate_defs,
        "properties": {"roommate_criteria": _roommate_criteria_schema},
        "additionalProperties": False,
    },
    output_schema={
        "type": "object",
        "properties": {
            "entry": {"const": "roommate"},
            "availability": {"enum": ["ready", "disabled", "eligibility_required", "criteria_required"]},
            "profile_refs": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {"profile_id": _STR},
                    "required": ["profile_id"],
                    "additionalProperties": False,
                },
            },
            "criteria": {"type": ["object", "null"]},
            "execution": {"type": "object"},
        },
        "required": ["entry", "availability", "profile_refs"],
        "additionalProperties": False,
    },
    required_fields=["entry", "availability"],
    stale_ttl_s=60,  # Handles only; profile reads always recheck authorization and expiry.
    cost_tier="cheap",
    uses_llm=False,
    default_budget=AgentBudget(max_llm_calls=0, max_provider_calls=0),
    constraint_keys=["roommate_criteria"],
    commit_kinds=[],
)

BASELINE_CAPABILITIES: dict[AgentName, AgentCapability] = {
    AgentName.PROPERTY: PROPERTY,
    AgentName.MAP: MAP,
    AgentName.FLIGHT: FLIGHT,
    AgentName.RELOCATION: RELOCATION,
    AgentName.PAYMENT: PAYMENT,
    AgentName.ROOMMATE: ROOMMATE,
}


def operation_selector_keys(capabilities) -> frozenset[str]:
    """Input keys that choose WHICH operation of a domain runs, read from the manifests themselves.

    A key is a selector when an `anyOf`/`oneOf` branch or an `allOf` `if` clause of a capability's
    `input_schema` pins it with `const` (e.g. Map `map_mode`: route vs nearby). Choosing another
    operation is a new task for that domain, not a contradiction of an earlier user constraint.
    """

    def consts(schema: dict) -> set[str]:
        return {k for k, spec in (schema.get("properties") or {}).items() if isinstance(spec, dict) and "const" in spec}

    keys: set[str] = set()
    for capability in capabilities:
        schema = capability.input_schema
        for branch in [*schema.get("anyOf", []), *schema.get("oneOf", [])]:
            keys |= consts(branch)
        for clause in schema.get("allOf", []):
            keys |= consts(clause.get("if") or {})
    return frozenset(keys)


def fact_fits_capabilities(key: str, value) -> bool:
    """A stated fact must be a valid input wherever a domain uses the same key (schema, not phrasing)."""
    from jsonschema import Draft202012Validator

    for capability in BASELINE_CAPABILITIES.values():
        spec = (capability.input_schema.get("properties") or {}).get(key)
        if not isinstance(spec, dict):
            continue
        # Same key with a different shape is a different field (e.g. fact passengers=1 vs Flight
        # input passengers={adults: 1}); only a value of the input's own type is checked against it.
        if "type" in spec and not Draft202012Validator({"type": spec["type"]}).is_valid(value):
            continue
        if not Draft202012Validator(spec).is_valid(value):
            return False
    return True
