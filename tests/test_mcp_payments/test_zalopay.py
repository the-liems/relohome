import logging
from datetime import timedelta

import httpx
import pytest
from relohome_payment.engine import PaymentEngine
from relohome_payment.errors import GatewayUnavailableError, PaymentStateError
from relohome_payment.gateways import ZaloPayGateway, create_gateway
from relohome_payment.gateways.zalopay import sign
from relohome_payment.settings import PaymentSettings
from relohome_payment.storage import PaymentDatabase

from tests.test_mcp_payments.helpers import TEST_APP_ID, TEST_KEY1, TEST_KEY2, FakeClock, FakeZaloPay


def test_mac_matches_zalopay_spec() -> None:
    # HMAC-SHA256(key1, app_id|app_trans_id|app_user|amount|app_time|embed_data|item)
    mac = sign("k", 2553, "260101_P044_00000000", "u", 1000, 1, "{}", "[]")
    assert mac == sign("k", "2553|260101_P044_00000000|u|1000|1|{}|[]")


@pytest.mark.asyncio
async def test_create_and_query_status_mapping(zalopay_engine: PaymentEngine, fake_zalopay: FakeZaloPay) -> None:
    payment = await zalopay_engine.create("bk_1", 100_000)
    assert payment.provider == "zalopay" and payment.pay_url.startswith("https://qcgateway.zalopay.vn")
    assert "TOKEN_SHOULD_NOT_LEAK" not in payment.model_dump_json()

    assert (await zalopay_engine.get(payment.payment_id)).status == "PENDING"
    path, form = fake_zalopay.forms[-1]
    assert path == "query" and form["mac"] == sign(TEST_KEY1, TEST_APP_ID, payment.gateway_ref, TEST_KEY1)

    fake_zalopay.query_code = 1
    assert (await zalopay_engine.get(payment.payment_id)).status == "PAID"


@pytest.mark.asyncio
async def test_failed_query(zalopay_engine: PaymentEngine, fake_zalopay: FakeZaloPay) -> None:
    payment = await zalopay_engine.create("bk_1", 100_000)
    fake_zalopay.query_code = 2
    assert (await zalopay_engine.get(payment.payment_id)).status == "FAILED"


@pytest.mark.parametrize("expire_minutes", [5, 15, 60, 1440])
@pytest.mark.asyncio
async def test_configured_expiry_is_sent_to_zalopay_and_applied_locally(
    db: PaymentDatabase, settings: PaymentSettings, clock: FakeClock, fake_zalopay: FakeZaloPay, expire_minutes: int
) -> None:
    settings = settings.model_copy(update={"expire_minutes": expire_minutes})
    async with fake_zalopay.client() as client:
        engine = PaymentEngine(db, ZaloPayGateway(settings, client=client), settings, clock=clock)
        payment = await engine.create("bk_expiry", 100_000)

        path, form = fake_zalopay.forms[0]
        assert path == "create"
        assert form["expire_duration_seconds"] == str(expire_minutes * 60)
        assert payment.expires_at == payment.created_at + timedelta(minutes=expire_minutes)

        clock.advance(expire_minutes - 1)
        assert (await engine.get(payment.payment_id)).status == "PENDING"
        clock.advance(1)
        assert (await engine.get(payment.payment_id)).status == "EXPIRED"


@pytest.mark.asyncio
async def test_rejected_create_and_http_error(zalopay_engine: PaymentEngine, fake_zalopay: FakeZaloPay) -> None:
    fake_zalopay.create_code = 2
    with pytest.raises(GatewayUnavailableError, match="từ chối tạo đơn"):
        await zalopay_engine.create("bk_1", 100_000)
    fake_zalopay.create_code, fake_zalopay.status = 1, 500
    with pytest.raises(GatewayUnavailableError, match="HTTP 500"):
        await zalopay_engine.create("bk_2", 100_000)


@pytest.mark.asyncio
async def test_timeout_error_hides_secrets(settings: PaymentSettings, caplog: pytest.LogCaptureFixture) -> None:
    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("timeout", request=request)

    gateway = ZaloPayGateway(settings, client=httpx.AsyncClient(transport=httpx.MockTransport(boom)))
    caplog.set_level(logging.DEBUG)
    with pytest.raises(GatewayUnavailableError) as exc:
        await gateway.create("260101_P044_00000000", 1000, "u", "d", 900)
    for secret in (TEST_KEY1, TEST_KEY2):
        assert secret not in str(exc.value) and secret not in caplog.text


@pytest.mark.asyncio
async def test_zalopay_cannot_cancel_or_refund(zalopay_engine: PaymentEngine, fake_zalopay: FakeZaloPay) -> None:
    payment = await zalopay_engine.create("bk_1", 100_000)
    with pytest.raises(PaymentStateError, match="không có API hủy"):
        await zalopay_engine.cancel(payment.payment_id)
    fake_zalopay.query_code = 1
    with pytest.raises(PaymentStateError, match="chưa được hỗ trợ"):
        await zalopay_engine.refund(payment.payment_id)
    with pytest.raises(PaymentStateError, match="mock"):
        await zalopay_engine.simulate(payment.payment_id, "PAID")


def test_create_gateway_requires_credentials(settings: PaymentSettings) -> None:
    assert create_gateway(settings).name == "mock"
    assert create_gateway(settings.model_copy(update={"provider": "zalopay"})).name == "zalopay"
    with pytest.raises(ValueError, match="PAYMENT_ZALOPAY"):
        create_gateway(settings.model_copy(update={"provider": "zalopay", "zalopay_key1": ""}))
