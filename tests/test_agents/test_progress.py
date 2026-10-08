"""Dải tiến trình: mục tiêu từ plan, quan hệ trước/sau, trạng thái đã xem/đã chốt và tổng tiền đã chốt."""

from datetime import timedelta

from src.agents.common import utcnow
from src.agents.models import (
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
from src.agents.progress import plan_progress, record_goal, record_selections


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
                {"offers": [{"id": "f1", "carrier": "VN"}]},
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
    first = state({"selected:property": "h2", "selected:relocation": "m1"},
                  {"home": TaskStatus.DONE, "move": TaskStatus.DONE})
    first["intake"].kind = RequestKind.NEW_GOAL
    first["plan"] = Plan(version=1, tasks=[
        Task(id="home", agent=AgentName.PROPERTY, inputs={"city": "Hà Nội"}),
        Task(id="move", agent=AgentName.RELOCATION, inputs={"mode": "quote"}),
    ])
    first["task_results"]["move"] = result("move", AgentName.RELOCATION,
                                           {"quotes": [{"option_id": "m1", "vehicle": "Xe van"}]},
                                           [Quote(option_id="m1", label="Xe van", amount_vnd=300_000,
                                                  recurrence="one_time")])
    first["goal_tasks"] = record_goal(first)
    first["goal_selections"] = record_selections(first)

    flight = state({}, {"home": TaskStatus.DONE, "move": TaskStatus.DONE, "fly": TaskStatus.DONE})
    flight["intake"].kind = RequestKind.NEW_GOAL
    flight["intake"].intent = Intent(name="flight", domains=[AgentName.FLIGHT])
    flight["plan"] = Plan(version=2, tasks=[Task(id="fly", agent=AgentName.FLIGHT,
                                                  inputs={"origin": "SGN", "destination": "HAN"})])
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
        "move", AgentName.RELOCATION,
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
