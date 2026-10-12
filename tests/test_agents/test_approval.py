"""Kiểm approval (agent-graph.md §6.7; lấy từ nhánh khoa §3.3)."""

from datetime import timedelta

import pytest
from relohome_agent.agents.approval import approval_problems, confirmation_hash
from relohome_agent.agents.common import utcnow
from relohome_agent.agents.models import Approval, CommitAction, CommitActionKind, CostSummary, UserDecision
from relohome_agent.services.adapters.fakes import InMemoryApprovalStore

NOW = utcnow()
ACTION = CommitAction(
    id="flight_booking:t1",
    kind=CommitActionKind.FLIGHT_BOOKING,
    source_task_id="t1",
    pii_required=["passengers", "contact"],
)
SUMMARY = CostSummary(
    plan_version=2,
    selected={},
    lines=[],
    total_one_time_vnd=0,
    total_monthly_vnd=0,
    commit_actions=[ACTION],
    payload_hash=confirmation_hash(2, {}, [], [ACTION]),
    quotes_expire_at=NOW + timedelta(minutes=15),
)


def approval(**kw) -> Approval:
    base = dict(
        approval_id="a1",
        user_id="u1",
        thread_id="th",
        plan_version=2,
        payload_hash=SUMMARY.payload_hash,
        created_at=NOW,
        expires_at=NOW + timedelta(minutes=10),
        pii_refs={ACTION.id: "pii_1"},
    )
    return Approval(**{**base, **kw})


def problems(a, decision=None):
    decision = decision or UserDecision(kind="CONFIRM", plan_version=2, approval_id="a1")
    return approval_problems(a, decision, SUMMARY, user_id="u1", thread_id="th", plan_version=2, now=NOW)


def test_valid_approval():
    assert problems(approval()) == []


def test_each_mismatch_is_rejected():
    assert problems(None)
    assert problems(approval(payload_hash="x" * 64))
    assert problems(approval(user_id="u2"))
    assert problems(approval(thread_id="other"))
    assert problems(approval(plan_version=1))
    assert problems(approval(expires_at=NOW - timedelta(seconds=1)))
    assert problems(approval(created_at=NOW - timedelta(minutes=40), expires_at=NOW + timedelta(minutes=1)))
    assert problems(approval(pii_refs={}))
    assert problems(approval(expires_at=NOW + timedelta(minutes=20)))  # quá hạn báo giá


@pytest.mark.asyncio
async def test_approval_cannot_be_reused_for_other_payload():
    store = InMemoryApprovalStore()
    assert await store.mark_used("a1", "hash1")
    assert await store.mark_used("a1", "hash1")  # chạy lại cùng thao tác: an toàn
    assert not await store.mark_used("a1", "hash2")
