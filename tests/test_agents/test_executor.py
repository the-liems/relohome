"""compute_ready và downstream_closure (agent-graph.md §6.4, §6.8)."""

from relohome_agent.agents.models import AgentName, Plan, Task, TaskStatus
from relohome_agent.agents.nodes.change_impact import downstream_closure
from relohome_agent.agents.nodes.executor import compute_ready

S = TaskStatus
P = AgentName.PROPERTY


def plan(*tasks: Task) -> Plan:
    return Plan(version=1, tasks=list(tasks))


def t(task_id: str, *deps: str) -> Task:
    return Task(id=task_id, agent=P, inputs={}, depends_on=list(deps))


def test_independent_tasks_are_ready_together_dependent_wait():
    p = plan(t("t1"), t("t2"), t("t3", "t1"))
    changed, ready = compute_ready(p, {}, {}, 2)
    assert ready == ["t1", "t2"]
    assert changed == {"t1": S.READY, "t2": S.READY}


def test_dependency_done_makes_task_ready():
    p = plan(t("t1"), t("t3", "t1"))
    _, ready = compute_ready(p, {"t1": S.DONE}, {}, 2)
    assert ready == ["t3"]


def test_failed_dependency_skips_downstream_transitively():
    p = plan(t("t1"), t("t2", "t1"), t("t3", "t2"))
    changed, ready = compute_ready(p, {"t1": S.FAILED}, {}, 2)
    assert changed == {"t2": S.SKIPPED, "t3": S.SKIPPED}
    assert ready == []


def test_needs_input_dependency_keeps_pending():
    p = plan(t("t1"), t("t2", "t1"))
    changed, ready = compute_ready(p, {"t1": S.NEEDS_INPUT}, {}, 2)
    assert changed == {} and ready == []


def test_attempts_exhausted_marks_failed():
    p = plan(t("t1"))
    changed, ready = compute_ready(p, {"t1": S.PENDING}, {"t1": 2}, 2)
    assert changed == {"t1": S.FAILED} and ready == []


def test_stale_treated_as_pending():
    p = plan(t("t1"), t("t2", "t1"))
    changed, ready = compute_ready(p, {"t1": S.STALE, "t2": S.STALE}, {}, 2)
    assert changed["t1"] == S.READY and changed["t2"] == S.PENDING
    assert ready == ["t1"]


def test_downstream_closure():
    p = plan(t("t1"), t("t2", "t1"), t("t3"), t("t4", "t2", "t3"))
    assert downstream_closure(p, {"t1"}) == {"t1", "t2", "t4"}
    assert downstream_closure(p, {"t3"}) == {"t3", "t4"}
