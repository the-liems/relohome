"""Đặt vé + thanh toán bất đồng bộ, huỷ, hết hạn, compensate (agent-graph.md §6.9, §10.2 dòng 3, 11a)."""

import pytest
from relohome_agent.agents.deps import test_deps
from relohome_agent.agents.intake import ScriptedIntake
from relohome_agent.agents.models import AgentName, CommitActionKind, RequestKind
from relohome_agent.agents.planning import TemplatePlanner
from relohome_agent.services.adapters.fakes import FakeTransaction

from tests.test_agents.helpers import Session, commit_fact, intake_result

MSG = "Đặt vé Hà Nội – Sài Gòn sáng 15/11 cho 1 người"
PII = {"flight_booking:t1": {"passengers": [{"first_name": "A"}], "contact": {"email": "x@y.z", "phone": "0901234567"}}}


def book_flight():
    return intake_result(
        RequestKind.NEW_GOAL,
        [AgentName.FLIGHT],
        values={"origin": "HAN", "destination": "SGN", "flight_date": "2026-11-15"},
        facts=dict([commit_fact(CommitActionKind.FLIGHT_BOOKING, "Đặt vé")]),
    )


def session(script):
    tx = FakeTransaction(payment_script=script)
    return Session(test_deps(ScriptedIntake([book_flight()]), TemplatePlanner(), transaction=tx)), tx


@pytest.mark.asyncio
async def test_pending_then_paid_then_ticketed_once():
    s, tx = session(["PENDING", "PAID"])
    out = await s.confirm(await s.say(MSG), PII)
    assert out["__interrupt__"][0].value["type"] == "payment_required"
    out = await s.resume({"action": "check"})
    assert out["__interrupt__"][0].value["type"] == "payment_required"  # vẫn PENDING: interrupt lại
    out = await s.resume({"action": "check"})
    assert out["response"].kind == "COMMITTED"
    kinds = [c[0] for c in tx.calls]
    assert kinds.count("start_payment") == 1 and kinds.count("complete_after_payment") == 1


@pytest.mark.asyncio
async def test_expired_payment_releases_hold():
    s, tx = session(["EXPIRED"])
    await s.confirm(await s.say(MSG), PII)
    out = await s.resume({"action": "check"})
    assert out["response"].kind == "CANCELLED"
    assert tx.aborted == ["flight_booking:t1"]
    assert out["committed"] == {}


@pytest.mark.asyncio
async def test_user_cancels_payment():
    s, tx = session(["PENDING"])
    await s.confirm(await s.say(MSG), PII)
    out = await s.resume({"action": "cancel"})
    assert out["response"].kind == "CANCELLED"
    assert ("cancel_payment", "pay_1") in tx.calls


@pytest.mark.asyncio
@pytest.mark.parametrize("timeout", [False, True])
async def test_unconfirmed_cancellation_keeps_payment_pending(timeout):
    s, tx = session(["PENDING"])
    await s.confirm(await s.say(MSG), PII)

    async def cancel(_ref):
        if timeout:
            raise TimeoutError("provider unavailable")
        return "PENDING"

    tx.cancel_payment = cancel
    out = await s.resume({"action": "cancel"})
    assert out["__interrupt__"][0].value["type"] == "payment_required"
    assert not tx.aborted


@pytest.mark.asyncio
async def test_missing_pii_form_is_rejected_at_confirm():
    s, tx = session(["PAID"])
    out = await s.confirm(await s.say(MSG), pii=None)
    payload = out["__interrupt__"][0].value
    assert payload["type"] == "confirmation_required"  # hỏi lại, không đi tiếp sang transaction
    assert "thông tin cá nhân" in payload["last_error"]
    assert tx.calls == []


@pytest.mark.asyncio
async def test_stale_plan_version_is_rejected():
    s, tx = session(["PAID"])
    out = await s.say(MSG)
    out = await s.resume({"kind": "CONFIRM", "plan_version": 99, "approval_id": "x"})
    assert out["__interrupt__"][0].value["type"] == "confirmation_required"
    assert tx.calls == []


@pytest.mark.asyncio
async def test_failed_payment_keeps_other_booking_and_asks_user():
    intake = intake_result(
        RequestKind.NEW_GOAL,
        [AgentName.FLIGHT, AgentName.RELOCATION],
        values={
            "origin": "HAN",
            "destination": "SGN",
            "flight_date": "2026-11-15",
            "from_address": "12 Láng Hạ",
            "to_address": "45 Kim Mã",
            "move_date": "2026-11-14",
            "move_time": "09:00",
        },
        facts=dict(
            [commit_fact(CommitActionKind.FLIGHT_BOOKING, "vé"), commit_fact(CommitActionKind.MOVING_BOOKING, "xe")]
        ),
    )
    tx = FakeTransaction(payment_script=["FAILED"])
    s = Session(test_deps(ScriptedIntake([intake]), TemplatePlanner(), transaction=tx))
    out = await s.say("Đặt vé và xe")
    pii = {
        "flight_booking:t1": PII["flight_booking:t1"],
        "moving_booking:t2": {
            "pickup_contact": {"name": "A", "mobile": "0901234567"},
            "destination_contact": {"name": "A", "mobile": "0901234567"},
        },
    }
    out = await s.confirm(out, pii)
    out = await s.resume({"action": "check"})
    # Không tự huỷ đơn chuyển nhà đã đặt: báo phần đã đặt / lỗi rồi hỏi người dùng.
    response = out["response"]
    assert response.kind == "PARTIAL"
    assert tx.compensated == [] and tx.aborted == ["flight_booking:t1"]
    assert out["committed"]["moving_booking:t2"].status == "confirmed"
    assert out["transaction"].failed_action_ids == ["flight_booking:t1"]
    assert response.questions[0].field == "cancel_booked"


@pytest.mark.asyncio
async def test_uncertain_commit_is_not_retried():
    intake = intake_result(
        RequestKind.NEW_GOAL,
        [AgentName.RELOCATION],
        values={
            "from_address": "12 Láng Hạ",
            "to_address": "45 Kim Mã",
            "move_date": "2026-11-14",
            "move_time": "09:00",
        },
        facts=dict([commit_fact(CommitActionKind.MOVING_BOOKING, "xe")]),
    )
    tx = FakeTransaction()
    tx.uncertain_kinds.add(CommitActionKind.MOVING_BOOKING)
    s = Session(test_deps(ScriptedIntake([intake]), TemplatePlanner(), transaction=tx))
    out = await s.say("Đặt xe")
    out = await s.confirm(
        out,
        {
            "moving_booking:t1": {
                "pickup_contact": {"name": "A", "mobile": "1"},
                "destination_contact": {"name": "A", "mobile": "1"},
            }
        },
    )
    assert out["transaction"].status == "pending_verification"
    assert out["response"].kind == "ERROR"
    assert [c[0] for c in tx.calls].count("commit") == 1
