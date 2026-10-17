"""`WorkflowState` và payload gửi cho node agent (agent-graph.md §5.1, §5.4).

Field không có reducer bị ghi đè (last write wins); ràng buộc "ai ghi" ở bảng §5.2 là bắt buộc.
"""

from __future__ import annotations

import operator
from typing import Annotated, Any, NotRequired, TypedDict

from langchain_core.messages import AnyMessage
from langgraph.graph.message import add_messages
from relohome_agent.agents.models import (
    AgentResponse,
    ChangeContext,
    Constraints,
    CostSummary,
    ErrorRecord,
    IntakeResult,
    Outcome,
    PendingPayment,
    Plan,
    Question,
    Receipt,
    SessionContext,
    Task,
    TaskResult,
    TaskStatus,
    TransactionResult,
    UserDecision,
    ValidationReport,
)


def merge_dict(left: dict | None, right: dict | None) -> dict:
    """Gộp theo key; right thắng. Cho phép nhiều agent song song cùng ghi."""
    return {**(left or {}), **(right or {})}


class MovingQuoteContext(TypedDict):
    """Trusted API input for one quote turn; cleared after its response."""

    task_id: str


class WorkflowState(TypedDict, total=False):
    # --- Input & hội thoại (API ghi) ---
    messages: Annotated[list[AnyMessage], add_messages]
    user_id: str
    guest_claim: dict | None
    auth_required: list[str]
    thread_id: str
    request_id: str  # mỗi lượt API tạo mới
    moving_locations: dict | None  # validated explicit user pins; never authored by LLM
    moving_quote_context: MovingQuoteContext | None
    moving_options: dict | None  # validated service form, without contacts
    housing_location: dict | None  # shared map selection validated by API
    map_view: dict | None  # client viewport {bounding_box, zoom}, validated by API
    place_choice: dict | None  # {field, place_id, name, lat, lng} re-read from Location by API
    session: SessionContext

    # --- Phase 1: Understand & Plan ---
    intake: IntakeResult | None
    plan: Plan | None
    replan_count: int
    change_context: ChangeContext | None

    # --- Phase 2: Execute ---
    task_status: Annotated[dict[str, TaskStatus], merge_dict]
    task_attempts: Annotated[dict[str, int], merge_dict]
    task_results: Annotated[dict[str, TaskResult], merge_dict]
    dispatch: list[str]
    dispatch_llm_budgets: dict[str, int]
    planner_questions: list[Question]  # domain Planner hoãn vì input chưa dùng được (needs_input)
    filter_search_task_ids: list[str]  # planner-issued, turn-local validated retrieval hint; never model output
    goal_tasks: dict[str, dict]  # các bước trong cuộc trò chuyện, cho bảng kế hoạch (progress.record_goal)
    goal_selections: dict[str, str]  # option ID đã chọn theo task; độc lập với intake của lượt hiện tại
    last_housing_search_options: list[dict]  # IDs/labels only; prices/details are re-read before comparing.
    # Căn đang chọn để hẹn xem (chỉ ID/nhãn/task; lịch và kết quả nằm ở kho giao dịch). Không phải căn của kế hoạch.
    housing_selection: list[dict]
    # "wait_for_home": chuyển đồ chờ chốt nhà (tuần tự). None: chưa hỏi hoặc đã có địa chỉ đến.
    moving_destination_mode: str | None
    housing_selection_changed: bool  # lượt này thêm/bỏ căn đang xem qua chat; load_context reset mỗi lượt

    # --- Phase 3: Validate ---
    validation: ValidationReport | None

    # --- Phase 4: Decide ---
    cost_summary: CostSummary | None
    user_decision: UserDecision | None

    # --- Phase 5: Commit & Respond ---
    transaction: TransactionResult | None
    pending_payment: PendingPayment | None
    committed: Annotated[dict[str, Receipt], merge_dict]
    declined_suggestions: Annotated[list[str], operator.add]
    outcome: Outcome | None  # lý do lượt này tới respond; load_context reset mỗi lượt
    response: AgentResponse | None

    # --- Chẩn đoán ---
    errors: Annotated[list[ErrorRecord], operator.add]


class AgentInput(TypedDict):
    """Payload thu gọn gửi cho node `*_agent` qua `Send` (§5.4)."""

    task: Task
    allocated_llm_calls: int
    user_id: str  # trusted API identity; never forwarded into model arguments
    plan_version: int
    attempt: int
    request_id: str
    thread_id: str
    constraints: Constraints
    goal: str
    user_request: str
    hints: dict[str, Any]
    upstream: dict[str, TaskResult]
    retrieval_only: NotRequired[bool]
