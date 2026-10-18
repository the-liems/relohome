"""Kiểu dữ liệu của graph (agent-graph.md §5.3).

State top-level là TypedDict (`state.py`); mọi kiểu con ở đây là Pydantic v2 để validate output
của Intake, Planner và subagent. Mọi datetime là UTC có timezone.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict


class AgentName(StrEnum):
    PROPERTY = "property"  # Property Search & Knowledge
    RELOCATION = "relocation"  # Room Relocation (moving)
    FLIGHT = "flight"  # Flight / Travel
    MAP = "map"  # Map & Nearby Utility
    PAYMENT = "payment"  # Owned status reads only; writes remain controlled
    ROOMMATE = "roommate"  # Read-only people discovery; consent uses the private API.
    # Contract & Policy của sơ đồ v4 đã bỏ khỏi phạm vi (2026-09-28)


class RequestKind(StrEnum):
    NEW_GOAL = "new_goal"
    REFINE = "refine"
    CHANGE = "change"
    UNSUPPORTED = "unsupported"


class CommitActionKind(StrEnum):
    DEPOSIT = "deposit"  # NGOÀI PHẠM VI MVP (Q25); validate_plan từ chối
    MOVING_BOOKING = "moving_booking"
    FLIGHT_BOOKING = "flight_booking"
    CANCEL_ORDER = "cancel_order"
    UPDATE_ORDER = "update_order"


class TaskStatus(StrEnum):
    PENDING = "pending"
    READY = "ready"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"
    SKIPPED = "skipped"
    STALE = "stale"
    NEEDS_INPUT = "needs_input"


SourceKind = Literal["live", "sandbox", "demo", "fake"]
CostTier = Literal["cheap", "paid"]


# --- Kiểu dùng chung với contract subagent (§6.3) ---


class Quote(BaseModel):
    option_id: str
    label: str
    amount_vnd: int
    recurrence: Literal["one_time", "monthly"]


class LocationChoice(BaseModel):
    """Một ứng viên địa điểm do Location trả về; client hiển thị thành pin để người dùng chọn."""

    id: str  # canonical place_id hoặc area_id của Location
    label: str
    entity_type: str
    category: str | None = None
    lat: float | None = None
    lng: float | None = None


class Question(BaseModel):
    field: str
    text: str
    options: list[str] = []
    choices: list[LocationChoice] = []  # ứng viên địa điểm có ID và toạ độ thật (chọn trên bản đồ)
    blocking: bool = True
    reason: Literal["location_not_found", "location_ambiguous"] | None = None


class AgentUsage(BaseModel):
    llm_calls: int = 0
    tokens_in: int = 0
    tokens_out: int = 0
    provider_calls: int = 0
    cached_calls: int = 0


class AgentBudget(BaseModel):
    max_llm_calls: int
    max_provider_calls: int
    deadline_at: datetime | None = None


AgentErrorCode = Literal[
    "invalid_input",
    "unsupported_contract",
    "provider_unavailable",
    "provider_rejected",
    "timeout",
    "budget_exceeded",
    "internal",
]


class AgentError(BaseModel):
    code: AgentErrorCode
    message: str
    retryable: bool


# --- Phase 1: Understand & Plan ---


class Intent(BaseModel):
    name: str
    domains: list[AgentName]
    summary: str = ""


class Constraints(BaseModel):
    values: dict[str, Any] = {}
    missing: list[str] = []  # "domain.field"; thiếu nhưng không chặn lập plan, validator hỏi sau


class ConfirmedFact(BaseModel):
    value: Any
    evidence: str  # trích nguyên văn lời người dùng; node intake kiểm là chuỗi con của tin nhắn
    stated_at: datetime
    suggestion_key: str | None = None  # đồng ý với gợi ý (S9): key phải có trong gợi ý lượt trước


class PrefilledValue(BaseModel):
    value: Any
    source: Literal["preference", "trait"]
    last_confirmed_at: datetime


class HousingFilterPatch(BaseModel):
    """Evidence-backed edits, not a replacement for the previously confirmed filter set."""

    model_config = ConfigDict(extra="forbid")
    add_amenities: list[str] = []
    remove_amenities: list[str] = []
    clear_fields: list[str] = []
    evidence: str


class IntakeResult(BaseModel):
    kind: RequestKind
    normalized_goal: str = ""
    intent: Intent | None = None
    constraints: Constraints = Constraints()
    prefilled: dict[str, PrefilledValue] = {}
    blocking_missing: list[str] = []
    conflicts: list[str] = []
    user_confirmed_facts: dict[str, ConfirmedFact] = {}
    commit_requested: list[CommitActionKind] = []
    unavailable_commit_requested: list[CommitActionKind] = []  # intent retained; never executable
    change_request: str | None = None
    target_task_ids: list[str] = []
    declined_suggestions: list[str] = []  # key gợi ý người dùng từ chối trong lượt này (S9)
    unsupported_reason: str | None = None  # câu giải thích ngắn khi kind=unsupported, do Intake viết
    # Semantic classification, NOT authorization. Code rechecks domain, mode and constraints.
    retrieval_only: bool = False
    housing_filter_patch: HousingFilterPatch | None = None
    # Code-owned, goal-local negative memory; not part of the model's IntakeDraft schema.
    housing_prefill_exclusions: list[str] = []

    @property
    def needs_clarification(self) -> bool:
        return bool(self.blocking_missing or self.conflicts)

    @property
    def domains(self) -> list[AgentName]:
        return list(self.intent.domains) if self.intent else []


class Task(BaseModel, frozen=True):
    id: str
    agent: AgentName
    inputs: dict[str, Any] = {}
    depends_on: list[str] = []
    required: bool = True


class CommitAction(BaseModel, frozen=True):
    id: str  # ổn định qua các version, ví dụ "flight_booking:t3"
    kind: CommitActionKind
    source_task_id: str
    target_receipt_id: str | None = None
    requires_payment: bool = False
    pii_required: list[str] = []


class Plan(BaseModel, frozen=True):
    version: int
    tasks: list[Task]
    commit_actions: list[CommitAction] = []

    def task(self, task_id: str) -> Task | None:
        return next((t for t in self.tasks if t.id == task_id), None)


class TaskOutline(BaseModel):
    """Tóm tắt plan cho Intake để hiểu câu đổi ý / câu chọn ("phòng số 2")."""

    id: str
    agent: AgentName
    selected: str | None = None
    options: list[dict[str, Any]] = []  # [{option_id, label}] theo thứ tự hiển thị
    comparison_options: list[dict[str, Any]] = []  # Real homes from this result; not a selection/approval.


class ChangeContext(BaseModel):
    request: str | None = None
    invalidated_task_ids: list[str] = []
    reusable_task_ids: list[str] = []
    blocked_by_commit: list[str] = []


# --- Phase 2: Execute ---


class TaskResult(BaseModel):
    """Bản trong state của AgentTaskResult (§6.3.3), thêm agent và retryable."""

    task_id: str
    agent: AgentName
    plan_version: int
    status: Literal["done", "failed", "needs_input"]
    data: dict[str, Any] = {}
    quotes: list[Quote] = []
    missing_fields: list[str] = []
    questions: list[Question] = []
    source: str = ""
    source_kind: SourceKind = "fake"
    source_refs: list[str] = []
    fetched_at: datetime
    summary: str | None = None  # chỉ để hiển thị; không đưa vào prompt của Planner
    usage: AgentUsage = AgentUsage()
    error: str | None = None
    error_code: AgentErrorCode | None = None
    retryable: bool = False


# --- Phase 3: Validate ---


class ValidationIssue(BaseModel):
    code: Literal["V1", "V2", "V3", "V4", "V5"]
    task_id: str | None = None
    message: str


class ValidationReport(BaseModel):
    verdict: Literal["PASS", "NEED_MORE"]
    action: Literal["NONE", "RETRY_TASKS", "REPLAN", "ASK_USER", "GIVE_UP"]
    issues: list[ValidationIssue] = []
    retry_task_ids: list[str] = []
    ask_user_fields: list[str] = []
    questions: list[Question] = []


# --- Phase 4: Decide ---


class CostLine(BaseModel):
    task_id: str
    option_id: str
    label: str
    amount_vnd: int
    recurrence: Literal["one_time", "monthly"]
    committed: bool = False  # đã đặt ở lượt trước: hiển thị "đã đặt", không tính vào tổng (S8)
    # Khoảng giá người dùng đồng ý trước khi đặt (giá thực tế provider có thể lệch nhẹ so với báo giá).
    # None = phải đúng `amount_vnd`. Nằm trong payload_hash nên approval gắn với cả khoảng này.
    min_amount_vnd: int | None = None
    max_amount_vnd: int | None = None


class CostSummary(BaseModel):
    plan_version: int
    selected: dict[str, str]
    lines: list[CostLine]
    total_one_time_vnd: int
    total_monthly_vnd: int
    total_one_time_max_vnd: int = 0  # tổng một lần tối đa nếu giá thực tế lệch trong khoảng đã đồng ý
    commit_actions: list[CommitAction]
    payload_hash: str
    quotes_expire_at: datetime


class UserDecision(BaseModel):
    kind: Literal["CONFIRM", "CHANGE", "REJECT", "CANCEL"]
    plan_version: int
    approval_id: str | None = None
    pii_refs: dict[str, str] = {}  # action_id -> pii_ref do backend tạo (D16); không chứa dữ liệu thật
    change_request: str | None = None
    target_task_ids: list[str] = []


class Approval(BaseModel, frozen=True):
    approval_id: str
    user_id: str
    thread_id: str
    plan_version: int
    payload_hash: str
    created_at: datetime
    expires_at: datetime
    pii_refs: dict[str, str] = {}


# --- Phase 5: Commit & Respond ---


class Receipt(BaseModel):
    receipt_id: str  # mã đơn / booking_id của provider
    action_id: str
    kind: CommitActionKind
    provider: str
    amount_vnd: int
    source_kind: SourceKind
    status: str
    details: dict[str, Any] = {}  # PNR, tracking link…; không chứa dữ liệu cá nhân
    created_at: datetime


class PendingPayment(BaseModel):
    action_id: str
    payment_ref: str
    pay_url: str | None = None
    qr_code: str | None = None
    amount_vnd: int
    expires_at: datetime
    status: Literal["PENDING", "PAID", "FAILED", "EXPIRED", "CANCELLED"]
    source_kind: SourceKind = "sandbox"
    pre_payment_receipt: Receipt | None = None  # ví dụ giữ chỗ vé đã tạo trước khi thanh toán


class TransactionResult(BaseModel):
    status: Literal["committed", "partial", "failed", "pending_verification", "payment_not_completed"]
    receipts: list[Receipt] = []  # thao tác đã đặt được trong lần xác nhận này
    failed_action_ids: list[str] = []
    skipped_action_ids: list[str] = []  # chưa thực hiện vì dừng ở thao tác lỗi trước đó
    error: str | None = None


class Suggestion(BaseModel):
    key: str
    label: str
    message: str
    domain: AgentName
    kind: Literal["search", "quote", "book"]


class AgentResponse(BaseModel):
    kind: Literal["ANSWER", "PARTIAL", "CLARIFY", "COMMITTED", "CANCELLED", "UNSUPPORTED", "ERROR"]
    text: str
    data: dict[str, Any] = {}
    questions: list[Question] = []  # câu đã hỏi; lượt sau intake dùng để hiểu câu trả lời
    suggestions: list[Suggestion] = []


class OutcomeCode(StrEnum):
    """Lý do một lượt đi tới `respond`; node nào route sang `respond` thì ghi."""

    UNSUPPORTED = "unsupported"
    CLARIFY = "clarify"
    BUDGET = "budget"
    PLAN_EMPTY = "plan_empty"
    PLAN_INVALID = "plan_invalid"
    MAX_REPLANS = "max_replans"
    CHANGE_BLOCKED = "change_blocked"
    ASK_USER = "ask_user"
    GIVE_UP = "give_up"
    ANSWER = "answer"
    CANCELLED = "cancelled"
    COMMITTED = "committed"
    TX_FAILED = "tx_failed"
    PAYMENT_NOT_COMPLETED = "payment_not_completed"
    PARTIAL_COMMIT = "partial_commit"  # một phần đã đặt, phần khác lỗi: hỏi người dùng có muốn huỷ phần đã đặt
    PENDING_VERIFICATION = "pending_verification"
    ERROR = "error"


class Outcome(BaseModel):
    node: str
    code: OutcomeCode
    detail: str = ""


class ErrorRecord(BaseModel):
    node: str
    task_id: str | None = None
    message: str
    at: datetime


# --- Bộ nhớ người dùng (§6.0) ---


class MemoryValue(BaseModel):
    value: Any
    stated_at: datetime
    last_confirmed_at: datetime
    source_thread: str = ""
    stop_prefill: bool = False


class SessionContext(BaseModel):
    preferences: dict[str, MemoryValue] = {}
    traits: dict[str, MemoryValue] = {}
    hints: dict[str, MemoryValue] = {}


class MemoryUpdate(BaseModel):
    group: Literal["preferences", "traits", "hints"]
    key: str
    value: Any | None = None  # None = xoá
    stop_prefill: bool | None = None
    evidence: str | None = None
    touch_only: bool = False  # chỉ cập nhật last_confirmed_at (giá trị tự điền được dùng tiếp, không sửa)


class UsageCounts(BaseModel):
    llm_calls: int = 0
    subagent_llm_calls: int = 0
    paid_calls: int = 0


def error_record(node: str, message: str, at: datetime, task_id: str | None = None) -> ErrorRecord:
    return ErrorRecord(node=node, task_id=task_id, message=message, at=at)


INACTIVE_RECEIPT_STATUSES = frozenset({"compensated", "cancelled"})


def active_commits(committed: dict[str, Receipt] | None) -> dict[str, Receipt]:
    """Commit còn hiệu lực (đã huỷ / đã compensate thì không tính là "đã đặt", S8)."""
    return {k: r for k, r in (committed or {}).items() if r.status not in INACTIVE_RECEIPT_STATUSES}


# Module names are persisted by LangGraph. Keep the original wire identifiers so
# previous image digests can still read checkpoints written after this package move.
# Python callers import relohome_agent.agents.models; this alias is storage compatibility.
import sys as _sys  # noqa: E402

_LEGACY_CHECKPOINT_MODULE = "src.agents.models"
for _checkpoint_type in tuple(globals().values()):
    if isinstance(_checkpoint_type, type) and _checkpoint_type.__module__ == __name__:
        _checkpoint_type.__module__ = _LEGACY_CHECKPOINT_MODULE
_sys.modules[_LEGACY_CHECKPOINT_MODULE] = _sys.modules[__name__]
del _checkpoint_type
