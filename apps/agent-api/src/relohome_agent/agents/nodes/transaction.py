"""Node `transaction` — Transaction / Payment Agent (agent-graph.md §6.9).

Thao tác ghi chỉ ở đây, sau approval do backend lưu; gọi `TransactionPort` tất định, không qua LLM.
Dữ liệu cá nhân lấy qua `PiiPort` ngay trước khi gọi và không bao giờ ghi vào state (D16).
"""

from __future__ import annotations

import logging

from relohome_agent.agents.approval import approval_problems, idempotency_key
from relohome_agent.agents.deps import GraphDeps
from relohome_agent.agents.models import (
    CommitAction,
    Outcome,
    OutcomeCode,
    PendingPayment,
    Receipt,
    TransactionResult,
    error_record,
)
from relohome_agent.agents.state import WorkflowState
from relohome_agent.guest_access import require_account
from relohome_agent.services.adapters.ports import CommitError, CommitRequest

logger = logging.getLogger(__name__)


def _option(data: dict, option_id: str) -> dict:
    for value in data.values():
        if isinstance(value, list):
            for item in value:
                if isinstance(item, dict) and str(item.get("id")) == option_id:
                    return item
    return {}


def commit_order(actions: list[CommitAction]) -> list[CommitAction]:
    """Thao tác không cần thanh toán trước, cần thanh toán sau cùng."""
    return sorted(actions, key=lambda a: a.requires_payment)


def make_transaction(deps: GraphDeps):
    tx = deps.transaction

    async def transaction(state: WorkflowState) -> dict:
        """Commit tuần tự, idempotent. Một thao tác lỗi thì dừng, **không tự huỷ** thao tác đã đặt:
        báo người dùng phần nào đã đặt, phần nào lỗi, rồi hỏi có muốn huỷ phần đã đặt không."""
        require_account(state.get("user_id"))
        now = deps.clock()
        plan = state["plan"]
        summary = state["cost_summary"]
        decision = state["user_decision"]
        thread_id = state.get("thread_id", "")
        results = state.get("task_results") or {}
        pending: PendingPayment | None = state.get("pending_payment")
        committed: dict[str, Receipt] = dict(state.get("committed") or {})
        new: dict[str, Receipt] = {}
        ordered = commit_order(summary.commit_actions)

        def finish(code: OutcomeCode, status: str, error: str | None = None, failed: str | None = None) -> dict:
            receipts = [r for a in summary.commit_actions if (r := {**committed, **new}.get(a.id))]
            skipped = []
            if failed is not None:
                after = [a.id for a in ordered][[a.id for a in ordered].index(failed) + 1 :]
                skipped = [a for a in after if a not in committed and a not in new]
            if failed is not None and receipts and code in (OutcomeCode.TX_FAILED, OutcomeCode.PAYMENT_NOT_COMPLETED):
                code, status = OutcomeCode.PARTIAL_COMMIT, "partial"
            update = {
                "committed": new,
                "transaction": TransactionResult(
                    status=status,
                    receipts=receipts,
                    failed_action_ids=[failed] if failed else [],
                    skipped_action_ids=skipped,
                    error=error,
                ),
                "outcome": Outcome(node="transaction", code=code, detail=error or ""),
                "pending_payment": None,
            }
            if error:
                update["errors"] = [error_record("transaction", error, now)]
            return update

        approval = await deps.approvals.get(decision.approval_id) if decision.approval_id else None
        if pending is None:
            # Kiểm lại ngay trước khi ghi (approval có thể hết hạn giữa confirm và transaction).
            problems = approval_problems(
                approval,
                decision,
                summary,
                user_id=state.get("user_id") or "anonymous",
                thread_id=thread_id,
                plan_version=plan.version,
                now=now,
                max_lifetime=deps.settings.approval_max_lifetime,
            )
            if problems:
                return finish(OutcomeCode.TX_FAILED, "failed", "; ".join(problems))
            if not await deps.approvals.mark_used(approval.approval_id, summary.payload_hash):
                return finish(OutcomeCode.TX_FAILED, "failed", "approval đã được dùng cho thao tác khác")
        pii_refs = {**(approval.pii_refs if approval else {}), **decision.pii_refs}

        for action in ordered:
            if action.id in committed:
                continue
            option_id = summary.selected.get(action.source_task_id) or action.target_receipt_id or ""
            line = next((ln for ln in summary.lines if ln.task_id == action.source_task_id), None)
            key = idempotency_key(thread_id, plan.version, action.id, option_id)
            existing = await tx.lookup(key)
            if existing is not None:
                new[action.id] = existing
                continue
            pii: dict = {}
            if action.pii_required:
                ref = pii_refs.get(action.id)
                try:
                    pii = await deps.pii.get(ref) if ref else {}
                except Exception:
                    logger.warning("pii lookup failed action=%s", action.id, exc_info=True)
                    pii = {}
                missing = [f for f in action.pii_required if f not in pii]
                if missing:
                    reason = f"thiếu thông tin cá nhân ({', '.join(missing)}) cho {action.id}"
                    return finish(OutcomeCode.TX_FAILED, "failed", reason, failed=action.id)
            source = results.get(action.source_task_id)
            amount = line.amount_vnd if line else 0
            req = CommitRequest(
                action=action,
                option_id=option_id,
                amount_vnd=amount,
                min_amount_vnd=line.min_amount_vnd if line and line.min_amount_vnd is not None else amount,
                max_amount_vnd=line.max_amount_vnd if line and line.max_amount_vnd is not None else amount,
                idempotency_key=key,
                approval=approval,
                option=_option(source.data, option_id) if source else {},
                task_data={
                    **(source.data if source else {}),
                    **{k: v for k, v in plan.task(action.source_task_id).inputs.items() if isinstance(v, str)},
                },
                pii=pii,
            )
            try:
                if action.requires_payment:
                    if pending is None or pending.action_id != action.id:
                        started = await tx.start_payment(req)
                        return {"committed": new, "pending_payment": started}
                    if pending.status == "PENDING":
                        return {"committed": new, "pending_payment": pending}
                    if pending.status != "PAID":
                        await tx.abort_after_payment(req, pending)  # huỷ giữ chỗ của chính thao tác này
                        reason = f"thanh toán không thành công ({pending.status})"
                        return finish(
                            OutcomeCode.PAYMENT_NOT_COMPLETED, "payment_not_completed", reason, failed=action.id
                        )
                    receipt = await tx.complete_after_payment(req, pending)
                    pending = None
                else:
                    receipt = await (tx.guarded_commit(req) if hasattr(tx, "guarded_commit") else tx.commit(req))
            except CommitError as exc:
                if exc.uncertain:
                    reason = f"{action.id}: chưa rõ kết quả, cần đối soát ({exc.message})"
                    return finish(OutcomeCode.PENDING_VERIFICATION, "pending_verification", reason, failed=action.id)
                return finish(OutcomeCode.TX_FAILED, "failed", f"{action.id}: {exc.message}", failed=action.id)
            except Exception as exc:
                logger.warning("commit failed action=%s error_type=%s", action.id, type(exc).__name__, exc_info=True)
                reason = f"{action.id}: lỗi không rõ khi ghi ({type(exc).__name__}), cần đối soát"
                return finish(OutcomeCode.PENDING_VERIFICATION, "pending_verification", reason, failed=action.id)
            new[action.id] = receipt
        return finish(OutcomeCode.COMMITTED, "committed")

    return transaction
