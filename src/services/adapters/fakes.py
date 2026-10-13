"""Fake cho các port của graph: dùng trong test và khi chưa có backend thật (§6.3.7, §8)."""

from __future__ import annotations

import secrets
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from relohome_agent.agents.common import utcnow
from relohome_agent.agents.memory import apply_updates, forget_thread
from relohome_agent.agents.models import (
    AgentName,
    AgentUsage,
    Approval,
    MemoryUpdate,
    PendingPayment,
    Receipt,
    SessionContext,
    UsageCounts,
)
from relohome_agent.services.adapters.ports import CommitError, CommitRequest


class InMemorySessionPort:
    def __init__(self, clock: Callable[[], datetime] = utcnow):
        self.data: dict[str, SessionContext] = {}
        self.clock = clock

    async def load(self, user_id: str) -> SessionContext:
        return self.data.get(user_id, SessionContext()).model_copy(deep=True)

    async def save(self, user_id: str, thread_id: str, updates: list[MemoryUpdate]) -> None:
        if updates:
            current = self.data.get(user_id, SessionContext())
            self.data[user_id] = apply_updates(current, updates, thread_id, self.clock())

    async def forget(self, user_id: str) -> None:
        self.data.pop(user_id, None)

    async def forget_thread(self, user_id: str, thread_id: str) -> None:
        if user_id in self.data:
            self.data[user_id] = forget_thread(self.data[user_id], thread_id)


class InMemoryApprovalStore:
    """Approval Store giả lập. `create` là việc của backend (API), graph chỉ `get` / `mark_used`."""

    def __init__(self, clock: Callable[[], datetime] = utcnow):
        self.items: dict[str, Approval] = {}
        self.used: dict[str, str] = {}
        self.clock = clock

    async def create(
        self,
        *,
        user_id: str,
        thread_id: str,
        plan_version: int,
        payload_hash: str,
        expires_at: datetime,
        pii_refs: dict[str, str] | None = None,
    ) -> Approval:
        approval = Approval(
            approval_id=str(uuid.uuid4()),
            user_id=user_id,
            thread_id=thread_id,
            plan_version=plan_version,
            payload_hash=payload_hash,
            created_at=self.clock(),
            expires_at=expires_at,
            pii_refs=pii_refs or {},
        )
        self.items[approval.approval_id] = approval
        return approval

    async def get(self, approval_id: str) -> Approval | None:
        return self.items.get(approval_id)

    async def mark_used(self, approval_id: str, use_key: str) -> bool:
        current = self.used.setdefault(approval_id, use_key)
        return current == use_key


class InMemoryPiiStore:
    """Kho dữ liệu cá nhân hạn ngắn giả lập (D16). `put` là việc của backend khi nhận form."""

    def __init__(self, ttl: timedelta = timedelta(minutes=30), clock: Callable[[], datetime] = utcnow):
        self.items: dict[str, tuple[datetime, dict[str, Any]]] = {}
        self.ttl, self.clock = ttl, clock

    async def put(self, data: dict[str, Any]) -> str:
        ref = f"pii_{secrets.token_hex(8)}"
        self.items[ref] = (self.clock() + self.ttl, data)
        return ref

    async def get(self, pii_ref: str) -> dict[str, Any]:
        expires_at, data = self.items.get(pii_ref, (None, None))
        if expires_at is None or expires_at <= self.clock():
            raise KeyError("pii_ref not found or expired")
        return dict(data)


@dataclass
class _LlmRecord:
    thread_id: str
    request_id: str
    node: str


@dataclass
class _SubagentRecord:
    thread_id: str
    request_id: str
    agent: AgentName
    cost_tier: str
    usage: AgentUsage


def _all_cached(usage: AgentUsage) -> bool:
    """Lần chạy chỉ dùng cache của subagent thì không tính là call `paid` (§7.5)."""
    return usage.cached_calls > 0 and usage.cached_calls >= usage.provider_calls


class InMemoryUsageMeter:
    def __init__(self):
        self.llm: list[_LlmRecord] = []
        self.subagents: list[_SubagentRecord] = []

    async def record_llm(self, thread_id, request_id, node, model, tokens_in, tokens_out) -> None:
        self.llm.append(_LlmRecord(thread_id, request_id, node))

    async def record_subagent(self, thread_id, request_id, agent, cost_tier, usage, elapsed_ms) -> None:
        self.subagents.append(_SubagentRecord(thread_id, request_id, agent, cost_tier, usage))

    async def counts(self, thread_id: str, request_id: str | None = None) -> UsageCounts:
        def match(r) -> bool:
            return r.thread_id == thread_id and (request_id is None or r.request_id == request_id)

        subs = [r for r in self.subagents if match(r)]
        return UsageCounts(
            llm_calls=sum(1 for r in self.llm if match(r)),
            subagent_llm_calls=sum(r.usage.llm_calls for r in subs),
            paid_calls=sum(1 for r in subs if r.cost_tier == "paid" and not _all_cached(r.usage)),
        )


class FakeTransaction:
    """TransactionPort giả lập: ghi nhận, idempotent theo `idempotency_key`, thanh toán theo kịch bản.

    `payment_script`: danh sách trạng thái trả về lần lượt cho mỗi lần hỏi `payment_status`.
    `fail_kinds`: loại commit action sẽ lỗi (để test compensate).
    """

    def __init__(self, clock: Callable[[], datetime] = utcnow, payment_script: list[str] | None = None):
        self.clock = clock
        self.receipts: dict[str, Receipt] = {}
        self.payments: dict[str, PendingPayment] = {}
        self.payment_by_key: dict[str, str] = {}
        self.payment_script = list(payment_script or ["PAID"])
        self.calls: list[tuple[str, str]] = []
        self.fail_kinds: set[str] = set()
        self.uncertain_kinds: set[str] = set()
        self.seen_pii: list[dict[str, Any]] = []
        self.compensated: list[str] = []
        self.aborted: list[str] = []

    def _receipt(self, req: CommitRequest, status: str) -> Receipt:
        return Receipt(
            receipt_id=f"fake_{req.idempotency_key[:10]}",
            action_id=req.action.id,
            kind=req.action.kind,
            provider="fake",
            amount_vnd=req.amount_vnd,
            source_kind="fake",
            status=status,
            details={
                "option_id": req.option_id,
                **({"to_address": req.task_data["to_address"]} if req.task_data.get("to_address") else {}),
            },
            created_at=self.clock(),
        )

    async def lookup(self, idempotency_key: str) -> Receipt | None:
        return self.receipts.get(idempotency_key)

    async def commit(self, req: CommitRequest) -> Receipt:
        self.calls.append(("commit", req.action.id))
        self.seen_pii.append(req.pii)
        if req.action.kind in self.uncertain_kinds:
            raise CommitError("provider timeout", uncertain=True)
        if req.action.kind in self.fail_kinds:
            raise CommitError("provider rejected")
        receipt = self._receipt(req, "confirmed")
        self.receipts[req.idempotency_key] = receipt
        return receipt

    async def start_payment(self, req: CommitRequest) -> PendingPayment:
        self.calls.append(("start_payment", req.action.id))
        self.seen_pii.append(req.pii)
        if req.idempotency_key in self.payment_by_key:
            return self.payments[self.payment_by_key[req.idempotency_key]]
        if req.action.kind in self.fail_kinds:
            raise CommitError("hold rejected")
        ref = f"pay_{len(self.payments) + 1}"
        pending = PendingPayment(
            action_id=req.action.id,
            payment_ref=ref,
            pay_url=f"https://sandbox.example/pay/{ref}",
            amount_vnd=req.amount_vnd,
            expires_at=self.clock() + timedelta(minutes=15),
            status="PENDING",
            source_kind="fake",
            pre_payment_receipt=self._receipt(req, "held"),
        )
        self.payments[ref] = pending
        self.payment_by_key[req.idempotency_key] = ref
        return pending

    async def payment_status(self, payment_ref: str) -> str:
        self.calls.append(("payment_status", payment_ref))
        status = self.payment_script.pop(0) if len(self.payment_script) > 1 else self.payment_script[0]
        return status

    async def simulate_payment(self, payment_ref: str, outcome: str) -> str:
        self.calls.append(("simulate_payment", payment_ref))
        if payment_ref not in self.payments:
            raise CommitError("không tìm thấy giao dịch")
        self.payment_script = [outcome]  # lần hỏi trạng thái kế tiếp trả kết quả đã giả lập
        return outcome

    async def cancel_payment(self, payment_ref: str) -> str:
        self.calls.append(("cancel_payment", payment_ref))
        return "CANCELLED"

    async def complete_after_payment(self, req: CommitRequest, pending: PendingPayment) -> Receipt:
        self.calls.append(("complete_after_payment", req.action.id))
        receipt = self._receipt(req, "ticketed")
        self.receipts[req.idempotency_key] = receipt
        return receipt

    async def abort_after_payment(self, req: CommitRequest, pending: PendingPayment) -> None:
        self.calls.append(("abort_after_payment", req.action.id))
        self.aborted.append(req.action.id)

    async def compensate(self, receipt: Receipt) -> None:
        self.calls.append(("compensate", receipt.action_id))
        self.compensated.append(receipt.action_id)
