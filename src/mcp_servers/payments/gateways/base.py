from dataclasses import dataclass
from typing import Literal, Protocol

GatewayStatus = Literal["PENDING", "PAID", "FAILED"]


@dataclass(frozen=True)
class GatewayOrder:
    pay_url: str | None
    qr_code: str | None


class PaymentGateway(Protocol):
    """Giao diện chung cho mọi cổng thanh toán (mock, ZaloPay...).

    Cổng chỉ nhận dữ liệu vô danh đã được engine chuẩn bị: mã đơn ngẫu nhiên, số tiền,
    định danh giả danh và mô tả cố định. Không bao giờ nhận thông tin khách hàng.
    """

    name: str
    supports_cancel_refund: bool

    async def create(
        self, gateway_ref: str, amount: int, app_user: str, description: str, expire_seconds: int
    ) -> GatewayOrder:
        """Tạo đơn trên cổng, trả link/QR thanh toán."""
        ...

    async def query(self, gateway_ref: str) -> GatewayStatus:
        """Hỏi cổng trạng thái hiện tại của đơn."""
        ...
