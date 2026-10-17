"""Hàm routing của graph (agent-graph.md §4.1). Hàm thuần: chỉ đọc state, không ghi."""

from __future__ import annotations

from langgraph.types import Send
from relohome_agent.agents.housing_fast_path import is_filter_retrieval
from relohome_agent.agents.llm_runtime import public_data
from relohome_agent.agents.models import SessionContext
from relohome_agent.agents.state import AgentInput, WorkflowState

RESPOND = "respond"


def agent_node_name(agent: str) -> str:
    return f"{agent}_agent"


def route_from_start(state: WorkflowState) -> str:
    return "moving_quote_agent" if state.get("moving_quote_context") else "load_context"


def route_from_intake(state: WorkflowState) -> str:
    if state.get("outcome") is not None:  # UNSUPPORTED, hỏi lại, vượt trần chi phí
        return RESPOND
    intake = state["intake"]
    if intake.kind == "change" and state.get("plan") is not None:
        return "change_impact"
    return "orchestrator"


def route_from_orchestrator(state: WorkflowState) -> str:
    return RESPOND if state.get("outcome") is not None else "executor"


def hints_for_agents(session: SessionContext | None) -> dict:
    """Gợi ý xếp hạng từ bộ nhớ (mức 2); `run_with_policy` lọc theo `hint_keys` của manifest."""
    if session is None:
        return {}
    return {k: v.value for k, v in session.hints.items() if not v.stop_prefill}


def route_from_executor(state: WorkflowState) -> list[Send] | str:
    dispatch = state.get("dispatch") or []
    if not dispatch:
        return "validator"
    plan = state["plan"]
    results = state.get("task_results") or {}
    attempts = state.get("task_attempts") or {}
    intake = state["intake"]
    hints = hints_for_agents(state.get("session"))
    sends = []
    for task_id in dispatch:
        task = plan.task(task_id)
        payload = AgentInput(
            user_id=state.get("user_id", "anonymous"),
            task=task,
            allocated_llm_calls=(state.get("dispatch_llm_budgets") or {}).get(task_id, 0),
            plan_version=plan.version,
            attempt=attempts.get(task_id, 1),
            request_id=state.get("request_id", ""),
            thread_id=state.get("thread_id", ""),
            constraints=intake.constraints,
            retrieval_only=(
                task.id in (state.get("filter_search_task_ids") or [])
                and is_filter_retrieval(intake)
                and task.agent == "property"
                and not task.depends_on
                and not plan.commit_actions
            ),
            goal=public_data(intake.normalized_goal)[:1500],
            user_request=public_data(
                next((str(m.content) for m in reversed(state.get("messages") or []) if m.type == "human"), "")
            )[:2000],
            hints=hints,
            upstream={d: results[d] for d in task.depends_on if d in results},
        )
        sends.append(Send(agent_node_name(task.agent.value), payload))
    return sends


def route_from_validator(state: WorkflowState) -> str:
    validation = state["validation"]
    if validation.verdict == "PASS":
        return "cost_summary"
    return {"RETRY_TASKS": "executor", "REPLAN": "orchestrator"}.get(validation.action, RESPOND)


def route_from_cost_summary(state: WorkflowState) -> str:
    return RESPOND if state.get("outcome") is not None else "confirm"


def route_from_confirm(state: WorkflowState) -> str:
    decision = state.get("user_decision")
    if decision is None:  # quyết định không hợp lệ (sai version, approval sai): hỏi lại
        return "confirm"
    return {"CONFIRM": "transaction", "CHANGE": "intake", "REJECT": "intake"}.get(decision.kind, RESPOND)


def route_from_transaction(state: WorkflowState) -> str:
    pending = state.get("pending_payment")
    return "await_payment" if pending is not None and pending.status == "PENDING" else RESPOND


def route_from_await_payment(state: WorkflowState) -> str:
    pending = state.get("pending_payment")
    return "await_payment" if pending is not None and pending.status == "PENDING" else "transaction"
