"""Pure state/plan contracts, not simulated providers or LLM responses (#75)."""

from langchain_core.messages import HumanMessage
from relohome_agent.agents.common import utcnow
from relohome_agent.agents.intake import IntakeInput
from relohome_agent.agents.intake_llm import IntakeDraft, LlmIntake
from relohome_agent.agents.memory import memory_updates
from relohome_agent.agents.models import (
    AgentName,
    Constraints,
    IntakeResult,
    Intent,
    Outcome,
    OutcomeCode,
    Plan,
    Quote,
    RequestKind,
    SessionContext,
    Task,
    TaskResult,
    TaskStatus,
)
from relohome_agent.agents.nodes.cost_summary import select_options
from relohome_agent.agents.nodes.respond import compose
from relohome_agent.agents.planner_llm import CapabilityRegistry, LlmPlanner
from relohome_agent.agents.planning import PlannerInput, validate_plan
from relohome_agent.agents.progress import plan_progress, record_selections
from relohome_agent.agents.selections import selection_is_current
from relohome_agent.agents.subagents.capabilities import BASELINE_CAPABILITIES


def comparison_input():
    return IntakeResult(
        kind=RequestKind.REFINE,
        intent=Intent(name="compare", domains=[AgentName.PROPERTY]),
        constraints=Constraints(values={"housing_mode": "compare", "listing_ids": ["contract-a", "contract-b"]}),
    )


def test_grounded_comparison_intent_cannot_be_downgraded_to_search_when_ids_are_unknown():
    text = "So sánh các căn ở một khu khác"
    draft = IntakeDraft(
        kind="refine",
        normalized_goal=text,
        intent_name="compare",
        domains=[AgentName.PROPERTY],
        facts=[],
        requested_actions=[],
        housing_comparison_evidence=text,
        unsupported_reason=None,
        drops_previous_goal=False,
        map_origin="none",
        conflicts=[],
        change_request=None,
        target_task_ids=[],
        declined_suggestions=[],
    )
    inp = IntakeInput(messages=[HumanMessage(text)], session=SessionContext(), supported_domains=[AgentName.PROPERTY])
    parser = LlmIntake(None)  # Only the pure conversion is exercised; no LLM is implemented or invoked.
    result, rejected = parser._convert(draft, inp, text)
    assert not rejected and result.constraints.values == {"housing_mode": "compare"}
    invalid, errors = parser._convert(
        draft.model_copy(update={"housing_comparison_evidence": "not in this message"}), inp, text
    )
    assert "housing_mode" not in invalid.constraints.values and errors


def test_new_goal_cannot_overwrite_a_reserved_history_id():
    intake = IntakeResult(
        kind=RequestKind.NEW_GOAL,
        intent=Intent(name="search", domains=[AgentName.PROPERTY]),
        constraints=Constraints(values={"city": "Hà Nội"}),
    )
    inp = PlannerInput(intake=intake, session=SessionContext(), reserved_task_ids=["old-search"])
    bad = Plan(version=2, tasks=[Task(id="old-search", agent=AgentName.PROPERTY, inputs=intake.constraints.values)])
    assert any("fresh task ID" in e for e in LlmPlanner._grounding_errors(bad, inp))
    fresh = Plan(version=2, tasks=[bad.tasks[0].model_copy(update={"id": "new-search"})])
    assert not LlmPlanner._grounding_errors(fresh, inp)


def test_new_comparison_id_is_not_forced_to_reuse_search_id():
    search = Task(id="search", agent=AgentName.PROPERTY, inputs={"city": "Hà Nội"})
    compare = Task(id="compare", agent=AgentName.PROPERTY, inputs=comparison_input().constraints.values)
    inp = PlannerInput(
        intake=comparison_input(), session=SessionContext(), previous_plan=Plan(version=1, tasks=[search])
    )
    assert not LlmPlanner._grounding_errors(Plan(version=2, tasks=[compare]), inp)
    assert not LlmPlanner._grounding_errors(Plan(version=2, tasks=[search, compare]), inp)
    assert "Missing requested Housing comparison task" in LlmPlanner._grounding_errors(
        Plan(version=2, tasks=[search]), inp
    )
    overwritten = compare.model_copy(update={"id": "search"})
    errors = validate_plan(
        Plan(version=2, tasks=[overwritten]),
        CapabilityRegistry(BASELINE_CAPABILITIES),
        inp.intake,
        {},
        inp.previous_plan,
    )
    assert any("separate task IDs" in error for error in errors)


def test_same_comparison_keeps_its_own_identity_but_returning_search_is_separate():
    compare = Task(id="compare", agent=AgentName.PROPERTY, inputs=comparison_input().constraints.values)
    inp = PlannerInput(
        intake=comparison_input(), session=SessionContext(), previous_plan=Plan(version=1, tasks=[compare])
    )
    renamed = compare.model_copy(update={"id": "another"})
    assert any(
        "preserve previous task id compare" in e
        for e in LlmPlanner._grounding_errors(Plan(version=2, tasks=[renamed]), inp)
    )
    inp.intake.constraints.values = {"city": "Hà Nội", "housing_mode": "search"}
    search = Task(id="new-search", agent=AgentName.PROPERTY, inputs=inp.intake.constraints.values)
    assert not LlmPlanner._grounding_errors(Plan(version=2, tasks=[search]), inp)


def test_comparison_does_not_replace_goal_choice_progress_or_cost():
    now = utcnow()
    compare = Task(id="compare", agent=AgentName.PROPERTY, inputs=comparison_input().constraints.values)
    search = TaskResult(
        task_id="search",
        agent=AgentName.PROPERTY,
        plan_version=1,
        status="done",
        fetched_at=now,
        data={"candidates": [{"id": "contract-a", "title": "Contract A"}]},
        quotes=[Quote(option_id="contract-a", label="Contract A", amount_vnd=1, recurrence="monthly")],
    )
    analysis = search.model_copy(deep=True, update={"task_id": "compare", "data": {"comparison": {"rows": []}}})
    state = {
        "plan": Plan(version=2, tasks=[compare]),
        "intake": comparison_input(),
        "goal_tasks": {"search": {"agent": "property", "inputs": {"city": "Hà Nội"}, "depends_on": []}},
        "goal_selections": {"search": "contract-a"},
        "task_status": {"search": TaskStatus.DONE, "compare": TaskStatus.DONE},
        "task_results": {"search": search, "compare": analysis},
    }
    progress = plan_progress(state)
    assert [i["task_id"] for i in progress["items"]] == ["search"]
    assert progress["items"][0]["chosen"]["id"] == "contract-a"
    assert progress["totals"]["monthly_vnd"] == 1
    assert record_selections(state) == {"search": "contract-a"}
    assert not selection_is_current(state, "compare", "contract-a")
    assert not select_options(state["plan"], state["task_results"], state["intake"])
    assert memory_updates(state) == []


def test_fresh_comparison_chat_is_short_and_does_not_repeat_carried_sandbox():
    now = utcnow()
    compare = Task(id="compare", agent=AgentName.PROPERTY, inputs=comparison_input().constraints.values)
    moving = Task(id="moving", agent=AgentName.RELOCATION, inputs={"mode": "catalog"})
    analysis = TaskResult(
        task_id="compare",
        agent=AgentName.PROPERTY,
        plan_version=2,
        status="done",
        fetched_at=now,
        source_kind="live",
        data={
            "comparison": {"rows": [{"id": "contract-a"}, {"id": "contract-b"}]},
            "execution": {"request_id": "turn2"},
            "agent_assessment": {
                "kind": "model_assessment_not_provider_fact",
                "satisfaction": "limited",
                "reason": "contract " * 200,
            },
        },
    )
    carried = analysis.model_copy(
        update={
            "task_id": "moving",
            "agent": AgentName.RELOCATION,
            "source_kind": "sandbox",
            "data": {"execution": {"request_id": "turn1"}},
        }
    )
    state = {
        "request_id": "turn2",
        "messages": [HumanMessage("So sánh hai căn đã xem")],
        "intake": comparison_input(),
        "plan": Plan(version=2, tasks=[compare, moving]),
        "task_results": {"compare": analysis, "moving": carried},
        "task_status": {"compare": TaskStatus.DONE, "moving": TaskStatus.DONE},
        "outcome": Outcome(node="cost_summary", code=OutcomeCode.ANSWER),
    }
    reply = compose(state, None)  # pure formatter; no dependency is used or simulated
    assert reply.kind == "PARTIAL" and "Nhà bạn đã chọn không thay đổi" in reply.text
    assert len(reply.text.split()) <= 45
    assert "sandbox" not in reply.text and "contract" not in reply.text
    assert reply.data["limited_tasks"]["compare"]["reason"] == analysis.data["agent_assessment"]["reason"]


def test_missing_comparison_ids_asks_once_and_does_not_repeat_an_old_table():
    intake = comparison_input()
    intake.blocking_missing = ["property.listing_ids"]
    intake.conflicts = ["Cannot identify the new comparison listings"]
    result = TaskResult(
        task_id="compare",
        agent=AgentName.PROPERTY,
        plan_version=1,
        status="done",
        fetched_at=utcnow(),
        data={"comparison": {"rows": []}, "execution": {"request_id": "old-turn"}},
    )
    response = compose(
        {
            "intake": intake,
            "request_id": "new-turn",
            "task_results": {"compare": result},
            "plan": Plan(version=2, tasks=[Task(id="compare", agent=AgentName.PROPERTY)]),
            "task_status": {"compare": TaskStatus.DONE},
            "outcome": Outcome(node="intake", code=OutcomeCode.CLARIFY),
        },
        None,
    )
    assert response.kind == "CLARIFY" and len(response.questions) == 1
    assert response.questions[0].field == "property.listing_ids"
    assert not response.data["results"] and len(response.text.split()) < 65
