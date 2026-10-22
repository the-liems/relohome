"""Thanh toán của app: khóa chống trùng, đối soát, nút tester, công việc hoàn tất bền, nhà tự báo (payment-design)."""

from __future__ import annotations

import asyncio
import sqlite3
from datetime import UTC, datetime, timedelta

import pytest
from relohome_agent.agents.models import AgentName, ConfirmedFact, IntakeResult, RequestKind, TaskResult
from relohome_agent.agents.subagents.services.moving import QuoteContact
from relohome_agent.checkout.models import CheckoutError
from relohome_agent.checkout.service import CheckoutService, CheckoutSettings
from relohome_agent.checkout.store import CheckoutStore
from relohome_agent.services.adapters.mcp import ToolCallError

NOW = datetime(2026, 10, 8, 2, 0, tzinfo=UTC)
USER, OTHER, THREAD = "user-a", "user-b", "th_1"
PEOPLE = {
    "passengers": [
        {"type": "adult", "title": "MR", "first_name": "Van An", "last_name": "Nguyen", "date_of_birth": "1990-01-01"}
    ],
    "contact": {"email": "a@example.com", "phone": "0901234567"},
}


class Clock:
    def __init__(self):
        self.now = NOW

    def __call__(self):
        return self.now


class FakePii:
    def __init__(self):
        self.items = {}

    async def put(self, data):
        ref = f"pii_{len(self.items)}"
        self.items[ref] = data
        return ref


class FakeFlight:
    def __init__(self, price=1_500_000):
        self.price = price
        self.calls: list[tuple[str, dict]] = []
        self.hold_expires = (NOW + timedelta(minutes=15)).isoformat()
        self.confirm_error: ToolCallError | None = None

    async def call(self, tool, args):
        self.calls.append((tool, args))
        if tool == "get_offer":
            return {"offer": {"offer_id": args["offer_id"], "total_price": self.price}}
        if tool == "hold_booking":
            return {
                "booking_id": "bk_1",
                "pnr": "ABCDEF",
                "total_price": self.price,
                "hold_expires_at": self.hold_expires,
            }
        if tool == "confirm_booking":
            if self.confirm_error:
                raise self.confirm_error
            return {"pnr": "ABCDEF", "ticket_numbers": ["978-1"], "status": "TICKETED"}
        if tool == "cancel_booking":
            return {"cancelled": True}
        raise AssertionError(tool)


class FakePayment:
    def __init__(self, clock):
        self.clock = clock
        self.status = "PENDING"
        self.calls: list[tuple[str, dict]] = []
        self.create_error: ToolCallError | None = None
        self.orders: dict[str, dict] = {}

    async def call(self, tool, args):
        self.calls.append((tool, args))
        if tool == "create_payment":
            if self.create_error:
                error, self.create_error = self.create_error, None
                raise error
            order = self.orders.setdefault(
                args["order_ref"],
                {
                    "payment_id": f"pay_{len(self.orders)}",
                    "qr_code": "zalopay://qr",
                    "pay_url": "https://sb-openapi.zalopay.vn/pay",
                    "expires_at": (self.clock() + timedelta(minutes=15)).isoformat(),
                },
            )
            return order
        if tool == "get_payment":
            return {"status": self.status}
        raise AssertionError(tool)


class FakeMoving:
    def __init__(self, total=300_000):
        self.total = total
        self.calls = []

    async def call(self, tool, args):
        self.calls.append((tool, args))
        assert tool == "estimate_move"
        assert "checkout_mode" not in str(args)
        return {
            "quote": {"quote_id": "q2", "options": [{"service_id": "SGN-TRUCK", "fee": {"total_price": self.total}}]}
        }


def fact(value):
    return ConfirmedFact(value=value, evidence=str(value), stated_at=NOW)


def flight_values(option="off_1", kind="one_way", price=1_500_000):
    result = TaskResult(
        task_id="flight_1",
        agent=AgentName.FLIGHT,
        plan_version=1,
        status="done",
        data={
            "origin": "HAN",
            "destination": "SGN",
            "passengers": {"adults": 1},
            "offers": [
                {
                    "id": option,
                    "carrier": "Vietjet",
                    "fare_vnd": price,
                    "depart_at": "2026-10-20T05:40:00+07:00",
                    "arrive_at": "2026-10-20T07:00:00+07:00",
                    "expires_at": (NOW + timedelta(minutes=30)).isoformat(),
                    "kind": kind,
                }
            ],
        },
        source_kind="live",
        fetched_at=NOW,
    )
    intake = IntakeResult(kind=RequestKind.NEW_GOAL, user_confirmed_facts={"selected:flight": fact(option)})
    return {"intake": intake, "task_results": {"flight_1": result}}


def moving_values(price=300_000):
    result = TaskResult(
        task_id="moving_1",
        agent=AgentName.RELOCATION,
        plan_version=1,
        status="done",
        data={
            "quote_id": "q1",
            "expires_at": (NOW + timedelta(minutes=10)).isoformat(),
            "route": {
                "pickup": {"address": "A", "lat": 10.7, "lng": 106.6},
                "destination": {"address": "B", "lat": 10.8, "lng": 106.7},
                "order_time": int((NOW + timedelta(days=2)).timestamp()),
            },
            "moving_options": {"service_id": "SGN-TRUCK"},
            "from_address": "A",
            "to_address": "B",
            "quotes": [
                {"id": "q1:SGN-TRUCK", "service_id": "SGN-TRUCK", "price_vnd": price, "vehicle": "Xe tải 500kg"}
            ],
        },
        source_kind="sandbox",
        fetched_at=NOW,
    )
    intake = IntakeResult(kind=RequestKind.NEW_GOAL, user_confirmed_facts={"selected:relocation": fact("q1:SGN-TRUCK")})
    return {"intake": intake, "task_results": {"moving_1": result}}


def house_values():
    result = TaskResult(
        task_id="house_1",
        agent=AgentName.PROPERTY,
        plan_version=1,
        status="done",
        data={"candidates": [{"id": "h1", "title": "Phòng 1", "price_vnd": 4_000_000, "address": "Q1"}]},
        source_kind="live",
        fetched_at=NOW,
    )
    intake = IntakeResult(kind=RequestKind.NEW_GOAL, user_confirmed_facts={"selected:property": fact("h1")})
    return {"intake": intake, "task_results": {"house_1": result}}


@pytest.fixture
def env():
    clock = Clock()
    flight, payment, moving = FakeFlight(), FakePayment(clock), FakeMoving()
    service = CheckoutService(
        store=CheckoutStore(sqlite3.connect(":memory:", isolation_level=None)),
        pii=FakePii(),
        secret=b"k" * 32,
        flight=flight,
        payment=payment,
        moving=moving,
        moving_contact=QuoteContact("SIU", "0900000000"),
        settings=CheckoutSettings(tester_confirm_enabled=True, tester_user_ids=frozenset({USER})),
        clock=clock,
    )
    return service, clock, flight, payment, moving


async def pay_flight(service, values=None, key="request-key-0001"):
    summary = service.summary(USER, THREAD, values or flight_values(), "flight")
    return summary, await service.pay(USER, summary["transaction_id"], summary["payload_hash"], key, PEOPLE)


@pytest.mark.asyncio
async def test_flight_payment_creates_one_order_and_keeps_pii_out(env):
    service, _, flight, payment, _ = env
    summary, attempt = await pay_flight(service)
    assert summary["price_scope"]["reference"] is True and summary["mode"] == "simulated"
    assert attempt["outcome"] == "awaiting_payment" and attempt["has_qr"]
    assert [c[0] for c in flight.calls] == ["get_offer", "hold_booking"]
    hold = flight.calls[1][1]["request"]
    assert hold["passenger_ref"].startswith("pii_")
    # Hai tab gửi cùng nội dung: không tạo đơn thứ hai.
    again = await service.pay(USER, summary["transaction_id"], summary["payload_hash"], "request-key-0002", PEOPLE)
    assert again["attempt_id"] == attempt["attempt_id"]
    assert [c[0] for c in payment.calls].count("create_payment") == 1
    stored = service.store.db.execute("SELECT data FROM checkout_attempts").fetchone()[0]
    stored += service.store.db.execute("SELECT data FROM checkout_transactions").fetchone()[0]
    assert "VAN AN" not in stored.upper()
    assert "0901234567" not in stored and "a@example.com" not in stored
    assert "passenger_ref" not in attempt and "idempotency_key" not in attempt


@pytest.mark.asyncio
async def test_round_trip_outbound_cannot_be_paid(env):
    service, *_ = env
    with pytest.raises(CheckoutError) as exc:
        service.summary(USER, THREAD, flight_values(kind="round_trip_outbound"), "flight")
    assert exc.value.status == 409


@pytest.mark.asyncio
async def test_payload_change_invalidates_old_confirmation(env):
    service, *_ = env
    summary = service.summary(USER, THREAD, flight_values(), "flight")
    changed = service.summary(USER, THREAD, flight_values(option="off_2"), "flight")
    assert changed["option_version"] == 2 and changed["transaction_id"] != summary["transaction_id"]
    with pytest.raises(CheckoutError):
        await service.pay(USER, summary["transaction_id"], summary["payload_hash"], "request-key-0001", PEOPLE)


@pytest.mark.asyncio
async def test_price_change_requires_new_confirmation(env):
    service, _, flight, payment, _ = env
    flight.price = 1_600_000
    summary = service.summary(USER, THREAD, flight_values(), "flight")
    with pytest.raises(CheckoutError) as exc:
        await service.pay(USER, summary["transaction_id"], summary["payload_hash"], "request-key-0001", PEOPLE)
    assert exc.value.code == "price_changed" and not payment.calls
    fresh = service.summary(USER, THREAD, flight_values(), "flight")
    assert fresh["price_vnd"] == 1_600_000 and fresh["payload_hash"] != summary["payload_hash"]


@pytest.mark.asyncio
async def test_tester_mark_then_gateway_paid_fulfils_once(env):
    service, _, flight, payment, _ = env
    _, attempt = await pay_flight(service)
    marked = await service.tester_paid(USER, attempt["attempt_id"])
    assert marked["outcome"] == "paid_simulated" and marked["tester_marked"]
    await service.run_jobs()
    payment.status = "PAID"
    checked = await service.check(USER, attempt["attempt_id"])
    assert checked["outcome"] == "paid_verified"
    await service.run_jobs()
    assert [c[0] for c in flight.calls].count("confirm_booking") == 1
    tx = service.store.get_tx(attempt["transaction_id"])
    assert tx.status == "ticketed" and tx.details["ticket"]["simulated"]


@pytest.mark.asyncio
async def test_fulfilment_retry_completes_pending_job(env, monkeypatch):
    service, _, flight, _, _ = env
    monkeypatch.setattr(service, "kick", lambda: None)
    _, attempt = await pay_flight(service)
    await service.tester_paid(USER, attempt["attempt_id"])
    flight.confirm_error = ToolCallError("timeout", "temporary failure", retryable=True)
    await service.run_jobs()
    pending = service.store.job_for(attempt["transaction_id"])
    assert pending.status == "pending" and pending.last_error == "timeout"

    flight.confirm_error = None
    await service.run_jobs()
    completed = service.store.job_for(attempt["transaction_id"])
    assert completed.status == "done" and completed.last_error == ""


@pytest.mark.asyncio
async def test_tester_control_requires_flag_list_ownership_and_unexpired(env):
    service, clock, *_ = env
    _, attempt = await pay_flight(service)
    with pytest.raises(CheckoutError) as exc:
        await service.tester_paid(OTHER, attempt["attempt_id"])
    assert exc.value.status == 403
    service.settings.tester_user_ids = frozenset({USER, OTHER})
    with pytest.raises(CheckoutError) as exc:
        await service.tester_paid(OTHER, attempt["attempt_id"])
    assert exc.value.status == 404  # không sở hữu giao dịch
    service.settings.production = True
    with pytest.raises(CheckoutError):
        await service.tester_paid(USER, attempt["attempt_id"])
    service.settings.production = False
    clock.now += timedelta(minutes=16)
    with pytest.raises(CheckoutError) as exc:
        await service.tester_paid(USER, attempt["attempt_id"])
    assert exc.value.status == 409


@pytest.mark.asyncio
async def test_expiry_waits_for_grace_then_reconciles_late_payment(env, caplog):
    service, clock, flight, payment, _ = env
    _, attempt = await pay_flight(service)
    clock.now += timedelta(minutes=15, seconds=10)
    payment.calls.clear()
    pending = await service.check(USER, attempt["attempt_id"])
    # Trong thời gian chờ: tra cổng (chỉ đọc) nhưng chưa kết luận khi cổng chưa báo đã trả.
    assert pending["outcome"] == "needs_reconciliation"
    assert [c[0] for c in payment.calls] == ["get_payment"]
    # Chưa xác định an toàn thì không tạo lần thanh toán mới.
    _, again = await pay_flight(service, key="request-key-0003")
    assert again["attempt_id"] == attempt["attempt_id"] and again["outcome"] == "needs_reconciliation"
    assert not [c for c in payment.calls if c[0] == "create_payment"]
    payment.status = "PAID"
    clock.now += timedelta(minutes=4)
    paid = await service.check(USER, attempt["attempt_id"])
    assert paid["outcome"] == "paid_verified"
    flight.confirm_error = ToolCallError("BookingStateError", "hold expired")
    await service.run_jobs()
    tx = service.store.get_tx(attempt["transaction_id"])
    # Đã trả nhưng giữ chỗ hết hạn: giữ sự kiện thanh toán, cần xử lý.
    assert tx.status == "paid_unfulfilled"
    assert f"checkout paid but unfulfilled transaction_id={attempt['transaction_id']}" in caplog.text
    assert service.thread_view(USER, THREAD, flight_values())["totals"]["paid_vnd"] == 1_500_000


@pytest.mark.asyncio
async def test_expired_unpaid_after_grace_allows_new_attempt(env):
    service, clock, flight, payment, _ = env
    _, attempt = await pay_flight(service)
    clock.now += timedelta(minutes=19)
    payment.status = "EXPIRED"
    result = await service.check(USER, attempt["attempt_id"])
    assert result["outcome"] == "not_paid"
    assert ("cancel_booking", {"booking_ref": "bk_1", "confirm": True}) in flight.calls
    _, second = await pay_flight(service, key="request-key-0004")
    assert second["attempt_id"] != attempt["attempt_id"] and second["outcome"] == "awaiting_payment"


@pytest.mark.asyncio
async def test_create_timeout_reconciles_with_same_order_ref(env):
    service, _, _, payment, _ = env
    payment.create_error = ToolCallError("timeout", "payment timed out", retryable=True, transport=False)
    _, attempt = await pay_flight(service)
    assert attempt["outcome"] == "needs_reconciliation"
    checked = await service.check(USER, attempt["attempt_id"])
    assert checked["outcome"] == "awaiting_payment"
    refs = [args["order_ref"] for tool, args in payment.calls if tool == "create_payment"]
    assert len(refs) == 2 and refs[0] == refs[1] == attempt["attempt_id"]


@pytest.mark.asyncio
async def test_pending_job_resumes_after_restart(env):
    service, *_ = env
    _, attempt = await pay_flight(service)
    await service.tester_paid(USER, attempt["attempt_id"])
    # Process mới: cùng DB, chạy lại công việc dở.
    restarted = CheckoutService(
        store=service.store, pii=service.pii, secret=service.secret, flight=service.flight, payment=service.payment
    )
    await restarted.run_jobs()
    assert restarted.store.get_tx(attempt["transaction_id"]).status == "ticketed"


@pytest.mark.asyncio
async def test_other_user_cannot_read_or_check(env):
    service, *_ = env
    _, attempt = await pay_flight(service)
    with pytest.raises(CheckoutError) as exc:
        await service.check(OTHER, attempt["attempt_id"])
    assert exc.value.status == 404


@pytest.mark.asyncio
async def test_moving_requotes_and_records_approval_without_order(env):
    service, _, _, payment, moving = env
    summary = service.summary(USER, THREAD, moving_values(), "relocation")
    attempt = await service.pay(USER, summary["transaction_id"], summary["payload_hash"], "request-key-0005")
    assert attempt["outcome"] == "awaiting_payment" and moving.calls[0][0] == "estimate_move"
    await service.tester_paid(USER, attempt["attempt_id"])
    await service.run_jobs()
    tx = service.store.get_tx(summary["transaction_id"])
    assert tx.status == "approved" and tx.domain == "relocation"


@pytest.mark.asyncio
async def test_moving_price_change_stops_before_payment(env):
    service, _, _, payment, moving = env
    moving.total = 350_000
    summary = service.summary(USER, THREAD, moving_values(), "relocation")
    with pytest.raises(CheckoutError) as exc:
        await service.pay(USER, summary["transaction_id"], summary["payload_hash"], "request-key-0006")
    assert exc.value.code == "price_changed" and not payment.calls


def test_housing_agreement_is_not_payment(env):
    service, *_ = env
    values = house_values()
    slot = service.viewing_slots()[0]
    service.housing_viewing(USER, THREAD, values, slot)
    agreed = service.housing_agreement(USER, THREAD, values, True, 6_000_000, 4_000_000, "2026-11-01")
    assert agreed["status"] == "agreed" and agreed["details"]["agreement"]["deposit_vnd"] == 6_000_000
    totals = service.thread_view(USER, THREAD, values)["totals"]
    assert totals["due_landlord_vnd"] == 10_000_000 and totals["reported_landlord_vnd"] == 0
    service.housing_paid(USER, THREAD, values, 10_000_000, "2026-10-09")
    totals = service.thread_view(USER, THREAD, values)["totals"]
    assert totals["due_landlord_vnd"] == 0 and totals["reported_landlord_vnd"] == 10_000_000


def test_viewing_rejects_past_or_unknown_slot(env):
    service, *_ = env
    with pytest.raises(CheckoutError):
        service.housing_viewing(USER, THREAD, house_values(), "2026-10-08T07:00:00+07:00")


@pytest.mark.asyncio
async def test_reminder_when_home_not_agreed(env):
    service, *_ = env
    values = {**flight_values(), **{}}
    values["intake"].user_confirmed_facts["selected:property"] = fact("h1")
    summary = service.summary(USER, THREAD, values, "flight")
    assert any("chưa báo đã thỏa thuận nhà" in r for r in summary["reminders"])


@pytest.mark.asyncio
async def test_passenger_age_is_checked_before_hold(env):
    service, _, flight, payment, _ = env
    summary = service.summary(USER, THREAD, flight_values(), "flight")
    young = {**PEOPLE, "passengers": [{**PEOPLE["passengers"][0], "date_of_birth": "2026-01-01"}]}
    with pytest.raises(CheckoutError) as exc:
        await service.pay(USER, summary["transaction_id"], summary["payload_hash"], "request-key-0009", young)
    assert exc.value.code == "passenger_age" and "Van An" not in exc.value.message.title()
    assert not [c for c in flight.calls if c[0] == "hold_booking"] and not payment.calls


@pytest.mark.asyncio
async def test_tester_control_hidden_without_allowlist(env):
    service, *_ = env
    _, attempt = await pay_flight(service)
    service.settings.tester_user_ids = frozenset()
    assert service.thread_view(USER, THREAD, flight_values())["tester"] is False
    with pytest.raises(CheckoutError) as exc:
        await service.tester_paid(USER, attempt["attempt_id"])
    assert exc.value.status == 403


@pytest.mark.asyncio
async def test_worker_reconciles_paid_attempt_without_manual_check(env):
    """Trả qua ZaloPay mà không bấm Kiểm tra: worker tự đối soát rồi xuất vé (review PR #88)."""
    service, clock, flight, payment, _ = env
    _, attempt = await pay_flight(service)
    payment.calls.clear()
    await service.reconcile_open()
    assert [c[0] for c in payment.calls] == ["get_payment"]  # còn PENDING
    # Chưa tới lần kiểm tra kế (giãn dần): không tra lại cổng.
    await service.reconcile_open()
    assert [c[0] for c in payment.calls] == ["get_payment"]
    payment.status = "PAID"
    clock.now += service.settings.reconcile_min * 2
    await service.reconcile_open()
    stored = service.store.get_attempt(attempt["attempt_id"])
    assert stored.outcome == "paid_verified"
    await service.run_jobs()
    assert service.store.get_tx(attempt["transaction_id"]).status == "ticketed"
    # Đã có kết quả cuối: không tra cổng nữa.
    payment.calls.clear()
    clock.now += service.settings.reconcile_max
    await service.reconcile_open()
    assert payment.calls == []


@pytest.mark.asyncio
async def test_restarted_worker_reconciles_open_attempts_immediately(env):
    service, _, flight, payment, _ = env
    _, attempt = await pay_flight(service)
    payment.status = "PAID"
    restarted = CheckoutService(
        store=service.store,
        pii=service.pii,
        secret=service.secret,
        flight=flight,
        payment=payment,
        clock=service.clock,
    )
    await restarted.reconcile_open()
    await restarted.run_jobs()
    assert restarted.store.get_tx(attempt["transaction_id"]).status == "ticketed"


async def _run_worker_loop(service, clock, until, interval=5.0, on_tick=None):
    """Drive the real worker schedule (`seconds_until_next`) with the production 5-second interval."""
    while clock.now < until:
        if on_tick:
            on_tick(clock.now)
        await service.reconcile_open()
        await service.run_jobs()
        clock.now += timedelta(seconds=service.seconds_until_next(interval))


@pytest.mark.asyncio
@pytest.mark.parametrize("phase", [0, 1, 2, 3, 4])
@pytest.mark.parametrize("paid_second", [615, 896])
async def test_worker_fulfils_payment_made_late_in_the_hold(env, paid_second, phase):
    """Review PR #88: with the real 5-second worker, a payment made while the hold is valid is ticketed
    before the hold expires, whatever the worker's phase."""
    service, clock, flight, payment, _ = env
    start = clock.now
    _, attempt = await pay_flight(service)
    deadline = service.store.get_attempt(attempt["attempt_id"]).expires_at
    paid_at = start + timedelta(seconds=paid_second)
    assert paid_at < deadline - service.settings.reconcile_final_margin
    clock.now = start + timedelta(seconds=phase)

    def pay(now):
        if now >= paid_at:
            payment.status = "PAID"

    await _run_worker_loop(service, clock, deadline, on_tick=pay)
    assert service.store.get_tx(attempt["transaction_id"]).status == "ticketed"
    assert [c[0] for c in flight.calls].count("confirm_booking") == 1


@pytest.mark.asyncio
async def test_payment_after_the_last_check_is_recorded_during_the_grace(env):
    """A payment in the final seconds is still recorded as paid right after expiry, not left pending."""
    service, clock, _, payment, _ = env
    start = clock.now
    _, attempt = await pay_flight(service)
    deadline = service.store.get_attempt(attempt["attempt_id"]).expires_at

    def pay(now):
        if now >= deadline - timedelta(seconds=1):
            payment.status = "PAID"

    await _run_worker_loop(service, clock, deadline + timedelta(seconds=15), on_tick=pay)
    assert service.store.get_attempt(attempt["attempt_id"]).outcome == "paid_verified"
    assert clock.now - start < service.settings.reconcile_grace + (deadline - start)


@pytest.mark.asyncio
async def test_payable_attempts_are_checked_at_a_steady_bounded_cadence(env):
    service, clock, _, payment, _ = env
    start = clock.now
    _, attempt = await pay_flight(service)
    deadline = service.store.get_attempt(attempt["attempt_id"]).expires_at
    payment.calls.clear()
    times = []
    original = payment.call

    async def timed(tool, args):
        if tool == "get_payment":
            times.append(clock.now)
        return await original(tool, args)

    payment.call = timed
    await _run_worker_loop(service, clock, deadline)
    gaps = [(b - a).total_seconds() for a, b in zip([start, *times], times, strict=False)]
    assert max(gaps) <= service.settings.reconcile_active.total_seconds() + 5
    assert deadline - times[-1] <= service.settings.reconcile_final_margin


@pytest.mark.asyncio
async def test_rejected_payment_order_ends_the_attempt_and_releases_the_hold(env):
    service, _, flight, payment, _ = env
    payment.create_error = ToolCallError("INVALID_REQUEST", "order rejected")
    with pytest.raises(CheckoutError) as rejected:
        await pay_flight(service)
    assert rejected.value.code == "payment_rejected"
    assert [tool for tool, _ in payment.calls].count("create_payment") == 1
    assert ("cancel_booking", {"booking_ref": "bk_1", "confirm": True}) in flight.calls


@pytest.mark.asyncio
async def test_rejection_during_reconciliation_cancels_once_and_stops(env):
    service, _, flight, payment, _ = env
    payment.create_error = ToolCallError("timeout", "payment timed out", retryable=True)
    _, attempt = await pay_flight(service)
    assert attempt["outcome"] == "needs_reconciliation"
    payment.create_error = ToolCallError("INVALID_REQUEST", "order rejected")
    checked = await service.check(USER, attempt["attempt_id"])
    assert checked["outcome"] == "cancelled"
    assert flight.calls.count(("cancel_booking", {"booking_ref": "bk_1", "confirm": True})) == 1
    await service.check(USER, attempt["attempt_id"])  # A cancelled attempt is not retried.
    assert [tool for tool, _ in payment.calls].count("create_payment") == 2


@pytest.mark.asyncio
async def test_paid_booking_is_ticketed_while_reconciliation_waits_on_another_payment(env, monkeypatch):
    """Review #245: a slow status read for one payment must not hold back ticketing another whose hold may be ending."""
    service, _, flight, payment, _ = env
    _, paid = await pay_flight(service)
    other = service.summary(USER, "th_2", flight_values(option="off_2"), "flight")
    waiting = await service.pay(USER, other["transaction_id"], other["payload_hash"], "request-key-0002", PEOPLE)
    waiting_ref = service.store.get_attempt(waiting["attempt_id"]).payment_id
    reading, release, confirmed = asyncio.Event(), asyncio.Event(), asyncio.Event()
    payment_call, flight_call = payment.call, flight.call

    async def gateway(tool, args):
        if tool == "get_payment" and args["payment_ref"] == waiting_ref:
            reading.set()
            await release.wait()
            return {"status": "PENDING"}
        return {"status": "PAID"} if tool == "get_payment" else await payment_call(tool, args)

    async def provider(tool, args):
        result = await flight_call(tool, args)
        if tool == "confirm_booking":
            confirmed.set()
        return result

    monkeypatch.setattr(payment, "call", gateway)
    monkeypatch.setattr(flight, "call", provider)
    await service.start()  # Reconciles the paid attempt first (creation order), then blocks on the other one.
    await asyncio.wait_for(reading.wait(), 1)
    await asyncio.wait_for(confirmed.wait(), 1)
    assert service.store.get_tx(paid["transaction_id"]).status == "ticketed"
    release.set()
    await service.stop()


@pytest.mark.asyncio
async def test_stop_lets_the_in_flight_confirmation_finish(env, monkeypatch):
    service, _, flight, _, _ = env
    confirming, release = asyncio.Event(), asyncio.Event()
    call = flight.call

    async def slow_call(tool, args):
        if tool == "confirm_booking":
            confirming.set()
            await release.wait()
        return await call(tool, args)

    monkeypatch.setattr(flight, "call", slow_call)
    _, attempt = await pay_flight(service)
    await service.tester_paid(USER, attempt["attempt_id"])
    await service.start()
    await asyncio.wait_for(confirming.wait(), 1)
    stopping = asyncio.create_task(service.stop())
    await asyncio.sleep(0)
    assert not stopping.done()  # Shutdown waits instead of cancelling the paid booking's confirmation.
    release.set()
    await asyncio.wait_for(stopping, 1)
    assert service.store.get_tx(attempt["transaction_id"]).status == "ticketed"
