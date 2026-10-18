"""Node `await_payment` — chờ thanh toán bất đồng bộ (agent-graph.md §6.9, D16).

Mỗi lần resume chỉ hỏi cổng thanh toán một lần (không tin client); `PENDING` thì interrupt lại.
"""

from __future__ import annotations

import logging

from langgraph.types import interrupt
from relohome_agent.agents.deps import GraphDeps
from relohome_agent.agents.models import error_record
from relohome_agent.agents.state import WorkflowState

logger = logging.getLogger(__name__)

TERMINAL = {"PAID", "FAILED", "EXPIRED", "CANCELLED"}


def make_await_payment(deps: GraphDeps):
    async def await_payment(state: WorkflowState) -> dict:
        """Trả link / QR cho UI qua interrupt; khi resume thì hỏi `payment_status` hoặc huỷ."""
        pending = state["pending_payment"]
        resume = interrupt(
            {
                "type": "payment_required",
                "action_id": pending.action_id,
                "pay_url": pending.pay_url,
                "qr_code": pending.qr_code,
                "amount_vnd": pending.amount_vnd,
                "expires_at": pending.expires_at.isoformat(),
                "source_kind": pending.source_kind,
            }
        )
        cancel = isinstance(resume, dict) and resume.get("action") == "cancel"
        update: dict = {}
        try:
            status = await (deps.transaction.cancel_payment if cancel else deps.transaction.payment_status)(
                pending.payment_ref
            )
        except Exception as exc:
            logger.warning("payment status check failed payment_ref=%s", pending.payment_ref, exc_info=True)
            status = "PENDING"
            update["errors"] = [
                error_record("await_payment", f"không hỏi được cổng thanh toán: {type(exc).__name__}", deps.clock())
            ]
        if status == "REFUNDED":
            status = "CANCELLED"
        # A timeout or an unsupported cancellation is not a confirmed cancellation.
        # Keep waiting until the provider returns an authoritative terminal state.
        if status == "PENDING" and deps.clock() > pending.expires_at:
            status = "EXPIRED"
        update["pending_payment"] = pending.model_copy(update={"status": status if status in TERMINAL else "PENDING"})
        return update

    return await_payment
