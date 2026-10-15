"""Giao dịch dịch vụ, lần thanh toán và công việc hoàn tất (payment-design §6)."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

Domain = Literal["flight", "relocation", "property"]
# Kết luận của app về một lần thanh toán (§6.2). Trạng thái do cổng trả nằm ở `gateway_status`.
Outcome = Literal[
    "processing",  # đang kiểm giá / giữ chỗ / tạo đơn
    "awaiting_payment",
    "needs_reconciliation",
    "paid_verified",
    "paid_simulated",
    "not_paid",
    "cancelled",
]
PAID = frozenset({"paid_verified", "paid_simulated"})
OPEN = frozenset({"processing", "awaiting_payment", "needs_reconciliation"})
GatewayStatus = Literal["none", "creating", "pending", "paid", "failed", "expired", "cancelled", "unknown"]


class ServiceTransaction(BaseModel):
    transaction_id: str
    user_id: str
    thread_id: str
    logical_key: str
    domain: Domain
    task_id: str = ""
    option_id: str
    option_version: int = 1
    status: str
    price_vnd: int | None = None
    # kind: one_way | round_trip | moving_quote | rent; không tự cộng hay chia giá provider trả.
    price_scope: dict[str, Any] = Field(default_factory=dict)
    price_source: str = ""
    price_read_at: datetime | None = None
    price_expires_at: datetime | None = None
    amount_kind: Literal["one_time", "monthly", "deposit_to_landlord"] = "one_time"
    payee: str = ""
    mode: Literal["simulated", "staging", "sandbox", "user_reported"] = "simulated"
    title: str = ""
    lines: list[dict[str, Any]] = Field(default_factory=list)
    legs: list[dict[str, Any]] = Field(default_factory=list)
    passenger_counts: dict[str, int] | None = None
    details: dict[str, Any] = Field(default_factory=dict)
    superseded: bool = False
    created_at: datetime
    updated_at: datetime


class PaymentAttempt(BaseModel):
    attempt_id: str
    transaction_id: str
    user_id: str
    thread_id: str
    idempotency_key: str
    payload_hash: str
    option_version: int
    passenger_ref: str | None = None
    passenger_version: int | None = None
    amount_vnd: int
    lines: list[dict[str, Any]] = Field(default_factory=list)
    # Bước cuối đã ghi ý định trước khi gọi bên ngoài (ghi ý định → gọi → ghi kết quả).
    step: Literal["created", "price_checked", "holding", "held", "creating_payment", "payment_created", "done"] = (
        "created"
    )
    hold: dict[str, Any] | None = None  # booking_id, pnr, hold_expires_at (không có dữ liệu cá nhân)
    payment_id: str | None = None
    pay_url: str | None = None
    qr_code: str | None = None
    expires_at: datetime | None = None
    gateway_status: GatewayStatus = "none"
    tester_mark: dict[str, Any] | None = None
    outcome: Outcome = "processing"
    reconciled_at: datetime | None = None
    note: str = ""
    created_at: datetime
    updated_at: datetime


class FulfilmentJob(BaseModel):
    job_id: str
    transaction_id: str
    attempt_id: str
    kind: Literal["flight_ticket", "moving_approve"]
    status: Literal["pending", "done", "failed"] = "pending"
    tries: int = 0
    last_error: str = ""
    created_at: datetime
    updated_at: datetime


class CheckoutError(Exception):
    """Lỗi nghiệp vụ trả cho UI (không lộ dữ liệu cá nhân hay khóa)."""

    def __init__(self, status: int, message: str, code: str = "checkout_error"):
        super().__init__(message)
        self.status, self.message, self.code = status, message, code
