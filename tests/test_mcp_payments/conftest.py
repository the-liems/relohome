from collections.abc import Iterator

import pytest
from relohome_payment.engine import PaymentEngine
from relohome_payment.gateways import MockPaymentGateway, ZaloPayGateway
from relohome_payment.settings import PaymentSettings
from relohome_payment.storage import PaymentDatabase

from tests.test_mcp_payments.helpers import TEST_APP_ID, TEST_KEY1, TEST_KEY2, FakeClock, FakeZaloPay


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def settings() -> PaymentSettings:
    # _env_file=None: không đọc .env của máy dev để test luôn chạy với key giả
    return PaymentSettings(
        _env_file=None,
        db_path=":memory:",
        provider="mock",
        order_prefix="P044",
        zalopay_app_id=TEST_APP_ID,
        zalopay_key1=TEST_KEY1,
        zalopay_key2=TEST_KEY2,
        zalopay_endpoint="https://sb-openapi.zalopay.vn/v2",
    )


@pytest.fixture
def db() -> Iterator[PaymentDatabase]:
    database = PaymentDatabase(":memory:")
    yield database
    database.close()


@pytest.fixture
def engine(db: PaymentDatabase, settings: PaymentSettings, clock: FakeClock) -> PaymentEngine:
    return PaymentEngine(db, MockPaymentGateway(), settings, clock=clock)


@pytest.fixture
def fake_zalopay() -> FakeZaloPay:
    return FakeZaloPay()


@pytest.fixture
def zalopay_engine(
    db: PaymentDatabase, settings: PaymentSettings, clock: FakeClock, fake_zalopay: FakeZaloPay
) -> PaymentEngine:
    gateway = ZaloPayGateway(settings, client=fake_zalopay.client())
    return PaymentEngine(db, gateway, settings, clock=clock)
