from relohome_payment.gateways.base import GatewayOrder, GatewayStatus, PaymentGateway
from relohome_payment.gateways.mock import MockPaymentGateway
from relohome_payment.gateways.zalopay import ZaloPayGateway
from relohome_payment.settings import PaymentSettings

__all__ = [
    "GatewayOrder",
    "GatewayStatus",
    "MockPaymentGateway",
    "PaymentGateway",
    "ZaloPayGateway",
    "create_gateway",
]


def create_gateway(settings: PaymentSettings) -> PaymentGateway:
    """Chọn cổng theo PAYMENT_PROVIDER."""
    if settings.provider == "zalopay":
        if not (settings.zalopay_app_id and settings.zalopay_key1):
            raise ValueError("PAYMENT_PROVIDER=zalopay nhưng chưa đặt PAYMENT_ZALOPAY_APP_ID / PAYMENT_ZALOPAY_KEY1")
        return ZaloPayGateway(settings)
    return MockPaymentGateway()
