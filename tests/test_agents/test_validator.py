"""V1–V5 và bảng quyết định của validator (agent-graph.md §6.5)."""

from datetime import timedelta

from relohome_agent.agents.common import utcnow
from relohome_agent.agents.models import AgentName, Constraints, Plan, Question, Quote, Task, TaskResult, TaskStatus
from relohome_agent.agents.nodes.validator import decide, required_field_problems
from relohome_agent.agents.subagents.capabilities import PROPERTY

from tests.test_agents.helpers import intake_result

S = TaskStatus
NOW = utcnow()
PLAN = Plan(version=1, tasks=[Task(id="t1", agent=AgentName.PROPERTY, inputs={"city": "HCM"})])
GOOD = {"candidates": [{"id": "a", "title": "A", "price_vnd": 1, "address": "x"}]}


def result(status="done", data=None, fetched_at=NOW, refs=("a",), **kw) -> TaskResult:
    return TaskResult(
        task_id="t1",
        agent=AgentName.PROPERTY,
        plan_version=1,
        status=status,
        data=GOOD if data is None else data,
        source_refs=list(refs),
        fetched_at=fetched_at,
        quotes=[Quote(option_id="a", label="A", amount_vnd=1, recurrence="monthly")],
        **kw,
    )


def run(status, res, intake=None, attempts=None, replans_left=True):
    return decide(
        PLAN,
        {"t1": status},
        {"t1": res} if res else {},
        attempts or {"t1": 1},
        intake or intake_result(domains=[AgentName.PROPERTY]),
        {"t1": PROPERTY},
        {"t1": PROPERTY.stale_ttl_s},
        NOW,
        max_attempts=2,
        replans_left=replans_left,
    )


def test_pass():
    assert run(S.DONE, result()).verdict == "PASS"


def test_missing_constraints_ask_user_even_without_issues():
    intake = intake_result(domains=[AgentName.PROPERTY]).model_copy(
        update={"constraints": Constraints(missing=["flight.flight_date"])}
    )
    report = run(S.DONE, result(), intake=intake)
    assert report.action == "ASK_USER" and report.ask_user_fields == ["flight.flight_date"]


def test_needs_input_questions_are_forwarded():
    res = result(status="needs_input", data={}, questions=[Question(field="near", text="Ở đâu?")])
    report = run(S.NEEDS_INPUT, res)
    assert report.action == "ASK_USER" and report.questions[0].field == "near"


def test_budget_exceeded_gives_up():
    res = result(status="failed", data={}, error="budget_exceeded", error_code="budget_exceeded")
    assert run(S.FAILED, res).action == "GIVE_UP"


def test_retryable_failure_retries_then_replans():
    res = result(status="failed", data={}, error="timeout", error_code="timeout", retryable=True)
    assert run(S.FAILED, res).action == "RETRY_TASKS"
    assert run(S.FAILED, res, attempts={"t1": 2}).action == "REPLAN"
    assert run(S.FAILED, res, attempts={"t1": 2}, replans_left=False).action == "GIVE_UP"


def test_stale_result_is_retried():
    old = result(fetched_at=NOW - timedelta(hours=7))
    report = run(S.DONE, old)
    assert report.action == "RETRY_TASKS" and report.issues[0].code == "V3"


def test_empty_results_need_replan():
    report = run(S.DONE, result(data={"candidates": []}, refs=()))
    assert report.action == "REPLAN" and report.issues[0].code == "V2"


def test_schema_and_source_ref_checks():
    bad = result(data={"candidates": [{"id": "z", "title": "Z", "price_vnd": "1", "address": "x"}]}, refs=())
    codes = {i.code for i in run(S.DONE, bad).issues}
    assert codes == {"V2", "V4"}


def test_total_budget_conflict_asks_user():
    intake = intake_result(domains=[AgentName.PROPERTY], values={"budget_vnd": 0})
    res = result()
    res = res.model_copy(update={"quotes": [Quote(option_id="a", label="A", amount_vnd=5, recurrence="one_time")]})
    report = run(S.DONE, res, intake=intake)
    assert report.action == "ASK_USER" and report.issues[0].code == "V5"


def test_required_field_paths():
    data = {"quotes": [{"price_vnd": 1}, {"price_vnd": None}]}
    assert required_field_problems(data, [], ["quotes|order", "quotes[].price_vnd"]) == ["quotes[1].price_vnd"]
    assert required_field_problems({}, [], ["quotes|order"]) == ["quotes|order"]
    assert required_field_problems({"order": {"id": 1}}, [], ["quotes|order", "quotes[].price_vnd"]) == []
