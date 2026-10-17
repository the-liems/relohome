"""Intake: contract, quy tắc hỏi ngay / hỏi sau và kiểm dữ kiện (agent-graph.md §6.1).

Logic hiểu ngôn ngữ nằm trong implementation của `Intake` (LLM, làm ở issue Intake). Phần ở đây là
code thuần mà node `intake` chạy sau đó: kiểm evidence (lấy từ `normalize()` nhánh `khoa`), lọc dữ
liệu cá nhân, gộp dữ kiện qua các lượt và `resolve_missing`.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Protocol

from pydantic import BaseModel, ConfigDict
from relohome_agent.agents.common import nfc
from relohome_agent.agents.memory import prefill_from_memory
from relohome_agent.agents.models import (
    AgentName,
    CommitActionKind,
    ConfirmedFact,
    Constraints,
    IntakeResult,
    Plan,
    Question,
    RequestKind,
    SessionContext,
    Suggestion,
    TaskOutline,
    UserDecision,
)
from relohome_privacy import contains_contact_pii, looks_like_pii
from relohome_privacy import redact_pii as redact_pii


class IntakeInput(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    messages: list[Any]  # AnyMessage của LangChain
    session: SessionContext
    previous: IntakeResult | None = None
    plan_outline: list[TaskOutline] | None = None
    last_housing_search_options: list[dict[str, str]] = []
    # Căn đang chọn để hẹn xem (ID/nhãn), khi bật housing-viewing; agent dùng để bỏ hoặc đổi căn qua chat.
    housing_selection: list[dict] = []
    decision: UserDecision | None = None
    pending_questions: list[Question] = []
    last_suggestions: list[Suggestion] = []
    supported_domains: list[AgentName] = []
    map_view_available: bool = False  # client đang hiển thị bản đồ và đã gửi khung xem (API kiểm)
    verified_place_choice: dict[str, Any] | None = None  # API-revalidated UI selection, not model-authored facts
    verified_moving_locations: dict[str, Any] | None = None  # validated confirmed user pins, never model coordinates


# Giá trị tham chiếu của `near` khi người dùng nói "khu này", "khu đang xem" trên bản đồ. Node thay bằng
# `bounding_box` mà API đã kiểm; LLM không bao giờ tự sinh toạ độ.
MAP_VIEW_REF = "current:map_view"
# Map nearby origins that are entities bound by the graph, not place names (Intake `map_origin`):
# the homes found by Housing in this goal (dependency) or the home already chosen (listing ID).
MAP_ENTITY_ANCHORS = {"housing_results": "upstream:property", "selected_home": "selected:property"}


def entity_reference(value: Any) -> str | None:
    """Marker for a value that names a graph entity rather than a place (never geocoded).

    Recognises the graph's own vocabulary only: entity markers and the `map_origin` labels a model
    may echo into a text field. User phrasing is classified by the typed `map_origin` field, not here."""
    if not isinstance(value, str):
        return None
    if value in MAP_ENTITY_ANCHORS.values() or value.startswith(("selected:", "upstream:")):
        return value
    return MAP_ENTITY_ANCHORS.get(value)


# Field địa điểm mà người dùng có thể chọn ứng viên trên bản đồ (`ChatRequest.place_choice`).
PLACE_CHOICE_FIELDS = ("near", "route_from", "route_to")
# Phạm vi tìm nhà trong một thành phố; câu mới nêu phạm vi nào thì thay phạm vi cũ (node intake).
SEARCH_SCOPE_KEYS = ("district", "near")
SCOPE_DEPENDENTS = {"near": ("near_coordinate", "near_place_id", "bounding_box"), "district": ("bounding_box",)}


class Intake(Protocol):
    async def understand(self, inp: IntakeInput) -> IntakeResult: ...


# --- Implementation giai đoạn khung ---


class PassThroughIntake:
    """Mặc định trong app cho tới khi có Intake thật: không hiểu gì, để Planner trả UNSUPPORTED."""

    async def understand(self, inp: IntakeInput) -> IntakeResult:
        text = inp.messages[-1].content if inp.messages else ""
        return IntakeResult(kind=RequestKind.NEW_GOAL, normalized_goal=str(text))


class FixedIntake:
    def __init__(self, result: IntakeResult):
        self.result = result
        self.inputs: list[IntakeInput] = []

    async def understand(self, inp: IntakeInput) -> IntakeResult:
        self.inputs.append(inp)
        return self.result.model_copy(deep=True)


class ScriptedIntake:
    """Mỗi lần gọi trả kết quả kế tiếp (test hỏi lại / đổi ý)."""

    def __init__(self, results: Iterable[IntakeResult]):
        self.results = list(results)
        self.inputs: list[IntakeInput] = []

    async def understand(self, inp: IntakeInput) -> IntakeResult:
        self.inputs.append(inp)
        if not self.results:
            raise RuntimeError("ScriptedIntake has no more results")
        return self.results.pop(0).model_copy(deep=True)


# --- Khoá fact đặc biệt ---


def commit_fact_key(kind: CommitActionKind) -> str:
    return f"commit:{kind.value}"


def selected_fact_key(agent: AgentName) -> str:
    return f"selected:{agent.value}"


def fact_values(facts: dict[str, ConfirmedFact]) -> dict[str, Any]:
    """Giá trị constraint từ dữ kiện đã xác nhận (bỏ fact `commit:` / `selected:`)."""
    return {k: f.value for k, f in facts.items() if ":" not in k}


# --- Kiểm dữ kiện (§6.1 bước 2) ---

PII_FACT_KEYS = frozenset(
    {
        "full_name",
        "name",
        "first_name",
        "last_name",
        "date_of_birth",
        "dob",
        "birthday",
        "id_number",
        "cccd",
        "cmnd",
        "passport",
        "email",
        "phone",
        "mobile",
        "phone_number",
        "contact",
        "passengers_detail",
    }
)
AFFIRMATIVES = frozenset({"có", "ừ", "ừa", "ok", "oke", "okay", "yes", "được", "đồng ý", "uh", "ừm"})


@dataclass
class GroundedFacts:
    facts: dict[str, ConfirmedFact]
    dropped: list[str]
    conflicts: list[str]


# Tên hiển thị của khóa dữ kiện trong câu hỏi lại; khóa không có ở đây hiện nguyên tên.
FACT_LABELS = {
    "city": "thành phố",
    "district": "quận/huyện",
    "near": "địa điểm gần",
    "search_radius_m": "bán kính tìm nhà",
    "min_price_vnd": "giá tối thiểu",
    "max_price_vnd": "ngân sách tối đa",
    "room_type": "loại phòng",
    "min_bedrooms": "số phòng ngủ tối thiểu",
    "max_bedrooms": "số phòng ngủ tối đa",
    "origin": "nơi đi",
    "destination": "nơi đến",
    "flight_date": "ngày bay",
    "return_date": "ngày bay về",
    "trip_type": "loại vé (một chiều/khứ hồi)",
    "passengers": "số hành khách",
    "from_address": "điểm lấy đồ",
    "to_address": "điểm giao đồ",
    "move_date": "ngày chuyển đồ",
    "move_time": "giờ chuyển đồ",
    "route_from": "điểm đi",
    "route_to": "điểm đến",
    "route_profile": "phương tiện",
    "nearby_categories": "loại tiện ích",
    "nearby_radius_m": "bán kính",
    "map_categories": "tiện ích muốn xem",
    "map_radius_m": "bán kính xem tiện ích",
}


def _shown(value: Any) -> str:
    if value == "selected:property":
        return "căn nhà bạn đã chọn"
    return ", ".join(map(str, value)) if isinstance(value, list) else str(value)


def ground_facts(
    new: dict[str, ConfirmedFact],
    previous: dict[str, ConfirmedFact],
    kind: RequestKind,
    user_texts: list[str],
    suggestion_keys: list[str],
    selector_keys: frozenset[str] = frozenset(),
) -> GroundedFacts:
    """Chỉ giữ fact có evidence là chuỗi con của tin nhắn **người dùng** (sau NFC), không phải dữ liệu
    cá nhân, và gộp với dữ kiện cũ. Dữ kiện đã xác nhận chỉ bị ghi đè khi `CHANGE` (hoặc mục tiêu mới).

    `selector_keys` (từ `operation_selector_keys` của các manifest) chọn thao tác của lĩnh vực trong lượt
    này, ví dụ Map `route` thay vì `nearby`: giá trị mới thay giá trị cũ, không phải mâu thuẫn."""
    corpus = nfc("\n".join(user_texts)).lower()
    kept: dict[str, ConfirmedFact] = {}
    dropped: list[str] = []
    conflicts: list[str] = []
    for name, fact in new.items():
        evidence = nfc(fact.evidence).strip().lower()
        # A typed amount/count is not a phone number merely because it has 9+ digits.
        numeric_constraint = (
            name
            in {
                "min_price_vnd",
                "max_price_vnd",
                "budget_vnd",
                "household_size",
                "passengers",
                "nearby_radius_m",
                "map_radius_m",
                "search_radius_m",
            }
            and type(fact.value) is int
        )
        # A transaction reference (payment/order/booking ID) is a long code by nature; only a value that is
        # itself an email or phone number is personal data there.
        reference = name in REFERENCE_KEYS or name == "listing_ids"
        personal = contains_contact_pii(fact.value) if reference else looks_like_pii(fact.value)
        if name in PII_FACT_KEYS or (not numeric_constraint and personal):
            dropped.append(name)
            continue
        if not evidence or evidence not in corpus:
            dropped.append(name)
            continue
        if fact.suggestion_key is not None:
            if fact.suggestion_key not in suggestion_keys:
                dropped.append(name)
                continue
            if evidence in AFFIRMATIVES and len(suggestion_keys) > 1:
                conflicts.append("Bạn đồng ý với gợi ý nào?")
                continue
        kept[name] = fact
    if kind == RequestKind.NEW_GOAL:
        base: dict[str, ConfirmedFact] = {}
    else:
        base = dict(previous)
    for name, fact in kept.items():
        old = base.get(name)
        if old is None or old.value == fact.value or kind == RequestKind.CHANGE or name in selector_keys:
            base[name] = fact
        else:
            conflicts.append(
                f"Bạn muốn đổi {FACT_LABELS.get(name, name)} từ “{_shown(old.value)}” "
                f"thành “{_shown(fact.value)}” phải không?"
            )
    return GroundedFacts(base, dropped, conflicts)


# --- Quy tắc hỏi ngay / hỏi sau (D10) ---


@dataclass(frozen=True)
class Requirement:
    fields: tuple[str, ...]  # có một trong các field là đủ
    derived_from: AgentName | None = None  # suy ra từ task của lĩnh vực khác (S3)
    needs_selection: bool = False  # suy ra từ lựa chọn của người dùng (S4)


REQUIRED_INPUTS: dict[AgentName, tuple[Requirement, ...]] = {
    AgentName.PAYMENT: (Requirement(("payment_id",)),),
    AgentName.PROPERTY: (Requirement(("city", "near", "district")),),
    AgentName.RELOCATION: (
        Requirement(("from_address",)),
        Requirement(("to_address",), derived_from=AgentName.PROPERTY, needs_selection=True),
        Requirement(("move_date",)),
        Requirement(("move_time",)),  # không tự chọn giờ (phản hồi của service Moving)
    ),
    AgentName.FLIGHT: (
        Requirement(("origin",)),
        Requirement(("destination",), derived_from=AgentName.PROPERTY),
        Requirement(("flight_date",)),
    ),
    AgentName.MAP: (Requirement(("near",), derived_from=AgentName.PROPERTY),),
}

# Tra cứu đơn đã đặt (S10) không cần input tìm kiếm.
LOOKUP_KEYS: dict[AgentName, tuple[str, ...]] = {
    AgentName.PAYMENT: ("payment_id",),
    AgentName.RELOCATION: ("order_id", "tracking_number"),
    AgentName.FLIGHT: ("booking_ref",),
}

# Identifier facts that look up the user's own transaction (domains' lookup inputs).
REFERENCE_KEYS = frozenset(k for keys in LOOKUP_KEYS.values() for k in keys)

DEFAULT_COST_TIERS = {
    AgentName.PAYMENT: "cheap",
    AgentName.ROOMMATE: "cheap",
    AgentName.PROPERTY: "cheap",
    AgentName.MAP: "cheap",
    AgentName.RELOCATION: "paid",
    AgentName.FLIGHT: "paid",
}


def _has(values: dict[str, Any], key: str) -> bool:
    return values.get(key) not in (None, "", [], {})


def missing_for(
    domain: AgentName, values: dict[str, Any], sources: set[AgentName], facts: dict[str, ConfirmedFact]
) -> list[str]:
    """Input bắt buộc còn thiếu của task thuộc `domain`, dạng "domain.field"."""
    if domain == AgentName.PROPERTY and values.get("housing_mode") == "compare":
        return (
            []
            if isinstance(values.get("listing_ids"), list) and 2 <= len(values["listing_ids"]) <= 4
            else ["property.listing_ids"]
        )
    if any(_has(values, k) for k in LOOKUP_KEYS.get(domain, ())):
        return []
    if domain == AgentName.RELOCATION:
        if values.get("moving_mode") == "catalog":
            return []
        selected_endpoint = any(values.get(k) == "selected:property" for k in ("from_address", "to_address"))
        missing = []
        if selected_endpoint and "selected:property" not in facts:
            missing.append("relocation.selected:property")
        for key in ("from_address", "to_address", "move_date", "move_time"):
            if _has(values, key):
                continue
            if (
                key == "to_address"
                and AgentName.PROPERTY in sources
                and values.get("from_address") != "selected:property"
            ):
                if "selected:property" not in facts:
                    missing.append("relocation.selected:property")
                continue
            missing.append(f"relocation.{key}")
        return missing
    if domain == AgentName.PROPERTY and _has(values, "bounding_box"):
        return []  # khung bản đồ đang xem là phạm vi tìm kiếm đủ dùng
    if domain == AgentName.MAP and values.get("map_mode") == "route":
        missing = [f"map.{k}" for k in ("route_from", "route_to") if not _has(values, k)]
        if not _has(values, "map_city") and not _has(values, "city"):
            missing.append("map.city")
        if (
            any(values.get(k) == "selected:property" for k in ("route_from", "route_to"))
            and "selected:property" not in facts
        ):
            missing.append("map.selected:property")
        return missing
    if domain == AgentName.FLIGHT and values.get("trip_type") == "round_trip" and not _has(values, "return_date"):
        # Khứ hồi cần ngày về trước khi tìm (chế độ khứ hồi của SerpApi); các field khác kiểm như thường.
        base = [m for m in missing_for(domain, {**values, "trip_type": "one_way"}, sources, facts)]
        return [*base, "flight.return_date"]
    if domain == AgentName.MAP and _has(values, "map_near"):
        return []
    if domain == AgentName.MAP and "selected:property" in facts and not _has(values, "near"):
        return []
    out = []
    for req in REQUIRED_INPUTS.get(domain, ()):
        if any(_has(values, f) for f in req.fields):
            continue
        if req.derived_from is not None and req.derived_from in sources:
            if req.needs_selection and selected_fact_key(req.derived_from) not in facts:
                out.append(f"{domain.value}.{selected_fact_key(req.derived_from)}")
            continue
        out.append(f"{domain.value}.{'|'.join(req.fields)}")
    return out


def depends_on_other(domain: AgentName, domains: list[AgentName], values: dict[str, Any]) -> bool:
    if domain == AgentName.RELOCATION and any(
        values.get(k) == "selected:property" for k in ("from_address", "to_address")
    ):
        return False  # A confirmed listing ID can be fetched directly by Moving.
    return any(
        req.derived_from in domains and not any(_has(values, f) for f in req.fields)
        for req in REQUIRED_INPUTS.get(domain, ())
        if req.derived_from is not None
    )


def resolve_missing(
    result: IntakeResult,
    *,
    session: SessionContext,
    plan: Plan | None,
    cost_tiers: dict[AgentName, str],
    prefill_ttl: dict[str, timedelta],
    now: datetime,
) -> IntakeResult:
    """Tính lại phần thiếu bằng code, không tin vào LLM (§6.1 bước 3).

    Ghi `constraints.values` (kể cả giá trị tự điền), `prefilled`, `blocking_missing` và
    `constraints.missing`. Chỉ hỏi ngay khi **không task nào** trong yêu cầu chạy được.
    """
    domains = result.domains
    tiers = {**DEFAULT_COST_TIERS, **cost_tiers}
    stated = {**fact_values(result.user_confirmed_facts), **result.constraints.values}
    prefilled = prefill_from_memory(
        stated,
        session,
        domains,
        tiers,
        prefill_ttl,
        now,
        excluded_housing_fields=frozenset(result.housing_prefill_exclusions),
    )
    values = {**stated, **{k: v.value for k, v in prefilled.items()}}
    sources = set(domains) | ({t.agent for t in plan.tasks} if plan else set())
    missing = {d: missing_for(d, values, sources, result.user_confirmed_facts) for d in domains}
    runnable = [d for d in domains if not missing[d]]
    blocking: list[str] = []
    later: list[str] = []
    if domains and not runnable:
        roots = [d for d in domains if not depends_on_other(d, domains, values)] or domains
        for d in roots:
            blocking.extend(missing[d])
    else:
        for d in domains:
            later.extend(missing[d])
    return result.model_copy(
        update={
            "constraints": Constraints(values=values, missing=list(dict.fromkeys(later))),
            "prefilled": prefilled,
            "blocking_missing": list(dict.fromkeys(blocking)),
        }
    )
