"""validate_plan và TemplatePlanner: phạm vi yêu cầu S1–S10 (agent-graph.md §6.2, §10.2)."""

import pytest
from relohome_agent.agents.common import utcnow
from relohome_agent.agents.deps import fake_registry, test_deps
from relohome_agent.agents.intake import ScriptedIntake
from relohome_agent.agents.models import (
    AgentName,
    CommitAction,
    CommitActionKind,
    Plan,
    Receipt,
    RequestKind,
    SessionContext,
    Task,
)
from relohome_agent.agents.planning import PlannerInput, TemplatePlanner, validate_plan

from tests.test_agents.helpers import Session, commit_fact, fact, intake_result

REG = fake_registry()
FLIGHT = Task(id="t1", agent=AgentName.FLIGHT, inputs={"origin": "HAN", "destination": "SGN", "date": "2026-11-15"})


def test_rejects_cycles_unknown_deps_and_bad_inputs():
    intake = intake_result(domains=[AgentName.PROPERTY])
    cyclic = Plan(
        version=0,
        tasks=[
            Task(id="a", agent=AgentName.PROPERTY, inputs={"city": "HCM"}, depends_on=["b"]),
            Task(id="b", agent=AgentName.PROPERTY, inputs={"city": "HCM"}, depends_on=["a"]),
        ],
    )
    assert any("chu trình" in e for e in validate_plan(cyclic, REG, intake, {}))
    bad = Plan(version=0, tasks=[Task(id="a", agent=AgentName.PROPERTY, inputs={"x": 1}, depends_on=["zz"])])
    errors = validate_plan(bad, REG, intake, {})
    assert any("depends_on" in e for e in errors) and any("schema" in e for e in errors)


def test_commit_requires_user_request_s2():
    intake = intake_result(domains=[AgentName.FLIGHT])
    plan = Plan(
        version=0,
        tasks=[FLIGHT],
        commit_actions=[
            CommitAction(id="flight_booking:t1", kind=CommitActionKind.FLIGHT_BOOKING, source_task_id="t1")
        ],
    )
    assert any("S2" in e for e in validate_plan(plan, REG, intake, {}))
    asked = intake.model_copy(update={"commit_requested": [CommitActionKind.FLIGHT_BOOKING]})
    assert validate_plan(plan, REG, asked, {}) == []


def test_no_rebooking_s8_and_no_deposit_q25():
    intake = intake_result(domains=[AgentName.FLIGHT]).model_copy(
        update={"commit_requested": [CommitActionKind.FLIGHT_BOOKING, CommitActionKind.DEPOSIT]}
    )
    receipt = Receipt(
        receipt_id="bk",
        action_id="flight_booking:t1",
        kind=CommitActionKind.FLIGHT_BOOKING,
        provider="x",
        amount_vnd=1,
        source_kind="demo",
        status="TICKETED",
        created_at=utcnow(),
    )
    plan = Plan(
        version=0,
        tasks=[FLIGHT],
        commit_actions=[
            CommitAction(id="flight_booking:t1", kind=CommitActionKind.FLIGHT_BOOKING, source_task_id="t1"),
            CommitAction(id="deposit:t1", kind=CommitActionKind.DEPOSIT, source_task_id="t1"),
        ],
    )
    errors = validate_plan(plan, REG, intake, {"flight_booking:t1": receipt})
    assert any("S8" in e for e in errors) and any("Q25" in e for e in errors)


def test_paid_task_only_for_requested_domain_s1():
    intake = intake_result(domains=[AgentName.PROPERTY])
    plan = Plan(
        version=0,
        tasks=[Task(id="t1", agent=AgentName.PROPERTY, inputs={"city": "HCM"}), FLIGHT.model_copy(update={"id": "t2"})],
    )
    assert any("S1" in e for e in validate_plan(plan, REG, intake, {}))


async def planned(intake, previous=None, committed=None):
    out = await TemplatePlanner().plan(
        PlannerInput(intake=intake, session=SessionContext(), previous_plan=previous, committed=committed or {})
    )
    return out.plan


@pytest.mark.asyncio
async def test_single_purpose_moving_booking():
    intake = intake_result(
        domains=[AgentName.RELOCATION],
        values={
            "from_address": "12 Láng Hạ",
            "to_address": "45 Kim Mã",
            "move_date": "2026-10-05",
            "move_time": "09:00",
        },
        facts=dict([commit_fact(CommitActionKind.MOVING_BOOKING, "Đặt xe")]),
    ).model_copy(update={"commit_requested": [CommitActionKind.MOVING_BOOKING]})
    plan = await planned(intake)
    assert [(t.id, t.agent) for t in plan.tasks] == [("t1", AgentName.RELOCATION)]
    assert plan.tasks[0].inputs["mode"] == "quote"
    assert [(a.id, a.requires_payment) for a in plan.commit_actions] == [("moving_booking:t1", False)]
    assert validate_plan(plan, REG, intake, {}) == []


@pytest.mark.asyncio
async def test_refine_adds_domain_and_keeps_task_ids_s5():
    first = intake_result(domains=[AgentName.PROPERTY], values={"near": "Thủ Đức", "max_price_vnd": 4_000_000})
    plan_v1 = (await planned(first)).model_copy(update={"version": 1})
    second = intake_result(
        RequestKind.REFINE,
        [AgentName.FLIGHT],
        values={"near": "Thủ Đức", "max_price_vnd": 4_000_000, "origin": "HAN", "flight_date": "2026-11-15"},
    )
    plan_v2 = await planned(second, previous=plan_v1)
    assert [(t.id, t.agent) for t in plan_v2.tasks] == [("t1", AgentName.PROPERTY), ("t2", AgentName.FLIGHT)]
    assert plan_v2.tasks[0] == plan_v1.tasks[0]
    assert plan_v2.tasks[1].depends_on == ["t1"]  # điểm đến suy ra từ phòng


@pytest.mark.asyncio
async def test_prefilled_filters_go_to_soft_filters():
    from relohome_agent.agents.models import PrefilledValue

    intake = intake_result(domains=[AgentName.PROPERTY], values={"near": "Quận 10", "max_price_vnd": 5_000_000})
    intake = intake.model_copy(
        update={
            "prefilled": {
                "near": PrefilledValue(value="Quận 10", source="preference", last_confirmed_at=utcnow()),
                "max_price_vnd": PrefilledValue(value=5_000_000, source="preference", last_confirmed_at=utcnow()),
            }
        }
    )
    task = (await planned(intake)).tasks[0]
    assert task.inputs == {"near": "Quận 10", "soft_filters": {"max_price_vnd": 5_000_000}}


@pytest.mark.asyncio
async def test_order_lookup_and_cancel_s10():
    intake = intake_result(
        domains=[AgentName.RELOCATION],
        values={"order_id": "ORD1"},
        facts=dict([commit_fact(CommitActionKind.CANCEL_ORDER, "Huỷ đơn")]),
    ).model_copy(update={"commit_requested": [CommitActionKind.CANCEL_ORDER]})
    plan = await planned(intake)
    assert plan.tasks[0].inputs == {"mode": "order_status", "order_id": "ORD1"}
    assert plan.commit_actions[0].target_receipt_id == "ORD1"
    assert validate_plan(plan, REG, intake, {}) == []


@pytest.mark.asyncio
async def test_relocation_waits_for_room_choice_s4():
    values = {"city": "HCM", "from_address": "12 Láng Hạ", "move_date": "2026-11-14", "move_time": "09:00"}
    before_choice = intake_result(domains=[AgentName.PROPERTY, AgentName.RELOCATION], values=values)
    intake = intake_result(
        RequestKind.REFINE,
        domains=[AgentName.PROPERTY, AgentName.RELOCATION],
        values=values,
        facts={"selected:property": fact("lst_002", "Phòng số 2")},
    )
    deps = test_deps(ScriptedIntake([before_choice, intake]), TemplatePlanner())
    session = Session(deps)
    first = await session.say("Tìm phòng và báo giá chuyển đồ tới phòng tôi chọn")
    assert first["response"].kind == "CLARIFY"
    assert [t.agent for t in first["plan"].tasks] == [AgentName.PROPERTY]
    assert "relocation.selected:property" in first["intake"].constraints.missing
    assert deps.agents.get(AgentName.RELOCATION).requests == []

    second = await session.say("Chọn phòng số 2")
    relocation = next(t for t in second["plan"].tasks if t.agent == AgentName.RELOCATION)
    # S4 waits for the user's choice, not another search: Moving re-fetches the confirmed ID itself.
    assert relocation.inputs["selected_listing_id"] == "lst_002" and relocation.depends_on == []
    requests = deps.agents.get(AgentName.RELOCATION).requests
    assert len(requests) == 1 and requests[0].inputs["selected_listing_id"] == "lst_002"
    assert requests[0].upstream == {}
    assert len(deps.agents.get(AgentName.PROPERTY).requests) == 1
