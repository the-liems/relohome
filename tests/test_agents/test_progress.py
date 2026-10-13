"""Dải tiến trình: mục tiêu từ plan, quan hệ trước/sau, trạng thái đã xem/đã chốt và tổng tiền đã chốt."""

from datetime import timedelta

import pytest
from relohome_agent.agents.common import utcnow
from relohome_agent.agents.models import (
    AgentName,
    ConfirmedFact,
    Constraints,
    IntakeResult,
    Intent,
    Plan,
    Quote,
    RequestKind,
    Task,
    TaskResult,
    TaskStatus,
)
from relohome_agent.agents.nodes.intake import remembered_home
from relohome_agent.agents.progress import plan_progress, record_goal, record_selections
from relohome_agent.api.routes import _selections


def result(task_id, agent, data, quotes=()):
    return TaskResult(
        task_id=task_id,
        agent=agent,
        plan_version=1,
        status="done",
        fetched_at=utcnow(),
        data=data,
        quotes=list(quotes),
    )


def state(facts, statuses):
    homes = [{"id": "h1", "title": "Căn A"}, {"id": "h2", "title": "Căn B"}]
    return {
        "intake": IntakeResult(
            kind=RequestKind.REFINE,
            intent=Intent(name="x", domains=[AgentName.PROPERTY, AgentName.FLIGHT, AgentName.RELOCATION]),
            constraints=Constraints(),
            user_confirmed_facts={
                k: ConfirmedFact(value=v, evidence="chọn", stated_at=utcnow()) for k, v in facts.items()
            },
        ),
        "plan": Plan(
            version=2,
            tasks=[
                Task(id="home", agent=AgentName.PROPERTY, inputs={"city": "Hà Nội", "max_price_vnd": 5_000_000}),
                Task(id="fly", agent=AgentName.FLIGHT, inputs={"origin": "Hà Nội", "destination": "Đà Nẵng"}),
                Task(
                    id="move",
                    agent=AgentName.RELOCATION,
                    inputs={"mode": "quote", "to_address": "selected:property", "selected_listing_id": "h2"},
                ),
                Task(id="pay", agent=AgentName.PAYMENT, inputs={"payment_id": "p1"}),
            ],
        ),
        "task_status": statuses,
        "task_results": {
            "home": result(
                "home",
                AgentName.PROPERTY,
                {"candidates": homes},
                [Quote(option_id=h["id"], label=h["title"], amount_vnd=4_000_000, recurrence="monthly") for h in homes],
            ),
            "fly": result(
                "fly",
                AgentName.FLIGHT,
                {"offers": [{"id": "f1", "carrier": "VN", "expires_at": (utcnow() + timedelta(hours=1)).isoformat()}]},
                [Quote(option_id="f1", label="VN 07:00", amount_vnd=1_200_000, recurrence="one_time")],
            ),
        },
    }


def test_selection_reference_orders_goals_and_independent_goals_share_a_column():
    done = {"home": TaskStatus.DONE, "fly": TaskStatus.DONE, "move": TaskStatus.NEEDS_INPUT}
    out = plan_progress(state({"selected:property": "h2"}, done))
    items = {i["task_id"]: i for i in out["items"]}
    assert set(items) == {"home", "fly", "move"}  # payment is hidden
    assert items["home"]["level"] == items["fly"]["level"] == 0
    assert items["move"]["level"] == 1 and items["move"]["after"] == ["home"]
    assert items["home"]["state"] == "confirmed" and items["home"]["chosen"]["label"] == "Căn B"
    assert items["fly"]["state"] == "reviewed" and items["move"]["state"] == "waiting"
    assert "selected_listing_id" not in items["move"]["inputs"]
    assert out["totals"] == {"monthly_vnd": 4_000_000, "one_time_vnd": 0, "confirmed": 1, "unpriced": []}


def test_total_counts_only_confirmed_options_and_reports_unpriced_choices():
    done = {"home": TaskStatus.DONE, "fly": TaskStatus.DONE, "move": TaskStatus.PENDING}
    out = plan_progress(state({"selected:property": "h1", "selected:flight": "f1"}, done))
    assert out["totals"]["monthly_vnd"] == 4_000_000 and out["totals"]["one_time_vnd"] == 1_200_000
    unpriced = state({"selected:property": "h1"}, done)
    unpriced["task_results"]["home"].quotes = []  # e.g. price flagged by data quality
    totals = plan_progress(unpriced)["totals"]
    assert totals["monthly_vnd"] == 0 and totals["unpriced"] == ["home"] and totals["confirmed"] == 1


def test_no_plan_has_no_goals():
    assert plan_progress({})["items"] == []


def test_goal_keeps_earlier_goals_and_requested_but_unplanned_domains():
    turn1 = state({}, {"home": TaskStatus.DONE, "fly": TaskStatus.DONE})
    turn1["intake"].kind = RequestKind.NEW_GOAL
    turn1["plan"] = Plan(version=1, tasks=[t for t in turn1["plan"].tasks if t.id in {"home", "fly"}])
    goal = record_goal(turn1)
    assert set(goal) == {"home", "fly", "pending:relocation"}

    # Turn 2 asks for moving to the chosen home but misses details: the planner keeps only Housing.
    turn2 = state({"selected:property": "h2"}, {"home": TaskStatus.DONE, "fly": TaskStatus.DONE})
    turn2["plan"] = Plan(version=2, tasks=[t for t in turn2["plan"].tasks if t.id == "home"])
    turn2["intake"].constraints = Constraints(values={"to_address": "selected:property", "move_date": "2026-10-05"})
    turn2["goal_tasks"] = goal
    turn2["goal_tasks"] = record_goal(turn2)
    items = {i["task_id"]: i for i in plan_progress(turn2)["items"]}
    assert set(items) == {"home", "fly", "pending:relocation"}  # flight from turn 1 stays on the strip
    assert items["fly"]["state"] == "reviewed" and items["home"]["state"] == "confirmed"
    moving = items["pending:relocation"]
    assert moving["state"] == "waiting" and moving["after"] == ["home"] and moving["level"] == 1
    assert moving["inputs"] == {"to_address": "selected:property", "move_date": "2026-10-05"}

    # A new request starts fresh execution, while the plan panel remembers this thread's completed steps.
    turn3 = state({}, {})
    turn3["intake"].kind = RequestKind.NEW_GOAL
    turn3["plan"] = Plan(version=1, tasks=[t for t in turn3["plan"].tasks if t.id == "fly"])
    turn3["goal_tasks"] = turn2["goal_tasks"]
    assert set(record_goal(turn3)) == {"home", "fly", "pending:property", "pending:relocation"}


def test_plan_remembers_housing_and_moving_choices_when_flight_is_classified_new_goal():
    first = state(
        {"selected:property": "h2", "selected:relocation": "m1"}, {"home": TaskStatus.DONE, "move": TaskStatus.DONE}
    )
    first["intake"].kind = RequestKind.NEW_GOAL
    first["plan"] = Plan(
        version=1,
        tasks=[
            Task(id="home", agent=AgentName.PROPERTY, inputs={"city": "Hà Nội"}),
            Task(id="move", agent=AgentName.RELOCATION, inputs={"mode": "quote"}),
        ],
    )
    first["task_results"]["move"] = result(
        "move",
        AgentName.RELOCATION,
        {
            "quotes": [{"option_id": "m1", "vehicle": "Xe van"}],
            "expires_at": (utcnow() + timedelta(hours=1)).isoformat(),
        },
        [Quote(option_id="m1", label="Xe van", amount_vnd=300_000, recurrence="one_time")],
    )
    first["goal_tasks"] = record_goal(first)
    first["goal_selections"] = record_selections(first)

    flight = state({}, {"home": TaskStatus.DONE, "move": TaskStatus.DONE, "fly": TaskStatus.DONE})
    flight["intake"].kind = RequestKind.NEW_GOAL
    flight["intake"].intent = Intent(name="flight", domains=[AgentName.FLIGHT])
    flight["plan"] = Plan(
        version=2, tasks=[Task(id="fly", agent=AgentName.FLIGHT, inputs={"origin": "SGN", "destination": "HAN"})]
    )
    flight["task_results"]["move"] = first["task_results"]["move"]
    flight["goal_tasks"] = first["goal_tasks"]
    flight["goal_selections"] = first["goal_selections"]
    flight["goal_tasks"] = record_goal(flight)
    flight["goal_selections"] = record_selections(flight)

    progress = plan_progress(flight)
    items = {item["task_id"]: item for item in progress["items"]}
    assert set(items) == {"home", "move", "fly"}
    assert items["home"]["chosen"]["label"] == "Căn B"
    assert items["move"]["chosen"]["label"] == "Xe van"
    assert progress["totals"]["monthly_vnd"] == 4_000_000
    assert progress["totals"]["one_time_vnd"] == 300_000


def test_expired_moving_quote_keeps_vehicle_choice_without_counting_old_price():
    values = state({"selected:relocation": "m1"}, {"move": TaskStatus.DONE})
    values["plan"] = Plan(version=2, tasks=[Task(id="move", agent=AgentName.RELOCATION, inputs={"mode": "quote"})])
    values["task_results"]["move"] = result(
        "move",
        AgentName.RELOCATION,
        {"quotes": [{"option_id": "m1"}], "expires_at": (utcnow() - timedelta(minutes=1)).isoformat()},
        [Quote(option_id="m1", label="Xe van", amount_vnd=300_000, recurrence="one_time")],
    )
    progress = plan_progress(values)
    moving = progress["items"][0]
    assert moving["chosen"]["label"] == "Xe van"
    assert moving["task_status"] == "stale"
    assert moving["state"] != "confirmed"
    assert moving["chosen"]["amount_vnd"] is None
    assert progress["totals"]["one_time_vnd"] == 0
    assert progress["totals"]["confirmed"] == 0


@pytest.mark.parametrize(
    "task_status", [TaskStatus.STALE, TaskStatus.FAILED, TaskStatus.PENDING, TaskStatus.NEEDS_INPUT]
)
def test_invalidated_choice_remains_history_but_not_current_price_or_ui_selection(task_status):
    values = state({"selected:flight": "f1"}, {"fly": task_status})
    values["goal_selections"] = {"fly": "f1"}
    progress = plan_progress(values)
    flight = next(item for item in progress["items"] if item["task_id"] == "fly")
    assert flight["chosen"]["id"] == "f1"
    assert flight["chosen"]["amount_vnd"] is None
    assert flight["state"] != "confirmed"
    assert progress["totals"]["one_time_vnd"] == 0
    assert "flight" not in _selections(values)


@pytest.mark.parametrize("result_status", ["failed", "needs_input"])
def test_result_not_done_cannot_be_confirmed_even_if_scheduler_status_is_done(result_status):
    values = state({"selected:property": "h1"}, {"home": TaskStatus.DONE})
    values["task_results"]["home"].status = result_status
    assert plan_progress(values)["totals"]["confirmed"] == 0
    assert "property" not in _selections(values)
    assert record_selections(values) == {}


@pytest.mark.parametrize("expiration", [None, "invalid", "2020-01-01T00:00:00", "2020-01-01T00:00:00Z"])
@pytest.mark.parametrize(
    "domain,task_id,option_id,key",
    [
        (AgentName.FLIGHT, "fly", "f1", "offers"),
        (AgentName.RELOCATION, "move", "m1", "quotes"),
    ],
)
def test_missing_invalid_or_expired_provider_deadline_is_not_an_active_choice(
    expiration, domain, task_id, option_id, key
):
    values = state({f"selected:{domain.value}": option_id}, {task_id: TaskStatus.DONE})
    values["task_results"][task_id] = result(
        task_id,
        domain,
        {key: [{"id": option_id, "expires_at": expiration}]},
        [Quote(option_id=option_id, label="Selected option", amount_vnd=300_000, recurrence="one_time")],
    )
    values["goal_selections"] = {task_id: option_id}
    progress = plan_progress(values)
    item = next(item for item in progress["items"] if item["task_id"] == task_id)
    assert item["task_status"] == "stale"
    assert item["chosen"]["amount_vnd"] is None
    assert progress["totals"]["one_time_vnd"] == 0
    assert domain.value not in _selections(values)


def test_flight_uses_selected_offer_deadline_not_another_offer_or_result_fallback():
    values = state({"selected:flight": "f1"}, {"fly": TaskStatus.DONE})
    flight = values["task_results"]["fly"]
    flight.data["expires_at"] = "2020-01-01T00:00:00Z"
    flight.data["offers"].append({"id": "f2", "expires_at": "2020-01-01T00:00:00Z"})
    assert plan_progress(values)["totals"]["one_time_vnd"] == 1_200_000
    assert _selections(values)["flight"]["id"] == "f1"
    flight.data["offers"][0]["expires_at"] = "invalid"
    flight.data["expires_at"] = (utcnow() + timedelta(hours=1)).isoformat()
    assert plan_progress(values)["totals"]["one_time_vnd"] == 0
    assert "flight" not in _selections(values)


def test_fresh_historical_home_is_available_without_restoring_unrelated_old_facts():
    values = state({}, {"home": TaskStatus.DONE})
    values["goal_tasks"] = {"home": {"agent": "property", "inputs": {}, "depends_on": []}}
    values["goal_selections"] = {"home": "h2"}
    values["plan"] = Plan(version=3, tasks=[])
    assert _selections(values)["property"]["id"] == "h2"
    assert plan_progress(values)["totals"]["monthly_vnd"] == 4_000_000
    values["goal_selections"] = {}
    values["intake"].user_confirmed_facts["selected:property"] = ConfirmedFact(
        value="h2", evidence="choice", stated_at=utcnow()
    )
    assert _selections(values) == {}  # old fact alone cannot reactivate an untracked task


@pytest.mark.parametrize(
    "domain,task_id,key",
    [
        (AgentName.FLIGHT, "fly", "offers"),
        (AgentName.RELOCATION, "move", "quotes"),
    ],
)
def test_absent_deadline_is_not_current_even_with_done_status_and_a_known_price(domain, task_id, key):
    values = state({f"selected:{domain.value}": "option"}, {task_id: TaskStatus.DONE})
    values["task_results"][task_id] = result(
        task_id,
        domain,
        {key: [{"id": "option"}]},
        [Quote(option_id="option", label="Selected option", amount_vnd=300_000, recurrence="one_time")],
    )
    assert domain.value not in _selections(values)
    assert plan_progress(values)["totals"]["one_time_vnd"] == 0


@pytest.mark.parametrize("status", [TaskStatus.STALE, TaskStatus.FAILED, TaskStatus.PENDING])
def test_remembered_home_does_not_reactivate_invalidated_history(status):
    values = state({}, {"home": status})
    values["goal_selections"] = {"home": "h2"}
    assert remembered_home(values["intake"], values) is values["intake"]


def test_reused_task_id_cannot_confirm_result_from_another_domain():
    values = state({"selected:flight": "f1"}, {"fly": TaskStatus.DONE})
    values["goal_selections"] = {"fly": "f1"}
    values["plan"] = Plan(version=3, tasks=[Task(id="fly", agent=AgentName.PROPERTY, inputs={})])
    assert _selections(values) == {}
    assert plan_progress(values)["totals"]["confirmed"] == 0
