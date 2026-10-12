"""Port của graph (agent-graph.md §6.0, §6.3.7, §6.9, §7.5).

Port provider (Location, Moving, Flight…) nằm bên trong subagent; ở đây chỉ có port cho những gì
graph tự làm: bộ nhớ, approval, dữ liệu cá nhân, commit/thanh toán và đo chi phí.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

from relohome_agent.agents.models import (
    AgentName,
    AgentUsage,
    Approval,
    CommitAction,
    MemoryUpdate,
    PendingPayment,
    Receipt,
    SessionContext,
    UsageCounts,
)


class SessionPort(Protocol):
    async def load(self, user_id: str) -> SessionContext: ...

    async def save(self, user_id: str, thread_id: str, updates: list[MemoryUpdate]) -> None: ...

    async def forget(self, user_id: str) -> None: ...

    async def forget_thread(self, user_id: str, thread_id: str) -> None:
        """Xoá bộ nhớ có nguồn từ một hội thoại đã bị người dùng xoá."""
        ...


class ApprovalPort(Protocol):
    """Approval Store của backend. Graph chỉ đọc và đánh dấu đã dùng, không bao giờ tạo approval."""

    async def get(self, approval_id: str) -> Approval | None: ...

    async def mark_used(self, approval_id: str, use_key: str) -> bool:
        """True nếu chưa dùng hoặc đã dùng với cùng `use_key` (chạy lại an toàn); False nếu đã dùng cho việc khác."""
        ...


class PiiPort(Protocol):
    """Kho dữ liệu cá nhân hạn ngắn của backend (D16). Chỉ `transaction` gọi; không log, không lưu vào state."""

    async def get(self, pii_ref: str) -> dict[str, Any]: ...


@dataclass(frozen=True)
class CommitRequest:
    """Một commit action đã được approve. Chỉ tồn tại trong bộ nhớ của node `transaction`.

    `pii` là dữ liệu cá nhân lấy qua `PiiPort`; object này không bao giờ được ghi vào state hay log.
    """

    action: CommitAction
    option_id: str
    amount_vnd: int  # giá người dùng thấy lúc xác nhận
    idempotency_key: str
    approval: Approval
    min_amount_vnd: int = 0  # khoảng giá thực tế người dùng đã đồng ý (mặc định = amount_vnd)
    max_amount_vnd: int = 0
    option: dict[str, Any] = field(default_factory=dict)  # phần tử đã chọn trong data của task nguồn
    task_data: dict[str, Any] = field(default_factory=dict)
    pii: dict[str, Any] = field(default_factory=dict, repr=False)

    def price_accepted(self, price: int) -> bool:
        """Giá thực tế nằm trong khoảng người dùng đã đồng ý ở bước xác nhận."""
        low = self.min_amount_vnd or self.amount_vnd
        high = self.max_amount_vnd or self.amount_vnd
        return low <= price <= high


class CommitError(Exception):
    """Lỗi commit có cấu trúc. `uncertain=True`: không rõ provider đã ghi chưa → `pending_verification`."""

    def __init__(self, message: str, *, uncertain: bool = False, code: str = "commit_failed"):
        super().__init__(message)
        self.message, self.uncertain, self.code = message, uncertain, code


class TransactionPort(Protocol):
    """Commit tất định theo `CommitActionKind`, không qua LLM (§6.9, R3)."""

    async def lookup(self, idempotency_key: str) -> Receipt | None: ...

    async def commit(self, req: CommitRequest) -> Receipt:
        """Thao tác ghi không qua Payment (ví dụ đặt xe trả tiền mặt, huỷ đơn)."""
        ...

    async def start_payment(self, req: CommitRequest) -> PendingPayment:
        """Các bước trước thanh toán (ví dụ giữ chỗ) rồi tạo yêu cầu thanh toán; idempotent theo action."""
        ...

    async def payment_status(self, payment_ref: str) -> str:
        """Luôn hỏi cổng thanh toán: PENDING / PAID / FAILED / EXPIRED / CANCELLED."""
        ...

    async def cancel_payment(self, payment_ref: str) -> str: ...

    async def simulate_payment(self, payment_ref: str, outcome: str) -> str:
        """Chỉ cho demo với cổng mock: ép kết quả PAID / FAILED / EXPIRED của giao dịch đang PENDING."""
        ...

    async def complete_after_payment(self, req: CommitRequest, pending: PendingPayment) -> Receipt:
        """Bước sau khi đã PAID (ví dụ xuất vé)."""
        ...

    async def abort_after_payment(self, req: CommitRequest, pending: PendingPayment) -> None:
        """Thanh toán không thành: huỷ phần đã giữ (ví dụ huỷ giữ chỗ vé)."""
        ...

    async def compensate(self, receipt: Receipt) -> None: ...


class UsageMeter(Protocol):
    """Đo LLM call / call subagent theo request và thread (§7.5). Không nằm trong WorkflowState."""

    async def record_llm(
        self, thread_id: str, request_id: str, node: str, model: str, tokens_in: int, tokens_out: int
    ) -> None: ...

    async def record_subagent(
        self, thread_id: str, request_id: str, agent: AgentName, cost_tier: str, usage: AgentUsage, elapsed_ms: int
    ) -> None: ...

    async def counts(self, thread_id: str, request_id: str | None = None) -> UsageCounts: ...
