"""Capability tối thiểu theo lĩnh vực (agent-graph.md §6.3.8).

Manifest của subagent thật phải bao được các schema dưới đây (được thêm field, không được bớt).
`FakeAgent` và subagent nền (`subagents/services/`) dùng đúng các capability này.
"""

from __future__ import annotations

from src.agents.contracts import AgentCapability
from src.agents.models import AgentBudget, AgentName, CommitActionKind

_STR = {"type": "string", "minLength": 1}
_INT = {"type": "integer", "minimum": 0}
_DATE = {"type": "string", "pattern": r"^\d{4}-\d{2}-\d{2}$"}
_OPT_NUM = {"type": ["number", "null"]}
_OPT_STR = {"type": ["string", "null"]}

PROPERTY = AgentCapability(
    agent=AgentName.PROPERTY,
    input_schema={
        "type": "object",
        "properties": {
            "city": _STR,
            "near": _STR,
            "max_price_vnd": _INT,
            "room_type": _STR,
            "must_have": {"type": "array", "items": _STR},
            "soft_filters": {"type": "object"},
            "limit": {"type": "integer", "minimum": 1, "maximum": 20},
        },
        "anyOf": [{"required": ["city"]}, {"required": ["near"]}],
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
                    },
                    "required": ["id", "title", "price_vnd", "address"],
                },
            },
            "relaxed_filters": {"type": "array", "items": _STR},
            "has_more": {"type": "boolean"},
        },
        "required": ["candidates"],
    },
    required_fields=["candidates", "candidates[].price_vnd", "candidates[].address"],
    stale_ttl_s=6 * 3600,
    cost_tier="cheap",
    default_budget=AgentBudget(max_llm_calls=0, max_provider_calls=6),
    constraint_keys=[
        "city",
        "near",
        "max_price_vnd",
        "room_type",
        "must_have",
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
            "categories": {"type": "array", "items": _STR, "minItems": 1, "maxItems": 10},
            "radius_m": {"type": "integer", "minimum": 50, "maximum": 20000},
            "near": _STR,
            "listing_ids": {"type": "array", "items": _STR},
        },
        "required": ["categories"],
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
                        "properties": {"name": _OPT_STR, "category": _STR, "distance_m": {"type": "number"}},
                        "required": ["category", "distance_m"],
                    },
                },
            }
        },
        "required": ["nearby"],
    },
    required_fields=["nearby"],
    stale_ttl_s=7 * 24 * 3600,
    cost_tier="cheap",
    default_budget=AgentBudget(max_llm_calls=0, max_provider_calls=12),
    constraint_keys=["near"],
)

FLIGHT = AgentCapability(
    agent=AgentName.FLIGHT,
    input_schema={
        "type": "object",
        "properties": {
            "origin": _STR,
            "destination": _STR,
            "date": _DATE,
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
    constraint_keys=["origin", "destination", "flight_date", "passengers"],
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
    constraint_keys=["from_address", "to_address", "move_date", "move_time", "volume"],
    hint_keys=["preferred_mover"],
    commit_kinds=[CommitActionKind.MOVING_BOOKING, CommitActionKind.CANCEL_ORDER, CommitActionKind.UPDATE_ORDER],
)

BASELINE_CAPABILITIES: dict[AgentName, AgentCapability] = {
    AgentName.PROPERTY: PROPERTY,
    AgentName.MAP: MAP,
    AgentName.FLIGHT: FLIGHT,
    AgentName.RELOCATION: RELOCATION,
}
