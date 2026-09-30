"""Intake: contract, quy tắc hỏi ngay / hỏi sau và kiểm dữ kiện (agent-graph.md §6.1).

Logic hiểu ngôn ngữ nằm trong implementation của `Intake` (LLM, làm ở issue Intake). Phần ở đây là
code thuần mà node `intake` chạy sau đó: kiểm evidence (lấy từ `normalize()` nhánh `khoa`), lọc dữ
liệu cá nhân, gộp dữ kiện qua các lượt và `resolve_missing`.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Protocol

from pydantic import BaseModel, ConfigDict

from src.agents.common import nfc
from src.agents.memory import prefill_from_memory
from src.agents.models import (
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


class IntakeInput(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    messages: list[Any]  # AnyMessage của LangChain
    session: SessionContext
    previous: IntakeResult | None = None
    plan_outline: list[TaskOutline] | None = None
    decision: UserDecision | None = None
    pending_questions: list[Question] = []
    last_suggestions: list[Suggestion] = []
    supported_domains: list[AgentName] = []


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
_EMAIL = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")
_LONG_DIGITS = re.compile(r"\d{9,}")
AFFIRMATIVES = frozenset({"có", "ừ", "ừa", "ok", "oke", "okay", "yes", "được", "đồng ý", "uh", "ừm"})


_PHONE = re.compile(r"(?<![\d.])(?:\+84|0)(?:[\s.-]?\d){8,10}(?![\d.])")
_ID_NUMBER = re.compile(r"(?<!\d)\d{12}(?!\d)")  # CCCD


def redact_pii(text: str) -> str:
    """Che email, SĐT, số CCCD trước khi gửi tin nhắn cho LLM (D16). Không nhận diện được họ tên: người
    dùng được hướng nhập thông tin cá nhân qua form, không qua chat."""
    text = _EMAIL.sub("[email]", text)
    text = _ID_NUMBER.sub("[số giấy tờ]", text)
    return _PHONE.sub("[số điện thoại]", text)


# Tên viết tắt địa danh: MVP không tự hiểu (Location không có alias), phải hỏi lại tên đầy đủ.
LOCATION_KEYS = ("city", "near", "from_address", "to_address", "origin", "destination")
_ABBREVIATION = re.compile(
    r"(?<![\wÀ-ỹ])(?:[QqPp]\.?\s?\d{1,2}|[QqPp]\.|TP\.?\s?HCM|TPHCM|HCM|SG|HN|ĐN|DN|BV|ĐHQG|ĐH|DH|KTX|CĐ|TTTM|KCN|KĐT)"
    r"(?![\wÀ-ỹ])"
)


def abbreviation_questions(values: dict[str, Any]) -> list[str]:
    """Câu hỏi lại cho mỗi tên viết tắt trong field địa danh / địa chỉ (không tự diễn giải)."""
    found: list[str] = []
    for key in LOCATION_KEYS:
        text = values.get(key)
        if isinstance(text, str):
            found += [m.group(0).strip() for m in _ABBREVIATION.finditer(text)]
    return [
        f'"{token}" là viết tắt; bạn ghi đầy đủ giúp mình nhé (ví dụ "Quận 10", "Thành phố Hồ Chí Minh", '
        f'"Bệnh viện Chợ Rẫy").'
        for token in dict.fromkeys(found)
    ]


def looks_like_pii(value: Any) -> bool:
    text = str(value)
    return bool(_EMAIL.search(text) or _LONG_DIGITS.search(text.replace(" ", "").replace(".", "")))


@dataclass
class GroundedFacts:
    facts: dict[str, ConfirmedFact]
    dropped: list[str]
    conflicts: list[str]


def ground_facts(
    new: dict[str, ConfirmedFact],
    previous: dict[str, ConfirmedFact],
    kind: RequestKind,
    user_texts: list[str],
    suggestion_keys: list[str],
) -> GroundedFacts:
    """Chỉ giữ fact có evidence là chuỗi con của tin nhắn **người dùng** (sau NFC), không phải dữ liệu
    cá nhân, và gộp với dữ kiện cũ. Dữ kiện đã xác nhận chỉ bị ghi đè khi `CHANGE` (hoặc mục tiêu mới)."""
    corpus = nfc("\n".join(user_texts)).lower()
    kept: dict[str, ConfirmedFact] = {}
    dropped: list[str] = []
    conflicts: list[str] = []
    for name, fact in new.items():
        evidence = nfc(fact.evidence).strip().lower()
        # A typed amount/count is not a phone number merely because it has 9+ digits.
        numeric_constraint = (
            name in {"max_price_vnd", "budget_vnd", "household_size", "passengers", "nearby_radius_m"}
            and type(fact.value) is int
        )
        if name in PII_FACT_KEYS or (not numeric_constraint and looks_like_pii(fact.value)):
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
        if old is None or old.value == fact.value or kind == RequestKind.CHANGE:
            base[name] = fact
        else:
            conflicts.append(f"{name}: trước đó là {old.value!r}, giờ là {fact.value!r}")
    return GroundedFacts(base, dropped, conflicts)


# --- Quy tắc hỏi ngay / hỏi sau (D10) ---


@dataclass(frozen=True)
class Requirement:
    fields: tuple[str, ...]  # có một trong các field là đủ
    derived_from: AgentName | None = None  # suy ra từ task của lĩnh vực khác (S3)
    needs_selection: bool = False  # suy ra từ lựa chọn của người dùng (S4)


REQUIRED_INPUTS: dict[AgentName, tuple[Requirement, ...]] = {
    AgentName.PROPERTY: (Requirement(("city", "near")),),
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
    AgentName.RELOCATION: ("order_id", "tracking_number"),
    AgentName.FLIGHT: ("booking_ref",),
}

DEFAULT_COST_TIERS = {
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
    if any(_has(values, k) for k in LOOKUP_KEYS.get(domain, ())):
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
    prefilled = prefill_from_memory(stated, session, domains, tiers, prefill_ttl, now)
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
