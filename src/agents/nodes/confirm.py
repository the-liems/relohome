"""Node `confirm` — User Confirmation, human-in-the-loop (agent-graph.md §6.7).

Khi resume, LangGraph chạy lại node từ đầu: mọi thứ trước `interrupt()` không có side-effect.
"""

from __future__ import annotations

from langchain_core.messages import HumanMessage
from langgraph.types import interrupt
from pydantic import ValidationError

from src.agents.approval import approval_problems
from src.agents.deps import GraphDeps
from src.agents.models import Outcome, OutcomeCode, UserDecision, error_record
from src.agents.state import WorkflowState


def confirmation_payload(state: WorkflowState) -> dict:
    summary = state["cost_summary"]
    errors = [e.message for e in (state.get("errors") or [])[-3:] if e.node == "confirm"]
    return {
        "type": "confirmation_required",
        "plan_version": state["plan"].version,
        "cost_summary": summary.model_dump(mode="json"),
        "payload_hash": summary.payload_hash,
        "expires_at": summary.quotes_expire_at.isoformat(),
        "pii_required": {a.id: a.pii_required for a in summary.commit_actions if a.pii_required},
        "last_error": errors[-1] if errors else None,
    }


def make_confirm(deps: GraphDeps):
    async def confirm(state: WorkflowState) -> dict:
        """Dừng graph chờ người dùng xác nhận trước khi đặt / thanh toán."""
        now = deps.clock()
        raw = interrupt(confirmation_payload(state))
        try:
            decision = UserDecision.model_validate(raw)
        except ValidationError:
            return {"user_decision": None, "errors": [error_record("confirm", "quyết định không đúng định dạng", now)]}
        plan = state["plan"]
        if decision.plan_version != plan.version:
            return {
                "user_decision": None,
                "errors": [error_record("confirm", "xác nhận cho phương án cũ; hãy xem lại phương án mới", now)],
            }
        update: dict = {"user_decision": decision}
        if decision.kind == "CONFIRM":
            approval = await deps.approvals.get(decision.approval_id) if decision.approval_id else None
            problems = approval_problems(
                approval,
                decision,
                state["cost_summary"],
                user_id=state.get("user_id") or "anonymous",
                thread_id=state.get("thread_id", ""),
                plan_version=plan.version,
                now=now,
                max_lifetime=deps.settings.approval_max_lifetime,
            )
            if problems:
                return {"user_decision": None, "errors": [error_record("confirm", "; ".join(problems), now)]}
        elif decision.kind == "CANCEL":
            update["outcome"] = Outcome(node="confirm", code=OutcomeCode.CANCELLED)
        if decision.change_request:
            update["messages"] = [HumanMessage(decision.change_request)]  # để intake đọc như mọi tin nhắn
        return update

    return confirm
