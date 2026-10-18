"""Chọn nhiều căn, hẹn xem và chốt (housing-viewing-design): quy tắc lịch, chốt, mở lại, cấu hình."""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime, timedelta

import pytest
from relohome_agent.checkout.models import CheckoutError, ServiceTransaction
from relohome_agent.checkout.store import CheckoutStore
from relohome_agent.checkout.viewing import ViewingService, ViewingSettings
from relohome_agent.config import Settings
from relohome_agent.services.adapters.mcp import ToolCallError

USER, THREAD = "user-a", "th_1"
# 00:00 giờ Việt Nam ngày 10/10/2026.
START = datetime(2026, 10, 9, 17, 0, tzinfo=UTC)


class Clock:
    def __init__(self):
        self.now = START

    def __call__(self):
        return self.now


class FakeLocation:
    """Thời gian đi giữa hai căn; `None` = không có đường. Chỉ thành phố `route_city` có dữ liệu."""

    def __init__(self, seconds: dict[tuple[str, str], float | None], route_city: str = "hcm"):
        self.seconds, self.route_city, self.calls = seconds, route_city, []

    async def call(self, tool, args):
        assert tool == "calculate_route_between_entities"
        self.calls.append(args)
        if args["city"] != self.route_city:
            raise ToolCallError("TOOL_ERROR", "OUTSIDE_ROUTING_AREA")
        value = self.seconds.get((args["origin"]["listing_id"], args["destination"]["listing_id"]))
        if value is None:
            raise ToolCallError("TOOL_ERROR", "NO_ROUTE")
        return {"route": {"duration_seconds": value}}


def row(listing_id, price=4_000_000, lat=10.77, lng=106.70):
    return {
        "id": listing_id,
        "title": f"Phòng {listing_id}",
        "address": f"Địa chỉ {listing_id}",
        "price_vnd": price,
        "lat": lat,
        "lng": lng,
        "city": "Thành phố Hồ Chí Minh",
    }


def make(seconds=None, **overrides):
    clock = Clock()
    location = FakeLocation(seconds or {})
    settings = ViewingSettings.from_services(Settings(_env_file=None, **overrides))
    service = ViewingService(
        store=CheckoutStore(sqlite3.connect(":memory:", isolation_level=None)),
        settings=settings,
        location=location,
        clock=clock,
    )
    return service, clock, location


def slot(service, hour, minute=0, day=1):
    target = datetime(2026, 10, 10 + day, hour, minute, tzinfo=service.settings.timezone).isoformat()
    assert target in service.slots(), target
    return target


def test_selection_limit_comes_from_settings():
    service, *_ = make(housing_max_selected=2)
    service.select(USER, THREAD, "t1", row("a"))
    service.select(USER, THREAD, "t1", row("a"))  # chọn trùng: không thêm
    service.select(USER, THREAD, "t1", row("b"))
    with pytest.raises(CheckoutError) as exc:
        service.select(USER, THREAD, "t1", row("c"))
    assert exc.value.code == "selection_full" and "2 căn" in exc.value.message
    service.unselect(USER, THREAD, "a")
    service.select(USER, THREAD, "t1", row("c"))
    assert [p["listing_id"] for p in service.projection(USER, THREAD)] == ["b", "c"]


@pytest.mark.asyncio
async def test_selecting_and_scheduling_another_home_preserves_existing_appointment():
    service, *_ = make({("a", "b"): 900})
    service.select(USER, THREAD, "t1", row("a"))
    first_slot = slot(service, 9)
    await service.schedule(USER, THREAD, "a", first_slot)
    service.select(USER, THREAD, "t1", row("b"))
    await service.schedule(USER, THREAD, "b", slot(service, 11))
    items = {item["listing_id"]: item for item in service.thread_view(USER, THREAD, {})["items"]}
    assert items["a"]["viewing"]["slot"] == first_slot
    assert items["b"]["viewing"]["slot"] == slot(service, 11)
    assert items["a"]["status"] == items["b"]["status"] == "viewing_scheduled"


def test_slots_follow_configured_window_lead_and_length():
    service, clock, _ = make(
        housing_viewing_slot_minutes=60,
        housing_viewing_day_start="09:00",
        housing_viewing_day_end="12:00",
        housing_viewing_window_days=2,
        housing_viewing_lead_minutes=180,
    )
    clock.now = datetime(2026, 10, 10, 8, 30, tzinfo=service.settings.timezone)
    hours = [s[:16] for s in service.slots()]
    # day_end is the final allowed start time; a custom lead still applies.
    assert hours == ["2026-10-10T12:00", "2026-10-11T09:00", "2026-10-11T10:00", "2026-10-11T11:00", "2026-10-11T12:00"]


@pytest.mark.parametrize(
    "hour,minute,first,last",
    [(15, 33, "17:00", "22:00"), (20, 59, "22:00", "22:00"), (21, 0, "22:00", "22:00"), (21, 1, None, None)],
)
def test_default_slots_require_one_hour_notice_and_allow_starts_through_2200(hour, minute, first, last):
    service, clock, _ = make()
    clock.now = datetime(2026, 10, 16, hour, minute, tzinfo=service.settings.timezone)
    slots = service.slots()
    today = [s[11:16] for s in slots if s.startswith("2026-10-16")]
    assert (today[0] if today else None) == first
    assert (today[-1] if today else None) == last
    assert all(datetime.fromisoformat(s) >= clock.now + timedelta(hours=1) for s in slots)
    tomorrow = [s[11:16] for s in slots if s.startswith("2026-10-17")]
    assert tomorrow[0] == "08:00" and tomorrow[-1] == "22:00"


@pytest.mark.asyncio
async def test_scheduling_rechecks_notice_period_and_accepts_2200():
    service, clock, _ = make()
    clock.now = datetime(2026, 10, 16, 20, 59, tzinfo=service.settings.timezone)
    service.select(USER, THREAD, "t1", row("a"))
    target = "2026-10-16T22:00:00+07:00"
    await service.schedule(USER, THREAD, "a", target)
    service.select(USER, THREAD, "t1", row("b"))
    clock.now += timedelta(minutes=2)
    with pytest.raises(CheckoutError):
        await service.schedule(USER, THREAD, "b", target)


@pytest.mark.asyncio
async def test_schedule_rejects_overlap_and_unreachable_then_accepts_with_buffer():
    # a→b mất 20 phút; đệm 15; buổi xem 30 → b sớm nhất a + 65 phút.
    service, _, location = make({("a", "b"): 1200, ("b", "a"): 1200})
    for listing in ("a", "b"):
        service.select(USER, THREAD, "t1", row(listing))
    await service.schedule(USER, THREAD, "a", slot(service, 9))
    with pytest.raises(CheckoutError) as exc:
        await service.schedule(USER, THREAD, "b", slot(service, 9, 0))
    assert exc.value.code == "overlap"
    with pytest.raises(CheckoutError) as exc:
        await service.schedule(USER, THREAD, "b", slot(service, 10, 0))
    assert exc.value.code == "not_reachable" and "10:05" in exc.value.message
    item = await service.schedule(USER, THREAD, "b", slot(service, 10, 30))
    assert item["status"] == "viewing_scheduled"
    calls = len(location.calls)
    await service.schedule(USER, THREAD, "b", slot(service, 11))  # đổi lịch: dùng lại đường đã tính
    assert len(location.calls) == calls


@pytest.mark.asyncio
async def test_unknown_route_uses_configured_minimum_gap():
    service, *_ = make({}, housing_viewing_min_gap_minutes=90)
    for listing in ("a", "b"):
        service.select(USER, THREAD, "t1", row(listing))
    await service.schedule(USER, THREAD, "a", slot(service, 9))
    with pytest.raises(CheckoutError) as exc:
        await service.schedule(USER, THREAD, "b", slot(service, 10, 30))
    assert "chưa tính được" in exc.value.message
    await service.schedule(USER, THREAD, "b", slot(service, 11))


@pytest.mark.asyncio
async def test_route_city_is_tried_from_configuration_and_remembered():
    service, _, location = make({("a", "b"): 600}, housing_viewing_route_cities="danang,hcm")
    assert await service.travel_seconds("a", "b") == 600
    assert [c["city"] for c in location.calls] == ["danang", "hcm"]
    location.seconds[("b", "a")] = 600
    await service.travel_seconds("b", "a")
    assert location.calls[-1]["city"] == "hcm" and len(location.calls) == 3


async def visited(service, clock, listing, hour=9):
    await service.schedule(USER, THREAD, listing, slot(service, hour))
    clock.now = datetime(2026, 10, 11, hour, 31, tzinfo=service.settings.timezone)
    return service.visit(USER, THREAD, listing, "met_undecided")


@pytest.mark.asyncio
async def test_visit_requires_the_viewing_to_have_ended():
    service, clock, _ = make()
    service.select(USER, THREAD, "t1", row("a"))
    await service.schedule(USER, THREAD, "a", slot(service, 9))
    with pytest.raises(CheckoutError) as exc:
        service.visit(USER, THREAD, "a", "met_agreed")
    assert exc.value.code == "visit_not_due"
    clock.now = datetime(2026, 10, 11, 9, 31, tzinfo=service.settings.timezone)
    assert service.item_view(service._item(USER, THREAD, "a"))["status"] == "visit_due"
    assert service.visit(USER, THREAD, "a", "missed")["status"] == "selected"


@pytest.mark.asyncio
async def test_decide_only_after_visit_and_cancels_others_unless_kept():
    service, clock, _ = make({})
    for listing in ("a", "b", "c"):
        service.select(USER, THREAD, "t1", row(listing))
    form = {"rent_vnd": 4_000_000, "deposit_vnd": 4_000_000, "move_in": "2026-11-01"}
    with pytest.raises(CheckoutError) as exc:
        service.begin_decision(USER, THREAD, "b", [], form, "k" * 16)
    assert exc.value.code == "not_visited"
    await visited(service, clock, "b", 9)
    clock.now = START
    await service.schedule(USER, THREAD, "c", slot(service, 14))
    clock.now = datetime(2026, 10, 11, 9, 31, tzinfo=service.settings.timezone)
    with pytest.raises(CheckoutError):
        service.begin_decision(USER, THREAD, "b", ["zzz"], form, "k" * 16)
    decision = service.begin_decision(USER, THREAD, "b", ["c"], form, "k" * 16)
    assert decision["keep"] == ["c"] and decision["drop"] == ["a"]
    assert service.begin_decision(USER, THREAD, "b", ["c"], form, "k" * 16)["step"] == "planned"  # gọi lại
    service.finish_decision(decision)
    statuses = {i["listing_id"]: i["status"] for i in service.thread_view(USER, THREAD, {})["items"]}
    assert statuses == {"b": "agreed", "c": "backup"}
    assert service._item(USER, THREAD, "c").details["viewing"]  # căn dự phòng giữ lịch
    with pytest.raises(CheckoutError):
        service.select(USER, THREAD, "t1", row("d"))  # đã chốt: không chọn thêm


@pytest.mark.asyncio
async def test_reopen_restores_backups_and_refuses_after_reported_payment():
    service, clock, _ = make()
    for listing in ("a", "b"):
        service.select(USER, THREAD, "t1", row(listing))
    await visited(service, clock, "a")
    decision = service.begin_decision(
        USER, THREAD, "a", ["b"], {"rent_vnd": 1, "deposit_vnd": 1, "move_in": None}, "r" * 16
    )
    service.finish_decision(decision)
    assert service.reopen(USER, THREAD) == "a"
    statuses = {i["listing_id"]: i["status"] for i in service.thread_view(USER, THREAD, {})["items"]}
    assert statuses == {"a": "visited", "b": "selected"}
    decision = service.begin_decision(
        USER, THREAD, "a", [], {"rent_vnd": 1, "deposit_vnd": 1, "move_in": None}, "s" * 16
    )
    service.finish_decision(decision)
    service.report_paid(USER, THREAD, 2, "2026-10-12")
    with pytest.raises(CheckoutError) as exc:
        service.reopen(USER, THREAD)
    assert exc.value.code == "already_paid"


def test_moving_impact_uses_configured_distance_and_payment_state():
    service, *_ = make(housing_same_place_meters=100)

    class Result:
        def __init__(self, lat):
            from relohome_agent.agents.models import AgentName

            self.agent, self.status = AgentName.RELOCATION, "done"
            self.data = {"route": {"destination": {"lat": lat, "lng": 106.70}}}

    home = {"lat": 10.7700, "lng": 106.70}
    assert service.moving_impact(USER, THREAD, home, {"task_results": {}}) == "none"
    assert service.moving_impact(USER, THREAD, home, {"task_results": {"m": Result(10.7705)}}) == "same"
    far = {"task_results": {"m": Result(10.80)}}
    assert service.moving_impact(USER, THREAD, home, far) == "different_unpaid"
    now = datetime.now(UTC)
    service.store.put_tx(
        ServiceTransaction(
            transaction_id="tx_moving",
            user_id=USER,
            thread_id=THREAD,
            logical_key="moving:x",
            domain="relocation",
            option_id="q",
            status="approved",
            created_at=now,
            updated_at=now,
        )
    )
    assert service.moving_impact(USER, THREAD, home, far) == "different_paid"


def test_delete_thread_keeps_paid_transactions():
    service, *_ = make()
    service.select(USER, THREAD, "t1", row("a"))
    now = datetime.now(UTC)
    service.store.put_tx(
        ServiceTransaction(
            transaction_id="tx_moving",
            user_id=USER,
            thread_id=THREAD,
            logical_key="moving:x",
            domain="relocation",
            option_id="q",
            status="approved",
            created_at=now,
            updated_at=now,
        )
    )
    service.delete_thread(USER, THREAD)
    assert [t.domain for t in service.store.list_tx(USER, THREAD)] == ["relocation"]


@pytest.mark.asyncio
async def test_warnings_use_configured_daily_limit():
    service, *_ = make({}, housing_viewing_daily_soft_limit=1, housing_viewing_min_gap_minutes=0)
    for listing in ("a", "b"):
        service.select(USER, THREAD, "t1", row(listing))
    await service.schedule(USER, THREAD, "a", slot(service, 9))
    await service.schedule(USER, THREAD, "b", slot(service, 10))
    codes = [w["code"] for w in service.thread_view(USER, THREAD, {})["warnings"]]
    assert "busy_day" in codes


def test_legacy_selected_home_is_shown_as_chosen():
    from relohome_agent.agents.models import ConfirmedFact, IntakeResult, RequestKind

    service, *_ = make()
    intake = IntakeResult(
        kind=RequestKind.NEW_GOAL,
        user_confirmed_facts={"selected:property": ConfirmedFact(value="old", evidence="x", stated_at=START)},
    )
    view = service.thread_view(USER, THREAD, {"intake": intake})
    assert view["legacy_chosen"] == {"listing_id": "old", "status": "legacy_chosen"}
    assert view["slots"] and view["max_selected"] == 3 and timedelta(minutes=view["slot_minutes"])


@pytest.mark.asyncio
async def test_test_mode_can_record_the_visit_before_the_slot(monkeypatch):
    service, *_ = make(housing_viewing_test_visit_anytime=True)
    service.select(USER, THREAD, "t1", row("a"))
    await service.schedule(USER, THREAD, "a", slot(service, 9))
    assert service.item_view(service._item(USER, THREAD, "a"))["status"] == "visit_due"
    assert service.visit(USER, THREAD, "a", "met_agreed")["status"] == "visited"


def test_test_mode_still_requires_a_booked_viewing():
    service, *_ = make(housing_viewing_test_visit_anytime=True)
    service.select(USER, THREAD, "t1", row("a"))
    with pytest.raises(CheckoutError) as error:
        service.visit(USER, THREAD, "a", "met_agreed")
    assert error.value.code == "visit_state_conflict"
    assert service.item_view(service._item(USER, THREAD, "a"))["status"] == "selected"


def test_test_visit_anytime_is_ignored_in_production(monkeypatch):
    from relohome_agent.config import get_settings

    monkeypatch.setenv("APP_ENV", "production")
    get_settings.cache_clear()
    try:
        service, *_ = make(housing_viewing_test_visit_anytime=True)
        assert service.settings.visit_anytime is False
    finally:
        monkeypatch.delenv("APP_ENV")
        get_settings.cache_clear()


@pytest.mark.asyncio
async def test_payment_report_key_retries_are_idempotent_and_revisions_preserve_history():
    service, clock, _ = make()
    service.select(USER, THREAD, "t1", row("a"))
    await visited(service, clock, "a")
    decision = service.begin_decision(
        USER, THREAD, "a", [], {"rent_vnd": 1, "deposit_vnd": 1, "move_in": None}, "d" * 16
    )
    service.finish_decision(decision)
    first = service.report_paid(USER, THREAD, 2, "2026-10-12", "report-one")
    assert service.report_paid(USER, THREAD, 2, "2026-10-12", "report-one") == first
    with pytest.raises(CheckoutError):
        service.report_paid(USER, THREAD, 3, "2026-10-12", "report-one")
    second = service.report_paid(USER, THREAD, 3, "2026-10-12", "report-two")
    assert second["reported_payment"]["report_key"] == "report-two"
    assert service._item(USER, THREAD, "a").details["reported_payment_history"] == [first["reported_payment"]]

@pytest.mark.asyncio
async def test_reopen_rejected_payment_requires_the_exact_report_and_preserves_history():
    service, clock, _ = make()
    service.select(USER, THREAD, "t1", row("a"))
    await visited(service, clock, "a")
    decision = service.begin_decision(
        USER, THREAD, "a", [], {"rent_vnd": 1, "deposit_vnd": 1, "move_in": None}, "r" * 16
    )
    service.finish_decision(decision)
    first = service.report_paid(USER, THREAD, 2, "2026-10-12", "rejected-report")
    with pytest.raises(CheckoutError):
        service.reopen(USER, THREAD, rejected_report_key="different-report")
    # A later report cannot be reopened with evidence about the earlier rejected report.
    latest = service.report_paid(USER, THREAD, 3, "2026-10-13", "latest-report")
    with pytest.raises(CheckoutError):
        service.reopen(USER, THREAD, rejected_report_key="rejected-report")
    assert service.reopen(USER, THREAD, rejected_report_key="latest-report") == "a"
    item = service._item(USER, THREAD, "a")
    assert item.status == "visited"
    assert "reported_payment" not in item.details
    assert item.details["reported_payment_history"] == [first["reported_payment"], latest["reported_payment"]]
