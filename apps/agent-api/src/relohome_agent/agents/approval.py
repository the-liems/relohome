"""Approval và idempotency (agent-graph.md §6.6, §6.7, §6.9). Hàm thuần.

Các kiểm tra approval lấy từ `ApprovalRequest` / `Orchestrator.approve` của nhánh `khoa` (§3.3):
khớp chủ, khớp `payload_hash`, hạn không quá 30 phút, không dùng lại `approval_id`.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from relohome_agent.agents.common import fingerprint
from relohome_agent.agents.models import Approval, CommitAction, CostLine, CostSummary, UserDecision


def confirmation_hash(
    plan_version: int, selected: dict[str, str], lines: list[CostLine], commit_actions: list[CommitAction]
) -> str:
    return fingerprint(
        {
            "plan_version": plan_version,
            "selected": selected,
            "lines": [line.model_dump(mode="json") for line in lines],
            "commit_actions": [a.model_dump(mode="json") for a in commit_actions],
        }
    )


def idempotency_key(thread_id: str, plan_version: int, action_id: str, option_id: str) -> str:
    return fingerprint([thread_id, plan_version, action_id, option_id])


def approval_problems(
    approval: Approval | None,
    decision: UserDecision,
    summary: CostSummary,
    *,
    user_id: str,
    thread_id: str,
    plan_version: int,
    now: datetime,
    max_lifetime: timedelta = timedelta(minutes=30),
) -> list[str]:
    """Lý do approval không hợp lệ; rỗng là hợp lệ. Không kiểm "đã dùng" (việc của `ApprovalPort`)."""
    if decision.kind != "CONFIRM":
        return []
    if not decision.approval_id:
        return ["thiếu approval_id"]
    if approval is None:
        return ["approval không tồn tại"]
    problems = []
    if approval.user_id != user_id or approval.thread_id != thread_id:
        problems.append("approval không thuộc người dùng / thread này")
    if approval.plan_version != plan_version or decision.plan_version != plan_version:
        problems.append("approval cho plan version khác")
    if approval.payload_hash != summary.payload_hash:
        problems.append("approval không khớp payload_hash")
    if approval.expires_at <= now:
        problems.append("approval đã hết hạn")
    if approval.expires_at - approval.created_at > max_lifetime:
        problems.append("approval có hạn dài hơn mức cho phép")
    if approval.expires_at > summary.quotes_expire_at:
        problems.append("approval kéo dài quá hạn báo giá")
    pii_refs = {**approval.pii_refs, **decision.pii_refs}
    if decision.pii_refs and approval.pii_refs and decision.pii_refs != approval.pii_refs:
        problems.append("pii_refs khác với bản backend gắn vào approval")
    for action in summary.commit_actions:
        if action.pii_required and action.id not in pii_refs:
            problems.append(f"thiếu thông tin cá nhân cho {action.id}")
    return problems
