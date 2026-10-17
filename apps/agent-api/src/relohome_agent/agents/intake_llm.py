"""Intake LLM implementing the graph contract. Construct explicitly; no auto-wiring."""

from __future__ import annotations

import logging
import re
from collections.abc import Callable
from datetime import date, datetime, timedelta, timezone
from typing import Literal

from langchain_core.messages import AIMessage, HumanMessage
from pydantic import BaseModel, ConfigDict, Field
from relohome_agent.agents.common import nfc, utcnow
from relohome_agent.agents.housing_constraints import AMENITIES
from relohome_agent.agents.housing_filter_edits import valid_filter_patch
from relohome_agent.agents.intake import MAP_ENTITY_ANCHORS, REQUIRED_INPUTS, IntakeInput, ground_facts, missing_for
from relohome_agent.agents.intake_prompts import prompt_for
from relohome_agent.agents.llm import StructuredLLM
from relohome_agent.agents.llm_runtime import MAX_REPAIR_CALLS, Invocation, UsageOwner, public_data
from relohome_agent.agents.models import (
    AgentName,
    ConfirmedFact,
    Constraints,
    HousingFilterPatch,
    IntakeResult,
    Intent,
    RequestKind,
)
from relohome_agent.agents.subagents.capabilities import fact_fits_capabilities
from relohome_roommate.models import RoommateSearchCriteria

CATEGORIES = frozenset(
    # Canonical categories emitted by Location's poi-normalization.ts and shown
    # by the existing map UI. Keep this vocabulary aligned with that provider;
    # it is not a list of user phrases or location-specific routing rules.
    "hospital clinic pharmacy doctor dentist other_healthcare school kindergarten college university "
    "marketplace supermarket convenience_store shopping_mall shop_other restaurant cafe fast_food food_court "
    "gym sports_centre park swimming_pool bus_stop bus_station rail_station airport airport_terminal "
    "public_transport_other bank atm fuel parking ev_charging hotel guest_house hostel motel apartment "
    "camp_site chalet resort homestay".split()
)
TEXT_KEYS = frozenset(
    "housing_mode city district near room_type origin destination booking_ref from_address to_address volume order_id tracking_number move_month moving_mode map_mode map_near map_city route_from route_to route_profile payment_id".split()
)
INT_KEYS = frozenset(
    "min_price_vnd max_price_vnd min_bedrooms max_bedrooms household_size budget_vnd nearby_radius_m map_radius_m search_radius_m passengers limit".split()
)
NUMBER_KEYS = frozenset({"min_bathrooms", "min_area_m2", "max_area_m2"})
BOOL_KEYS = frozenset({"has_pet", "has_motorbike"})
VALUE_KEYS = (
    TEXT_KEYS
    | INT_KEYS
    | NUMBER_KEYS
    | BOOL_KEYS
    | {
        "listing_ids",
        "must_have",
        "nearby_categories",
        "map_categories",
        "flight_date",
        "return_date",
        "trip_type",
        "move_date",
        "move_time",
        "roommate_criteria",
        "housing_select_ids",
        "housing_unselect_ids",
    }
)
COMMIT_KEYS = frozenset(
    {"commit:flight_booking", "commit:moving_booking", "commit:cancel_order", "commit:update_order"}
)
logger = logging.getLogger(__name__)
WEEKDAYS = ("thứ hai", "thứ ba", "thứ tư", "thứ năm", "thứ sáu", "thứ bảy", "chủ nhật")


class DraftFact(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: str
    value: str | int | float | bool | list[str] | RoommateSearchCriteria = Field(
        description="Use a plain string for city, district, near, addresses, route endpoints, housing_mode, map_mode, route_profile, dates and time. Arrays for listing_ids, must_have, nearby_categories and map_categories. Numbers for prices/counts."
    )
    evidence: str = Field(
        description="Exact contiguous substring copied from latest user message, no added punctuation or JSON delimiters."
    )
    suggestion_key: str | None


class IntakeDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["new_goal", "refine", "change", "unsupported"] = Field(
        description="Relationship of latest message to active goal: answering a question is refine/change, NOT new_goal. Explicitly abandoning prior goal starts new_goal."
    )
    normalized_goal: str
    intent_name: str | None
    domains: list[AgentName]
    requested_actions: list[DraftFact] = Field(
        description="Explicit booking/cancel/update intent only. key=commit:moving_booking etc, value=true, evidence=exact user's action words. Empty for search/quote or negation. This expresses intent, NEVER transaction approval."
    )
    facts: list[DraftFact]
    housing_comparison_evidence: str | None = Field(
        default=None,
        description="If the latest user asks to COMPARE homes, copy that exact request span here, even if no listing IDs are identifiable or a new area/budget is mentioned. Null for a search-only request. A comparison must not be silently downgraded to search.",
    )
    unsupported_reason: str | None = Field(
        description="Only for kind=unsupported: one short Vietnamese sentence telling the user what is not supported and what is (e.g. amenities only as a condition when searching homes). Null otherwise."
    )
    drops_previous_goal: bool = Field(
        description="True only when the user explicitly abandons or cancels the earlier goal in this message (e.g. 'thôi không tìm nhà nữa'). Asking for an additional service (flight, moving) while the earlier goal stands is false."
    )
    map_origin: Literal["named_place", "housing_results", "selected_home", "none"] = Field(
        description="Where a requested Map nearby search is centred: named_place = a place the user names (map_near holds it); housing_results = homes found by the Housing search in this goal (e.g. 'gần các phòng đó'); selected_home = the home already chosen; none = no Map nearby search."
    )
    conflicts: list[str]
    change_request: str | None
    target_task_ids: list[str]
    declined_suggestions: list[str]
    retrieval_only: bool = Field(
        default=False,
        description="Unranked property-filter search or safe filter edit/refresh; no analysis, selection, comparison or other services. When unsure false.",
    )
    housing_filter_patch: HousingFilterPatch | None = Field(
        default=None,
        description="Follow-up only: explicit add/remove amenities or clear named optional Housing filters, with exact latest-message evidence. Unchanged filters stay; numeric/place changes use facts. Never clear IDs, city, coordinates or modes.",
    )


class ScalarDraftFact(DraftFact):
    """No nested Roommate schema when the service is not registered."""

    value: str | int | float | bool | list[str]


class ScalarIntakeDraft(IntakeDraft):
    facts: list[ScalarDraftFact]
    requested_actions: list[ScalarDraftFact]


def valid_value(key: str, value) -> bool:
    if key in {"housing_select_ids", "housing_unselect_ids"}:
        return (
            isinstance(value, list)
            and 1 <= len(value) <= 10
            and all(isinstance(v, str) and v for v in value)
            and len(set(value)) == len(value)
        )
    if key == "listing_ids":
        return (
            isinstance(value, list)
            and 2 <= len(value) <= 4
            and all(isinstance(v, str) and v for v in value)
            and len(set(value)) == len(value)
        )
    if key == "roommate_criteria":
        try:
            RoommateSearchCriteria.model_validate(value)
            return True
        except (ValueError, TypeError):
            return False
    if not fact_fits_capabilities(key, value):
        return False
    if key == "moving_mode":
        return value in {"catalog", "quote", "order_status"}
    if key == "map_mode":
        return value in {"route", "nearby"}
    if key == "route_profile":
        return value in {"walking", "motorcycle", "driving"}
    if key in NUMBER_KEYS:
        return type(value) in (int, float) and 0 <= value <= 1_000_000
    if key in TEXT_KEYS:
        return isinstance(value, str) and 0 < len(value) <= 500
    if key in INT_KEYS:
        return type(value) is int and value >= (1 if key in {"passengers", "household_size"} else 0)
    if key in BOOL_KEYS:
        return type(value) is bool
    if key in {"must_have", "nearby_categories", "map_categories"}:
        allowed = AMENITIES if key == "must_have" else CATEGORIES
        return isinstance(value, list) and all(isinstance(v, str) and v in allowed for v in value)
    if key == "trip_type":
        return value in {"one_way", "round_trip"}
    if key in {"flight_date", "return_date", "move_date"}:
        try:
            return isinstance(value, str) and date.fromisoformat(value).isoformat() == value
        except ValueError:
            return False
    if key == "move_time":
        return isinstance(value, str) and bool(re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", value))
    return False


def explicit_date_evidence(value: str, evidence: str, text: str) -> str:
    """Reconcile an ISO-echoed date with the identical explicit DD/MM/YYYY.

    No relative-date guessing or recovery of arbitrary invented evidence.
    """
    if evidence.strip().casefold() not in {value, "ngày " + value}:
        return evidence
    for match in re.finditer(r"(?<!\d)(\d{1,2})/(\d{1,2})/(\d{4})(?!\d)", text):
        day, month, year = map(int, match.groups())
        try:
            if date(year, month, day).isoformat() == value:
                return match.group(0)
        except ValueError:
            continue
    return evidence


def exact_bedroom_count(text: str) -> int | None:
    """Audit an explicit 'có N phòng ngủ'; never infer ranges or negations."""
    text = nfc(text).casefold()
    matches = list(re.finditer(r"\bcó\s+(\d+)\s+phòng\s+ngủ\b", text))
    if len(matches) != 1:
        return None
    match = matches[0]
    prefix, suffix = text[max(0, match.start() - 30) : match.start()], text[match.end() : match.end() + 25]
    if re.search(r"không|đừng|tránh|chẳng|ít nhất|tối thiểu|tối đa", prefix):
        return None
    if re.match(r"\s*(trở lên|trở xuống|hoặc|hay|đến)", suffix):
        return None
    return int(match.group(1))


class LlmIntake(UsageOwner):
    def __init__(
        self,
        llm: StructuredLLM,
        clock: Callable[[], datetime] = utcnow,
        *,
        max_calls: int = 5,
        enable_filter_fast_path: bool = True,
    ):
        super().__init__()
        if max_calls < 1:
            raise ValueError("max_calls must be positive")
        self.llm, self.clock, self.max_calls = llm, clock, min(MAX_REPAIR_CALLS, max_calls)
        self.enable_filter_fast_path = enable_filter_fast_path

    async def understand(self, inp: IntakeInput) -> IntakeResult:
        run = Invocation(max_calls=self.max_calls)
        self._usage.set(run.usage)
        messages = [
            {"role": "user" if isinstance(m, HumanMessage) else "assistant", "text": str(m.content)[:2000]}
            for m in inp.messages[-10:]
            if isinstance(m, (HumanMessage, AIMessage))
        ]
        messages = public_data(messages)
        latest_user = next((m["text"] for m in reversed(messages) if m["role"] == "user"), "")
        previous = inp.previous
        today = self.clock().astimezone(timezone(timedelta(hours=7)))
        schema = IntakeDraft if AgentName.ROOMMATE in inp.supported_domains else ScalarIntakeDraft
        instructions = prompt_for(inp.supported_domains)
        data = {
            "today": today.isoformat(),
            # Computed dates: the model looks relative days up here instead of doing calendar arithmetic.
            "calendar": [
                {
                    "date": (today + timedelta(days=i)).date().isoformat(),
                    "weekday": WEEKDAYS[(today + timedelta(days=i)).weekday()],
                }
                for i in range(15)
            ],
            "messages": messages,
            "latest_user_message": latest_user,
            "supported_domains": inp.supported_domains,
            "previous": {
                "normalized_goal": previous.normalized_goal,
                "intent": previous.intent.model_dump() if previous.intent else None,
                "constraints": previous.constraints.values,
                "selected_property": (
                    previous.user_confirmed_facts["selected:property"].value
                    if "selected:property" in previous.user_confirmed_facts
                    else None
                ),
            }
            if previous
            else None,
            "is_first_turn": previous is None,
            "map_view_available": inp.map_view_available,
            "verified_place_choice": inp.verified_place_choice,
            "verified_moving_locations": inp.verified_moving_locations,
            "plan_outline": [p.model_dump() for p in inp.plan_outline or []],
            "last_housing_search_options": inp.last_housing_search_options,
            "housing_selection": inp.housing_selection,
            "pending_questions": [q.model_dump() for q in inp.pending_questions],
            "last_suggestions": [s.model_dump() for s in inp.last_suggestions],
            "amenities": sorted(AMENITIES),
            "categories": sorted(CATEGORIES),
            "required_fields": {
                d.value: [list(r.fields) for r in requirements]
                for d, requirements in REQUIRED_INPUTS.items()
                if d in inp.supported_domains
            },
            "map_contract": {
                "route": ["map_mode=route", "route_from", "route_to", "city"],
                "nearby": ["map_mode=nearby", "map_categories", "map_near or grounded housing reference"],
                "note": "Housing proximity FILTER is distinct from Map EXPLORATION around a place or homes.",
            },
            "moving_contract": {
                "catalog": ["moving_mode=catalog"],
                "quote": ["from_address", "to_address (or selected housing)", "move_date", "move_time"],
                "order_status": ["order_id or tracking_number"],
            },
            "allowed_fact_keys": sorted(
                (VALUE_KEYS if AgentName.ROOMMATE in inp.supported_domains else VALUE_KEYS - {"roommate_criteria"})
                | COMMIT_KEYS
                | {"selected:property", "selected:map", "selected:flight", "selected:relocation"}
            ),
        }
        for attempt in range(run.max_calls):
            draft = await run.parse(self.llm, instructions, data, schema)
            result, rejected = self._convert(draft, inp, latest_user)
            bedrooms = exact_bedroom_count(latest_user)
            if AgentName.PROPERTY in result.domains and bedrooms is not None:
                # Canonical equality is [N, N], not merely >= N. Fill the absent
                # bound only from an already-grounded bound AND explicit equality
                # wording. Never overwrite a conflicting bound or guess a count.
                for target, source in (("max_bedrooms", "min_bedrooms"), ("min_bedrooms", "max_bedrooms")):
                    fact = result.user_confirmed_facts.get(source)
                    if target not in result.constraints.values and fact and fact.value == bedrooms:
                        result.user_confirmed_facts[target] = fact.model_copy(deep=True)
                        result.constraints.values[target] = bedrooms
                for key in ("min_bedrooms", "max_bedrooms"):
                    if result.constraints.values.get(key) != bedrooms:
                        rejected.append(
                            f"{key}: explicit exact bedroom count requires {key}={bedrooms}; do not interpret as a minimum only"
                        )
            if rejected:
                logger.warning("Intake rejected fields (attempt %s): %s", attempt + 1, rejected)
            values = {
                **(previous.constraints.values if previous and result.kind != RequestKind.NEW_GOAL else {}),
                **result.constraints.values,
            }
            confirmed = {
                **(previous.user_confirmed_facts if previous and result.kind != RequestKind.NEW_GOAL else {}),
                **result.user_confirmed_facts,
            }
            runnable = bool(result.domains) and all(
                not missing_for(d, values, set(result.domains), confirmed) for d in result.domains
            )
            # Ask the model to re-evaluate a proposed clarification against the
            # actual service contract; do not blindly delete real conflicts.
            review_conflicts = bool(result.conflicts) and runnable
            if rejected and attempt + 1 == run.max_calls:
                result.conflicts.append("Có dữ kiện chưa xác minh được từ lời bạn; vui lòng diễn đạt lại yêu cầu.")
            if (not rejected and not review_conflicts) or attempt + 1 == run.max_calls:
                return result
            data["repair"] = "Trích lại: có fact sai kiểu, ID hoặc evidence không nguyên văn. Chỉ giữ fact hợp lệ."
            data["rejected_draft"] = draft.model_dump(mode="json")
            data["repair"] += " Evidence chỉ chứa chữ nguyên văn trong user message; không thêm },{ hoặc dấu ngoặc."
            data["rejected_fields"] = rejected
            data["repair"] += (
                " Dùng latest_user_message làm nguồn duy nhất cho evidence mới. Không viết lại số bằng chữ,"
                " không đổi thứ tự từ hoặc định dạng ngày trong evidence. Nếu khó chép đoạn ngắn,"
                " được chép nguyên latest_user_message làm evidence (không thêm dấu ngoặc hay dấu câu)."
            )
            data["repair"] += (
                " Nếu đủ required_fields, KHÔNG hỏi thêm field tùy chọn trong conflicts. Chỉ giữ mâu thuẫn thật trong lời user, không hỏi quận khi đã có thành phố."
            )
            data["merged_valid_constraints"] = values
            data["confirmed_selections"] = {
                key: fact.value for key, fact in confirmed.items() if key.startswith("selected:")
            }
        raise ValueError("Intake needs at least one LLM call")

    def _convert(self, draft: IntakeDraft, inp: IntakeInput, user_text: str) -> tuple[IntakeResult, list[str]]:
        facts: dict[str, ConfirmedFact] = {}
        rejected: list[str] = []
        allowed_options = {
            f"selected:{p.agent.value}": {str(o.get("option_id")) for o in p.options} for p in inp.plan_outline or []
        }
        observed_homes = {
            str(o.get("option_id"))
            for p in inp.plan_outline or []
            if p.agent == AgentName.PROPERTY
            for o in (p.comparison_options or p.options)
        }
        suggestions = {s.key: s for s in inp.last_suggestions}
        observed_homes.update(o["option_id"] for o in inp.last_housing_search_options)
        candidates = [f for f in draft.facts[:60] if f.key not in COMMIT_KEYS]
        candidates += [f for f in draft.requested_actions[:4] if f.key in COMMIT_KEYS]
        for f in candidates:
            try:
                value = (
                    f.value.model_dump(mode="json", exclude_none=True)
                    if isinstance(f.value, RoommateSearchCriteria)
                    else f.value
                )
                if f.key in facts and facts[f.key].value == value:
                    continue  # Identical duplicate is harmless; keep the first grounded evidence.
                if f.key in {"flight_date", "return_date", "move_date"} and valid_value(f.key, value):
                    f = f.model_copy(update={"evidence": explicit_date_evidence(value, f.evidence, user_text)})
                # Models sometimes echo already-confirmed fields from history.
                # Ignore unchanged echoes; the graph carries the original grounded
                # fact and timestamp, without requiring users to repeat it.
                old = inp.previous.user_confirmed_facts.get(f.key) if inp.previous else None
                if (
                    draft.kind != "new_goal"
                    and old
                    and old.value == value
                    and nfc(f.evidence).lower() not in nfc(user_text).lower()
                ):
                    continue
                valid = (
                    valid_value(f.key, value)
                    if f.key in VALUE_KEYS
                    else (
                        value is True
                        if f.key in COMMIT_KEYS
                        else isinstance(value, str) and value in allowed_options.get(f.key, set())
                    )
                )
                if f.key == "listing_ids":
                    valid = valid and isinstance(value, list) and set(value) <= observed_homes
                if f.key == "housing_select_ids":
                    valid = valid and set(value) <= observed_homes
                if f.key == "housing_unselect_ids":
                    valid = valid and set(value) <= {str(h.get("listing_id")) for h in inp.housing_selection}
                if (
                    not valid
                    or f.key in facts
                    or not f.evidence.strip()
                    or nfc(f.evidence).lower() not in nfc(user_text).lower()
                ):
                    rejected.append(
                        f"{f.key}: valid_value={valid}, received_type={type(value).__name__}, "
                        f"expected={'plain string' if f.key in TEXT_KEYS else 'key-specific type'}, duplicate={f.key in facts}, "
                        f"evidence_matches={bool(f.evidence.strip()) and nfc(f.evidence).lower() in nfc(user_text).lower()}"
                    )
                    continue
                if f.suggestion_key is not None and f.suggestion_key not in suggestions:
                    rejected.append(f"{f.key}: unknown suggestion key")
                    continue
                facts[f.key] = ConfirmedFact(
                    value=value, evidence=f.evidence, stated_at=self.clock(), suggestion_key=f.suggestion_key
                )
            except (ValueError, TypeError):
                rejected.append(f"{f.key}: invalid fact")
        anchor = MAP_ENTITY_ANCHORS.get(draft.map_origin)
        if draft.housing_comparison_evidence is not None:
            evidence = draft.housing_comparison_evidence.strip()
            if not evidence or nfc(evidence).casefold() not in nfc(user_text).casefold():
                rejected.append("housing_comparison_evidence: must be a span from latest user message")
            else:
                facts["housing_mode"] = ConfirmedFact(value="compare", evidence=evidence, stated_at=self.clock())
        if anchor and "map_near" in facts and facts["map_near"].value != anchor:
            # The origin is an entity the graph binds (dependency or selected ID), never a place name to geocode.
            facts["map_near"] = facts["map_near"].model_copy(update={"value": anchor})
        grounded = ground_facts(facts, {}, RequestKind.NEW_GOAL, [user_text], list(suggestions))
        facts = grounded.facts
        rejected.extend(f"{k}: evidence/PII validation rejected" for k in grounded.dropped)
        domains = (
            list(dict.fromkeys(d for d in draft.domains if d in inp.supported_domains))
            if draft.kind != "unsupported"
            else []
        )
        if (
            AgentName.PROPERTY in domains
            and AgentName.MAP in domains
            and "nearby_categories" in facts
            and "map_categories" not in facts
            and draft.map_origin == "housing_results"
        ):
            # An amenity constraint on homes is handled by Housing itself.
            domains.remove(AgentName.MAP)
            facts.pop("map_near", None)
        # A nearby Map request is a valid domain task. Do not silently turn
        # exploration around an already chosen home into a new Housing search.
        kind = RequestKind(draft.kind) if domains else RequestKind.UNSUPPORTED
        if (
            kind == RequestKind.NEW_GOAL
            and not draft.drops_previous_goal
            and inp.previous is not None
            and inp.previous.domains
            and not set(domains) & set(inp.previous.domains)
        ):
            # A different service added to a goal the user did not abandon extends that goal: its
            # choices and results stay. Abandoning is the model's typed decision, not a phrase list.
            kind = RequestKind.REFINE
            domains = list(dict.fromkeys([*inp.previous.domains, *domains]))
        task_ids = {p.id for p in inp.plan_outline or []}
        targets = (
            inp.decision.target_task_ids if inp.decision and inp.decision.target_task_ids else draft.target_task_ids
        )
        patch = draft.housing_filter_patch
        if patch is not None and not (
            inp.previous is not None
            and kind in {RequestKind.REFINE, RequestKind.CHANGE}
            and AgentName.PROPERTY in domains
            and (
                facts["housing_mode"].value
                if "housing_mode" in facts
                else inp.previous.constraints.values.get("housing_mode", "search")
            )
            == "search"
            and valid_filter_patch(patch, user_text, {k: f.value for k, f in facts.items()})
        ):
            rejected.append("housing_filter_patch: invalid filter edit or latest-message evidence")
            patch = None
        result = IntakeResult(
            kind=kind,
            normalized_goal=public_data(draft.normalized_goal),
            retrieval_only=(
                draft.retrieval_only
                and self.enable_filter_fast_path
                and draft.domains == [AgentName.PROPERTY]
                and draft.housing_comparison_evidence is None
            ),
            housing_filter_patch=patch,
            intent=Intent(name=draft.intent_name or "request", domains=domains) if domains else None,
            constraints=Constraints(
                values={k: f.value for k, f in facts.items() if k in VALUE_KEYS} if domains else {}
            ),
            user_confirmed_facts=facts if domains else {},
            conflicts=public_data(list(dict.fromkeys([*draft.conflicts, *grounded.conflicts]))[:3]),
            change_request=public_data(draft.change_request) if kind == RequestKind.CHANGE else None,
            target_task_ids=[t for t in targets if t in task_ids],
            declined_suggestions=[k for k in draft.declined_suggestions if k in suggestions],
            unsupported_reason=public_data(draft.unsupported_reason or "")[:300] or None
            if kind == RequestKind.UNSUPPORTED
            else None,
        )
        return result, rejected
