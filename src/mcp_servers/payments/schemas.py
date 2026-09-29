from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

PaymentStatus = Literal["PENDING", "PAID", "FAILED", "CANCELLED", "EXPIRED", "REFUNDED"]
SimulatedOutcome = Literal["PAID", "FAILED", "EXPIRED"]

# Giới hạn của MVP (VND). Không phải hạn mức chính thức của ZaloPay.
MIN_AMOUNT = 1_000
MAX_AMOUNT = 50_000_000


class Payment(BaseModel):
    payment_id: str = Field(description="Mã giao dịch nội bộ (pay_...), dùng cho get/cancel/refund")
    order_ref: str = Field(description="Mã tham chiếu do bên gọi đặt; chỉ lưu nội bộ, không gửi cho cổng thanh toán")
    gateway_ref: str = Field(description="Mã đơn gửi cho cổng thanh toán: yymmdd_<tiền tố nhóm>_<hex ngẫu nhiên>")
    provider: Literal["mock", "zalopay"]
    amount: int = Field(description="Số tiền (VND)")
    currency: str = "VND"
    status: PaymentStatus
    pay_url: str | None = Field(default=None, description="Link thanh toán cho khách")
    qr_code: str | None = Field(default=None, description="Chuỗi QR để hiển thị mã thanh toán")
    expires_at: datetime = Field(description="Sau thời điểm này đơn không còn thanh toán được")
    refund_amount: int | None = None
    created_at: datetime
    updated_at: datetime


class RefundResult(BaseModel):
    payment_id: str
    status: PaymentStatus
    refunded: bool = Field(description="False nghĩa là mới báo số tiền hoàn, chưa hoàn")
    amount: int
    currency: str = "VND"
    message: str
