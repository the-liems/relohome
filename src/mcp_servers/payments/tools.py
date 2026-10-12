from dataclasses import dataclass
from typing import Annotated

from pydantic import Field
from relohome_payment.engine import PaymentEngine
from relohome_payment.gateways import create_gateway
from relohome_payment.schemas import MAX_AMOUNT, MIN_AMOUNT, Payment, RefundResult, SimulatedOutcome
from relohome_payment.settings import PaymentSettings, get_payment_settings
from relohome_payment.storage import PaymentDatabase

# order_ref/customer_ref cố ý KHÔNG dùng ràng buộc Pydantic (pattern, max_length): lỗi validate của
# Pydantic in lại giá trị đầu vào, có thể làm lộ email/SĐT. Engine tự kiểm tra và báo lỗi không kèm giá trị.
OrderRef = Annotated[str, Field(description="Mã nội bộ vô danh của đơn hàng, ví dụ booking_id 'bk_1a2b3c'")]
PaymentRef = Annotated[str, Field(description="payment_id (pay_...) hoặc mã đơn gửi cổng (yymmdd_P044_...)")]


@dataclass
class PaymentServices:
    engine: PaymentEngine


def build_services(settings: PaymentSettings | None = None) -> PaymentServices:
    """Khởi tạo cổng + SQLite theo cấu hình PAYMENT_*."""
    settings = settings or get_payment_settings()
    db = PaymentDatabase(settings.db_path)
    return PaymentServices(engine=PaymentEngine(db, create_gateway(settings), settings))


class PaymentTools:
    """Cài đặt các MCP tool. Docstring của mỗi method chính là mô tả tool mà LLM đọc."""

    def __init__(self, services: PaymentServices) -> None:
        self._engine = services.engine

    async def create_payment(
        self,
        order_ref: OrderRef,
        amount: Annotated[int, Field(ge=MIN_AMOUNT, le=MAX_AMOUNT, description="Số tiền VND (số nguyên)")],
        customer_ref: Annotated[
            str, Field(description="Mã khách nội bộ vô danh; server chỉ gửi bản băm của mã này cho cổng")
        ] = "guest",
    ) -> Payment:
        """Tạo yêu cầu thanh toán và trả link/QR cho khách.

        TUYỆT ĐỐI không truyền tên, email, số điện thoại hay số giấy tờ: chỉ dùng mã nội bộ ngẫu nhiên
        (server sẽ từ chối nếu phát hiện). Gọi lại với cùng order_ref và amount sẽ trả giao dịch cũ.
        Sau khi khách trả, dùng get_payment để kiểm tra trạng thái.
        """
        return await self._engine.create(order_ref, amount, customer_ref)

    async def get_payment(self, payment_ref: PaymentRef) -> Payment:
        """Xem trạng thái giao dịch (PENDING/PAID/FAILED/EXPIRED/CANCELLED/REFUNDED), tự hỏi lại cổng nếu đang PENDING."""
        return await self._engine.get(payment_ref)

    async def cancel_payment(self, payment_ref: PaymentRef) -> Payment:
        """Hủy giao dịch chưa thanh toán. Cổng không hỗ trợ hủy thì báo giờ đơn tự hết hạn."""
        return await self._engine.cancel(payment_ref)

    async def refund_payment(
        self,
        payment_ref: PaymentRef,
        confirm: Annotated[bool, Field(description="false = chỉ báo số tiền hoàn; true = hoàn thật")] = False,
    ) -> RefundResult:
        """Hoàn tiền giao dịch đã PAID. Luôn gọi confirm=false trước để báo cho người dùng,
        chỉ gọi confirm=true khi họ đồng ý."""
        return await self._engine.refund(payment_ref, confirm)

    async def simulate_payment_result(self, payment_ref: PaymentRef, outcome: SimulatedOutcome) -> Payment:
        """CHỈ CÓ Ở CHẾ ĐỘ MOCK: giả lập khách đã trả (PAID), thất bại (FAILED) hoặc để link hết hạn (EXPIRED)
        để demo. Chỉ áp dụng cho giao dịch đang PENDING."""
        return await self._engine.simulate(payment_ref, outcome)
