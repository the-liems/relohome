"""Chính sách bộ nhớ (agent-graph.md §6.0, §6.1)."""

from datetime import timedelta

from relohome_agent.agents.common import utcnow
from relohome_agent.agents.deps import GraphSettings
from relohome_agent.agents.memory import apply_updates, memory_updates, prefill_from_memory
from relohome_agent.agents.models import (
    AgentName,
    CommitActionKind,
    MemoryValue,
    Plan,
    PrefilledValue,
    Receipt,
    SessionContext,
    Task,
    TaskStatus,
    TransactionResult,
)

from tests.test_agents.helpers import fact, intake_result


def mem(value, stop=False):
    at = utcnow() - timedelta(days=3)
    return MemoryValue(value=value, stated_at=at, last_confirmed_at=at, stop_prefill=stop)


def state_with(task_inputs: dict, facts: dict, session=None, prefilled=None, status=TaskStatus.DONE, **extra):
    intake = intake_result(domains=[AgentName.PROPERTY], facts=facts)
    if prefilled:
        intake = intake.model_copy(update={"prefilled": prefilled})
    plan = Plan(version=1, tasks=[Task(id="t1", agent=AgentName.PROPERTY, inputs=task_inputs)])
    return {
        "intake": intake,
        "plan": plan,
        "task_status": {"t1": status},
        "session": session or SessionContext(),
        **extra,
    }


def test_only_used_user_facts_are_saved():
    state = state_with({"near": "Quận 10"}, {"near": fact("Quận 10", "Quận 10"), "max_price_vnd": fact(5, "5 triệu")})
    updates = memory_updates(state)
    assert [(u.key, u.value) for u in updates] == [("near", "Quận 10")]


def test_nothing_saved_when_task_not_done():
    state = state_with({"near": "Quận 10"}, {"near": fact("Quận 10", "Quận 10")}, status=TaskStatus.FAILED)
    assert memory_updates(state) == []


def test_tier3_and_unknown_keys_not_saved():
    state = state_with({"move_date": "2026-11-14"}, {"move_date": fact("2026-11-14", "14/11")})
    assert memory_updates(state) == []


def test_reused_prefill_only_touches():
    now = utcnow()
    session = SessionContext(preferences={"near": mem("Quận 10")})
    state = state_with(
        {"near": "Quận 10"},
        {},
        session=session,
        prefilled={
            "near": PrefilledValue(
                value="Quận 10", source="preference", last_confirmed_at=session.preferences["near"].last_confirmed_at
            )
        },
    )
    updates = memory_updates(state)
    assert len(updates) == 1 and updates[0].touch_only
    after = apply_updates(session, updates, "th", now)
    assert after.preferences["near"].last_confirmed_at == now


def test_anchor_change_stops_dependent_prefill():
    session = SessionContext(preferences={"near": mem("Quận 10"), "max_price_vnd": mem(5_000_000)})
    state = state_with({"near": "Thủ Đức"}, {"near": fact("Thủ Đức", "Thủ Đức")}, session=session)
    after = apply_updates(session, memory_updates(state), "th", utcnow())
    assert after.preferences["near"].value == "Thủ Đức"
    assert after.preferences["max_price_vnd"].stop_prefill is True


def test_moving_booked_stops_area_prefill_and_saves_hint():
    session = SessionContext(preferences={"near": mem("Quận 10"), "district": mem("Quận 10")})
    receipt = Receipt(
        receipt_id="o1",
        action_id="moving_booking:t2",
        kind=CommitActionKind.MOVING_BOOKING,
        provider="ahamove",
        amount_vnd=1,
        source_kind="sandbox",
        status="ASSIGNING",
        details={"to_address": "45 Thành Thái"},
        created_at=utcnow(),
    )
    state = state_with({}, {}, session=session, transaction=TransactionResult(status="committed", receipts=[receipt]))
    after = apply_updates(session, memory_updates(state), "th", utcnow())
    assert after.preferences["near"].stop_prefill is True
    assert after.preferences["district"].stop_prefill is True
    assert after.hints["current_address"].value == "45 Thành Thái"


def test_save_is_idempotent():
    now = utcnow()
    state = state_with({"near": "Quận 10"}, {"near": fact("Quận 10", "Quận 10")})
    once = apply_updates(SessionContext(), memory_updates(state), "th", now)
    twice = apply_updates(once, memory_updates(state), "th", now)
    assert once == twice


def test_named_search_does_not_silently_reapply_old_scope_or_amenities():
    session = SessionContext(
        preferences={
            "city": mem("Hà Nội"),
            "district": mem("Hoàng Mai"),
            "near": mem("Bách Khoa"),
            "must_have": mem(["air_conditioning"]),
            "room_type": mem("studio"),
            "max_price_vnd": mem(5_000_000),
        }
    )
    args = (session, [AgentName.PROPERTY], {AgentName.PROPERTY: "cheap"}, GraphSettings().prefill_ttl, utcnow())
    for stated in ({"city": "Hà Nội", "max_price_vnd": 5_000_000}, {"district": "Hoàng Mai"}, {"near": "Bách Khoa"}):
        result = prefill_from_memory(stated, *args)
        assert not {"district", "near", "must_have", "room_type", "max_price_vnd"} & result.keys()
    # Memory still helps a genuinely unspecified search; it is not deleted.
    assert "must_have" in prefill_from_memory({}, *args)
