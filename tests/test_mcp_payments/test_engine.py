import pytest
from relohome_payment.engine import PaymentEngine
from relohome_payment.errors import InvalidRequestError, PaymentStateError

from tests.test_mcp_payments.helpers import FakeClock


@pytest.mark.asyncio
async def test_create_is_idempotent_per_order_and_amount(engine: PaymentEngine) -> None:
    first = await engine.create("bk_1", 100_000)
    assert first.status == "PENDING" and first.pay_url and first.qr_code
    assert (await engine.create("bk_1", 100_000)).payment_id == first.payment_id
    assert (await engine.create("bk_1", 120_000)).payment_id != first.payment_id


@pytest.mark.parametrize("amount", [999, 50_000_001])
@pytest.mark.asyncio
async def test_rejects_out_of_range_amount(engine: PaymentEngine, amount: int) -> None:
    with pytest.raises(InvalidRequestError):
        await engine.create("bk_1", amount)


@pytest.mark.asyncio
async def test_full_mock_lifecycle(engine: PaymentEngine) -> None:
    payment = await engine.create("bk_1", 100_000)
    paid = await engine.simulate(payment.payment_id, "PAID")
    assert paid.status == "PAID"
    assert (await engine.get(payment.gateway_ref)).status == "PAID"  # tra được bằng mã đơn gửi cổng

    quote = await engine.refund(payment.payment_id)
    assert (quote.refunded, quote.status) == (False, "PAID")
    done = await engine.refund(payment.payment_id, confirm=True)
    assert (done.refunded, done.status, done.amount) == (True, "REFUNDED", 100_000)
    assert (await engine.refund(payment.payment_id, confirm=True)).refunded  # gọi lại không lỗi


@pytest.mark.asyncio
async def test_new_payment_allowed_after_failure(engine: PaymentEngine) -> None:
    failed = await engine.simulate((await engine.create("bk_1", 100_000)).payment_id, "FAILED")
    assert failed.status == "FAILED"
    assert (await engine.create("bk_1", 100_000)).payment_id != failed.payment_id


@pytest.mark.asyncio
async def test_simulate_expired_link(engine: PaymentEngine) -> None:
    payment = await engine.create("bk_1", 100_000)
    expired = await engine.simulate(payment.payment_id, "EXPIRED")
    assert expired.status == "EXPIRED"
    assert (await engine.create("bk_1", 100_000)).payment_id != payment.payment_id  # tạo lại được đơn mới


@pytest.mark.asyncio
async def test_pending_expires(engine: PaymentEngine, clock: FakeClock) -> None:
    payment = await engine.create("bk_1", 100_000)
    clock.advance(16)
    assert (await engine.get(payment.payment_id)).status == "EXPIRED"
    with pytest.raises(PaymentStateError):
        await engine.simulate(payment.payment_id, "PAID")


@pytest.mark.asyncio
async def test_cancel_only_pending(engine: PaymentEngine) -> None:
    payment = await engine.create("bk_1", 100_000)
    assert (await engine.cancel(payment.payment_id)).status == "CANCELLED"
    assert (await engine.cancel(payment.payment_id)).status == "CANCELLED"
    with pytest.raises(PaymentStateError):
        await engine.refund(payment.payment_id)


@pytest.mark.asyncio
async def test_old_records_are_purged(engine: PaymentEngine, clock: FakeClock) -> None:
    old = await engine.create("bk_old", 100_000)
    clock.advance(31 * 24 * 60)
    await engine.create("bk_new", 100_000)
    with pytest.raises(Exception, match="Không tìm thấy"):
        await engine.get(old.payment_id)
