"""`WorkflowState` và payload gửi cho node agent (agent-graph.md §5.1, §5.4).

Field không có reducer bị ghi đè (last write wins); ràng buộc "ai ghi" ở bảng §5.2 là bắt buộc.
"""

from __future__ import annotations

import operator
from typing import Annotated, Any, TypedDict

from langchain_core.messages import AnyMessage
from langgraph.graph.message import add_messages

from src.agents.models import (
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


class WorkflowState(TypedDict, total=False):
    # --- Input & hội thoại (API ghi) ---
    messages: Annotated[list[AnyMessage], add_messages]
    user_id: str
    thread_id: str
    request_id: str  # mỗi lượt API tạo mới
    moving_locations: dict | None  # validated explicit user pins; never authored by LLM
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
    goal_tasks: dict[str, dict]  # task của mục tiêu hiện tại qua các lượt, cho dải tiến trình (progress.record_goal)

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
