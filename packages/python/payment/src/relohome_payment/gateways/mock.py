from relohome_payment.gateways.base import GatewayOrder, GatewayStatus

MOCK_CHECKOUT_URL = "https://mock-pay.invalid/checkout"


class MockPaymentGateway:
    """Cổng giả lập offline. Kết quả thanh toán do `simulate_payment_result` quyết định (lưu trong DB)."""

    name = "mock"
    supports_cancel_refund = True

    async def create(
        self, gateway_ref: str, amount: int, app_user: str, description: str, expire_seconds: int
    ) -> GatewayOrder:
        return GatewayOrder(pay_url=f"{MOCK_CHECKOUT_URL}/{gateway_ref}", qr_code=f"MOCKPAY|{gateway_ref}|{amount}")

    async def query(self, gateway_ref: str) -> GatewayStatus:
        return "PENDING"
