"""Purpose-specific allowlists; never send sessions, contacts, auth or map payloads."""

from __future__ import annotations

import json
import math
import re
import unicodedata
from datetime import date, time

from relohome_agent.agents.intake import redact_pii
from relohome_agent.agents.models import RequestKind

MAX_STATE_BYTES = 16_000
MAX_TEXT_CHARS = 4_000
MAX_ITEMS = 40
INPUT_FIELDS = frozenset(
    {
        "city",
        "district",
        "near",
        "min_price_vnd",
        "max_price_vnd",
        "must_have",
        "room_type",
        "min_bedrooms",
        "max_bedrooms",
        "household_size",
        "has_pet",
        "has_motorbike",
        "search_radius_m",
        "soft_filters",
        "housing_mode",
        "mode",
        "limit",
        "origin",
        "destination",
        "date",
        "flight_date",
        "return_date",
        "trip_type",
        "passengers",
        "adults",
        "children",
        "infants",
        "from_address",
        "to_address",
        "move_date",
        "move_time",
        "route_from",
        "route_to",
        "route_profile",
        "nearby_categories",
        "nearby_radius_m",
        "map_origin",
        "map_mode",
        "map_categories",
        "map_radius_m",
        "profile",
        "categories",
        "radius_m",
    }
)
FACT_FIELDS = INPUT_FIELDS | frozenset(
    {
        "candidates",
        "offers",
        "details",
        "comparison",
        "rows",
        "criteria",
        "unknown_fields",
        "title",
        "label",
        "description",
        "address",
        "price_vnd",
        "rent_vnd",
        "amount_vnd",
        "currency",
        "area_m2",
        "bedrooms",
        "bathrooms",
        "amenities",
        "deposit_vnd",
        "deposit_months",
        "fees",
        "price_quality",
        "quality_flags",
        "coordinate_precision",
        "distance_m",
        "duration_s",
        "distance_km",
        "duration_minutes",
        "departure",
        "arrival",
        "departure_time",
        "arrival_time",
        "airline",
        "carrier",
        "fare_vnd",
        "baggage_kg",
        "depart_at",
        "arrive_at",
        "flight_numbers",
        "seats_left",
        "expires_at",
        "price",
        "amount",
        "period",
        "verification",
        "price_unverified",
        "location_accuracy",
        "nearby",
        "category",
        "rent_per_m2_vnd",
        "known_move_in_vnd",
        "cost_basis",
        "unknown_cost_fields",
        "fees_verified",
        "stops",
        "price_scope",
        "baggage",
        "verified",
        "monthly_cost_vnd",
        "initial_cost_vnd",
        "unknown_costs",
        "host_rating",
        "host_review_count",
        "satisfaction",
        "reason",
        "next_step",
        "kind",
    }
)
# Regex is privacy scrubbing, not semantic task routing. Provider/user text may embed credentials.
SECRET_TEXT = re.compile(
    r"(?i)\b(?:bearer\s+\S+|sk-[a-z0-9_-]+|eyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+|"
    r"(?:cookie|authorization)\s*:\s*[^\r\n]+|"
    r"(?:api[_ -]?key|token|password|secret|siu_session|cf_authorization|cf_clearance|cf_appsession)\s*[:=]\s*[^\s;,]+)"
)
URL_TEXT = re.compile(r"https?://[^\s<>]+", re.IGNORECASE)


class ProjectionLimitError(ValueError):
    """Skip observation rather than judging silently truncated evidence."""


class ProjectionPrivacyError(ValueError):
    """Required narrative evidence cannot safely be forwarded by the runtime."""


# No general-purpose NER/regex can promise removal of names and private addresses.
# Runtime therefore drops narrative fields and aliases every non-schema string.
NARRATIVE_FIELDS = frozenset(
    {"latest_user_request", "user_request", "evidence", "reason", "next_step", "description", "address", "label"}
)
SCHEMA_VALUES = {
    "domain": frozenset({"property", "map", "flight", "relocation", "payment", "roommate"}),
    "requested_domains": frozenset({"property", "map", "flight", "relocation", "payment", "roommate"}),
    "request_kind": frozenset(kind.value for kind in RequestKind),
    "room_type": frozenset({"room", "studio", "apartment", "house", "shared", "dormitory"}),
    "must_have": frozenset(
        {"air_conditioning", "wifi", "parking", "balcony", "elevator", "furnished", "kitchen", "pet_allowed"}
    ),
    "trip_type": frozenset({"one_way", "round_trip"}),
    "route_profile": frozenset({"driving", "walking", "cycling"}),
    "currency": frozenset({"VND", "USD"}),
    "period": frozenset({"month", "night", "week", "year"}),
}
DATE_FIELDS = frozenset({"date", "flight_date", "return_date", "move_date"})


def structured_projection(state: dict) -> dict:
    aliases: dict[str, str] = {}

    def visit(value, field=""):
        if isinstance(value, dict):
            return {
                key: visit(item, field if key == "value" else key)
                for key, item in value.items()
                if key not in NARRATIVE_FIELDS
            }
        if isinstance(value, list):
            return [visit(item, field) for item in value]
        if not isinstance(value, str):
            return value
        if value in SCHEMA_VALUES.get(field, ()):
            return value
        if field in DATE_FIELDS:
            try:
                if date.fromisoformat(value).isoformat() == value:
                    return value
            except ValueError:
                pass
        if field == "move_time":
            try:
                if re.fullmatch(r"\d{2}:\d{2}(?::\d{2})?", value):
                    time.fromisoformat(value)
                    return value
            except ValueError:
                pass
        # Same-value comparison only, NOT a location resolver or global identifier.
        normalized = unicodedata.normalize("NFKD", value.casefold())
        normalized = "".join(c for c in normalized if c.isalnum() and not unicodedata.combining(c))
        return aliases.setdefault(normalized, f"opaque_{len(aliases) + 1}")

    projected = visit(state)
    # These fields are internal, typed values, never taken from free user/provider text.
    for key in ("request_kind", "requested_domains", "proposed_commit_kinds"):
        if key in state:
            projected[key] = state[key]
    for key in ("previous_plan", "proposed_plan"):
        for original, safe in zip(state.get(key, []), projected.get(key, []), strict=True):
            safe["reference"] = original["reference"]
            safe["depends_on"] = original["depends_on"]
    projected["privacy_mode"] = "structured_only"
    projected["free_text_available"] = False
    projected["projection_note"] = (
        "Narrative user evidence, names and addresses are omitted. Opaque values support equality only; "
        "different aliases do not prove different places. Check consistency with structured Intake facts, "
        "NOT faithfulness to the original user message. No injection-text or narrative grounding coverage."
    )
    return bounded(projected)


def safe_text(value: str) -> str:
    if len(value) > MAX_TEXT_CHARS:
        raise ProjectionLimitError("text_limit")
    return redact_pii(URL_TEXT.sub("[URL]", SECRET_TEXT.sub("[SECRET]", value)))


def safe_value(value, fields: frozenset[str], depth: int = 0):
    if depth > 6:
        raise ProjectionLimitError("depth_limit")
    if isinstance(value, str):
        return safe_text(value)
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        if isinstance(value, int) and value.bit_length() > 63:
            raise ProjectionLimitError("number_limit")
        if not math.isfinite(value):
            raise ProjectionLimitError("nonfinite_input")
        return value
    if isinstance(value, dict):
        if len(value) > MAX_ITEMS:
            raise ProjectionLimitError("item_limit")
        return {k: safe_value(v, fields, depth + 1) for k, v in value.items() if k in fields}
    if isinstance(value, (list, tuple)):
        if len(value) > MAX_ITEMS:
            raise ProjectionLimitError("item_limit")
        return [safe_value(v, fields, depth + 1) for v in value]
    raise ProjectionLimitError("unsupported_input")


def bounded(state: dict) -> dict:
    if len(json.dumps(state, ensure_ascii=False, allow_nan=False).encode("utf-8")) > MAX_STATE_BYTES:
        raise ProjectionLimitError("state_limit")
    return state


def plan_projection(state, plan, *, synthetic_text: bool = False) -> dict:
    intake = state["intake"]
    messages = state.get("messages") or []
    latest = next((m.content for m in reversed(messages) if getattr(m, "type", None) == "human"), "")
    if not isinstance(latest, str) or len(plan.tasks) > 12:
        raise ProjectionLimitError("unsupported_input")
    if len(intake.user_confirmed_facts) > MAX_ITEMS or len(intake.prefilled) > MAX_ITEMS:
        raise ProjectionLimitError("item_limit")
    task_ids = {task.id: f"task_{index}" for index, task in enumerate(plan.tasks)}

    def tasks_view(tasks):
        return [
            {
                "domain": task.agent.value,
                "inputs": safe_value(task.inputs, INPUT_FIELDS),
                "omitted_input_count": len(set(task.inputs) - INPUT_FIELDS),
                "depends_on": [task_ids.get(identifier, "previous_task") for identifier in task.depends_on],
                "reference": task_ids.get(task.id, "previous_task"),
            }
            for task in tasks
        ]

    previous = state.get("plan") if intake.kind != RequestKind.NEW_GOAL else None
    if previous and len(previous.tasks) > 12:
        raise ProjectionLimitError("item_limit")
    projected = bounded(
        {
            "latest_user_request": safe_text(latest),
            "request_kind": intake.kind.value,
            "requested_domains": [domain.value for domain in intake.intent.domains] if intake.intent else [],
            "confirmed_facts": {
                key: {"value": safe_value(fact.value, INPUT_FIELDS), "evidence": safe_text(fact.evidence)}
                for key, fact in intake.user_confirmed_facts.items()
                if key in INPUT_FIELDS
            },
            "soft_preferences": {
                key: safe_value(item.value, INPUT_FIELDS)
                for key, item in intake.prefilled.items()
                if key in INPUT_FIELDS
            },
            "previous_plan": tasks_view(previous.tasks) if previous else [],
            "proposed_plan": tasks_view(plan.tasks),
            "proposed_commit_kinds": [action.kind.value for action in plan.commit_actions],
            "projection_note": "Allowlisted projection, not complete provider data; omitted fields cannot be verified.",
        }
    )
    # This explicit opt-in exists only for the synthetic, non-runtime evaluation harness.
    return projected if synthetic_text else structured_projection(projected)


def assessment_projection(inp, result, *, synthetic_text: bool = False) -> dict | None:
    assessment = result.data.get("agent_assessment")
    if result.status != "done" or not isinstance(assessment, dict):
        return None
    # Only these domains expose a provider-fact schema audited for this projection.
    if result.agent.value not in {"property", "flight"}:
        return None
    if not synthetic_text:
        # The current agent assessment contract has reason/next_step narrative, not
        # typed factual claims. Dropping it then judging 'grounded/clean' would lie.
        raise ProjectionPrivacyError("assessment_text_omitted")
    data = result.data
    facts = safe_value({key: value for key, value in data.items() if key in FACT_FIELDS}, FACT_FIELDS)
    # Detail maps use provider IDs as keys. Send their VALUES only, never user/transaction IDs.
    if isinstance(data.get("details"), dict):
        facts["details"] = safe_value(list(data["details"].values()), FACT_FIELDS)
    return bounded(
        {
            "user_request": safe_text(inp.get("user_request", "")),
            "domain": result.agent.value,
            "task_inputs": safe_value(inp["task"].inputs, INPUT_FIELDS),
            "source_kind": result.source_kind,
            "provider_facts": facts,
            "model_assessment": safe_value(assessment, FACT_FIELDS),
            "projection_note": "Incomplete allowlisted evidence; absent fees/rules remain unknown. No private identifiers.",
        }
    )
