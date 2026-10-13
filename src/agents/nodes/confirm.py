"""Node `confirm` — User Confirmation, human-in-the-loop (agent-graph.md §6.7).

Khi resume, LangGraph chạy lại node từ đầu: mọi thứ trước `interrupt()` không có side-effect.
"""

from __future__ import annotations

from langchain_core.messages import HumanMessage
from langgraph.types import interrupt
from pydantic import ValidationError
from relohome_agent.agents.approval import approval_problems
from relohome_agent.agents.deps import GraphDeps
from relohome_agent.agents.models import CommitActionKind, Outcome, OutcomeCode, UserDecision, error_record
from relohome_agent.agents.state import WorkflowState


def _vnd(amount: int) -> str:
    return f"{amount:,}".replace(",", ".") + "đ"


def confirmation_notes(summary) -> dict[str, str]:
    """Điều người dùng đồng ý cùng lúc xác nhận: khoảng giá, cách trả tiền, phí huỷ chưa biết."""
    notes: dict[str, str] = {}
    lines = {line.task_id: line for line in summary.lines}
    for action in summary.commit_actions:
        line = lines.get(action.source_task_id)
        parts = []
        if line is not None and line.max_amount_vnd is not None:
            parts.append(
                f"Giá ước tính {_vnd(line.amount_vnd)}; giá thực tế khi đặt có thể từ {_vnd(line.min_amount_vnd)} "
                f"đến tối đa {_vnd(line.max_amount_vnd)}. Ngoài khoảng này mình sẽ hỏi lại."
            )
        if action.kind == CommitActionKind.MOVING_BOOKING:
            parts.append("Trả tiền mặt cho tài xế.")
        if action.kind == CommitActionKind.CANCEL_ORDER:
            parts.append("Phí huỷ (nếu có) theo chính sách của nhà cung cấp; hệ thống chưa biết trước số tiền.")
        if action.kind == CommitActionKind.UPDATE_ORDER:
            parts.append("Chỉ cập nhật liên hệ/ghi chú theo form bạn xác nhận; không đổi tuyến, giá hay tiền thu hộ.")
        if parts:
            notes[action.id] = " ".join(parts)
    return notes


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
        "notes": confirmation_notes(summary),
        "moving_details": {
            a.id: {k: result.data.get(k) for k in ("from_address", "to_address", "moving_options", "addon_labels")}
            for a in summary.commit_actions
            if a.kind == CommitActionKind.MOVING_BOOKING
            and (result := (state.get("task_results") or {}).get(a.source_task_id))
        },
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
