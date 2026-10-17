"""Offline multi-turn regressions: one semantic call, grounded filter edits, no silent relaxation."""

import copy
import json

import pytest
from langchain_core.messages import HumanMessage
from relohome_agent.agents.common import utcnow
from relohome_agent.agents.deps import AgentRegistry, test_deps
from relohome_agent.agents.housing_fast_path import filter_followup_task
from relohome_agent.agents.housing_filter_edits import valid_filter_patch
from relohome_agent.agents.intake_llm import DraftFact, LlmIntake
from relohome_agent.agents.models import (
    AgentName,
    ChangeContext,
    HousingFilterPatch,
    OutcomeCode,
    Plan,
    RequestKind,
    SessionContext,
    Task,
    TaskResult,
    ValidationReport,
)
from relohome_agent.agents.nodes.intake import make_intake
from relohome_agent.agents.nodes.orchestrator import make_orchestrator
from relohome_agent.agents.planner_llm import LlmPlanner
from relohome_agent.agents.planning import PlannerInput
from relohome_agent.agents.routing import route_from_executor
from relohome_agent.agents.subagents.capabilities import BASELINE_CAPABILITIES
from relohome_agent.agents.subagents.services.read_llm import ReadLlmAgent

from tests.test_agents.helpers import Session, fact, intake_result
from tests.test_agents.test_token_efficiency import Housing, Model, intake_draft, plan_draft

BASE = {"city": "Hà Nội", "max_price_vnd": 5_000_000, "must_have": ["internet"]}
FIRST = "Tìm nhà Hà Nội dưới 5 triệu, có internet."


def intake_deps(intake):
    return test_deps(intake=intake, planner=LlmPlanner(Model(), BASELINE_CAPABILITIES))


def draft(text, *, kind="change", values=None, patch=None, **changes):
    result = intake_draft(retrieval_only=True)
    return result.model_copy(
        update={
            "kind": kind,
            "normalized_goal": text,
            "facts": [DraftFact(key=k, value=v, evidence=text, suggestion_key=None) for k, v in (values or {}).items()],
            "housing_filter_patch": HousingFilterPatch(evidence=text, **patch) if patch else None,
            **changes,
        }
    )


class SequenceModel(Model):
    def __init__(self, drafts):
        super().__init__()
        self.drafts = list(drafts)

    async def parse(self, prompt, data, schema):
        self.reply = self.drafts.pop(0)
        return await super().parse(prompt, data, schema)


def workflow(drafts):
    model, planner_model, adapter = SequenceModel(drafts), Model(), Housing()
    agent = ReadLlmAgent("unused-key", "unused-model", adapter)
    deps = test_deps(
        intake=LlmIntake(model, max_calls=1),
        planner=LlmPlanner(planner_model, BASELINE_CAPABILITIES, max_calls=1),
        agents=AgentRegistry({AgentName.PROPERTY: agent}),
    )
    return Session(deps), model, planner_model, adapter, agent


@pytest.mark.asyncio
async def test_six_followups_keep_filters_and_use_only_one_intake_generation_per_turn():
    turns = [
        (FIRST, draft(FIRST, kind="new_goal", values=BASE), dict(BASE)),
        (
            "Giảm xuống dưới 4 triệu.",
            draft("Giảm xuống dưới 4 triệu.", values={"max_price_vnd": 4_000_000}),
            {**BASE, "max_price_vnd": 4_000_000},
        ),
        (
            "Thêm điều kiện có điều hòa.",
            draft("Thêm điều kiện có điều hòa.", kind="refine", patch={"add_amenities": ["air_conditioning"]}),
            {**BASE, "max_price_vnd": 4_000_000, "must_have": ["internet", "air_conditioning"]},
        ),
        (
            "Bỏ điều kiện điều hòa.",
            draft("Bỏ điều kiện điều hòa.", patch={"remove_amenities": ["air_conditioning"]}),
            {**BASE, "max_price_vnd": 4_000_000},
        ),
        (
            "Chuyển sang Đà Nẵng, giữ mức giá.",
            draft("Chuyển sang Đà Nẵng, giữ mức giá.", values={"city": "Đà Nẵng"}),
            {**BASE, "city": "Đà Nẵng", "max_price_vnd": 4_000_000},
        ),
        (
            "Tìm căn khác.",
            draft("Tìm căn khác.", kind="refine"),
            {**BASE, "city": "Đà Nẵng", "max_price_vnd": 4_000_000},
        ),
        (
            "Không giới hạn giá nữa.",
            draft("Không giới hạn giá nữa.", patch={"clear_fields": ["max_price_vnd"]}),
            {"city": "Đà Nẵng", "must_have": ["internet"]},
        ),
    ]
    session, model, planner_model, adapter, agent = workflow([d for _, d, _ in turns])
    previous_id = None
    for index, (text, _, expected) in enumerate(turns, 1):
        result = await session.say(text)
        assert result["response"].kind == "ANSWER", result.get("outcome")
        assert result["intake"].constraints.values == expected
        assert result["intake"].housing_filter_patch is None
        task = result["plan"].tasks[0]
        assert task.inputs == expected and result["plan"].version == index
        assert previous_id is None or task.id == previous_id
        previous_id = task.id
        assert len(adapter.requests) == len(model.calls) == index
        assert adapter.requests[-1].inputs == expected
        assert result["task_results"][task.id].plan_version == index
        assert result["task_results"][task.id].data["agent_trace"]["implementation"] == "validated-filter-retrieval"
        counts = await session.deps.usage.counts("th1", f"r{index}")
        assert counts.llm_calls == 1 and counts.subagent_llm_calls == 0
        assert not result.get("committed") and not result["plan"].commit_actions
    assert not planner_model.calls and agent.llm_client is None
    # "Tìm căn khác" is a fresh provider read, not reuse of the still-fresh previous result.
    assert adapter.requests[4].request_id != adapter.requests[5].request_id


def prior(**values):
    values = {**BASE, **values}
    return intake_result(
        domains=[AgentName.PROPERTY],
        values=values,
        facts={k: fact(v, FIRST) for k, v in values.items()},
        retrieval_only=True,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["change", "refine"])
async def test_clear_last_amenity_does_not_resurrect_it_from_previous_facts(kind):
    text = "Bỏ điều kiện điều hòa."
    old = prior(must_have=["air_conditioning"])
    deps = intake_deps(
        intake=LlmIntake(Model(draft(text, kind=kind, patch={"remove_amenities": ["air_conditioning"]})), max_calls=1)
    )
    result = await make_intake(deps)({"messages": [HumanMessage(text)], "intake": old, "session": SessionContext()})
    current = result["intake"]
    assert current.constraints.values == {**BASE, "must_have": []}
    assert current.user_confirmed_facts["must_have"].value == []
    assert current.kind == RequestKind.CHANGE and not current.needs_clarification
    assert old.constraints.values["must_have"] == ["air_conditioning"]


@pytest.mark.asyncio
async def test_city_edit_invalidates_old_scope_pin_place_id_and_viewport_but_keeps_price():
    text = "Chuyển sang Đà Nẵng, giữ mức giá."
    bbox = {"west": 105.7, "east": 105.9, "south": 20.9, "north": 21.1}
    old = prior(
        district="Cầu Giấy",
        near="Bách Khoa",
        near_coordinate={"lat": 21.0, "lng": 105.8},
        near_place_id="old-place",
        bounding_box=bbox,
    )
    deps = intake_deps(intake=LlmIntake(Model(draft(text, values={"city": "Đà Nẵng"})), max_calls=1))
    result = await make_intake(deps)(
        {
            "messages": [HumanMessage(text)],
            "intake": old,
            "session": SessionContext(),
            "housing_location": {"address": "Bách Khoa", "lat": 21.0, "lng": 105.8, "confirmed": True},
            "map_view": {"bounding_box": bbox},
        }
    )
    current = result["intake"]
    assert current.constraints.values == {**BASE, "city": "Đà Nẵng"}
    assert (
        not {"district", "near", "near_coordinate", "near_place_id", "bounding_box"}
        & current.user_confirmed_facts.keys()
    )
    assert result["housing_location"] is None and not current.needs_clarification


@pytest.mark.asyncio
async def test_clear_near_removes_verified_pin_without_clearing_city_or_other_filters():
    text = "Không cần gần Bách Khoa nữa."
    old = prior(near="Bách Khoa", near_coordinate={"lat": 21.0, "lng": 105.8}, near_place_id="old-place")
    deps = intake_deps(intake=LlmIntake(Model(draft(text, patch={"clear_fields": ["near"]})), max_calls=1))
    result = await make_intake(deps)(
        {
            "messages": [HumanMessage(text)],
            "intake": old,
            "session": SessionContext(),
            "housing_location": {"address": "Bách Khoa", "lat": 21.0, "lng": 105.8, "confirmed": True},
        }
    )
    assert result["intake"].constraints.values == BASE and result["housing_location"] is None


@pytest.mark.parametrize(
    "patch,new_values",
    [
        ({"add_amenities": ["invented"]}, {}),
        ({"add_amenities": ["internet"], "remove_amenities": ["internet"]}, {}),
        ({"clear_fields": ["selected:property"]}, {}),
        ({"clear_fields": ["near_coordinate"]}, {}),
        ({"clear_fields": ["city"]}, {}),
        ({"clear_fields": ["housing_mode"]}, {}),
        ({"clear_fields": ["max_price_vnd"]}, {"max_price_vnd": 4_000_000}),
        ({"add_amenities": ["internet"]}, {"must_have": []}),
        ({"add_amenities": ["internet"], "clear_fields": ["must_have"]}, {}),
        ({"evidence": "not user text", "clear_fields": ["must_have"]}, {}),
        ({}, {}),
    ],
)
def test_patch_contract_rejects_unknown_conflicting_or_unproven_edits(patch, new_values):
    assert not valid_filter_patch(
        HousingFilterPatch(**{"evidence": "bỏ điều kiện", **patch}), "bỏ điều kiện", new_values
    )


@pytest.mark.asyncio
async def test_invalid_model_patch_asks_again_and_does_not_remove_existing_filters():
    text = "Thêm điều hòa."
    model = Model(draft(text, patch={"clear_fields": ["city"]}))
    deps = intake_deps(intake=LlmIntake(model, max_calls=1))
    result = await make_intake(deps)({"messages": [HumanMessage(text)], "intake": prior(), "session": SessionContext()})
    assert result["intake"].needs_clarification and result["intake"].constraints.values == BASE
    assert len(model.calls) == 1


def followup_input():
    current = prior(max_price_vnd=4_000_000).model_copy(update={"kind": RequestKind.CHANGE})
    return PlannerInput(
        intake=current,
        session=SessionContext(),
        available_agents=list(BASELINE_CAPABILITIES),
        previous_plan=Plan(version=2, tasks=[Task(id="search", agent="property", inputs=BASE)]),
    )


@pytest.mark.parametrize(
    "case",
    [
        "semantic_off",
        "prefill",
        "selection",
        "compare",
        "custom_input",
        "other_target",
        "validation",
        "blocked",
        "other_change",
        "mixed_plan",
        "dependency",
        "multiple_searches",
        "previous_compare",
        "historical_moving",
        "historical_comparison",
        "action",
        "receipt",
    ],
)
def test_followup_shortcut_fails_closed_for_analytical_or_transactional_workflows(case):
    inp = followup_input()
    if case == "semantic_off":
        inp.intake.retrieval_only = False
    if case == "prefill":
        inp.intake.prefilled = {"room_type": {"value": "studio"}}
    if case == "selection":
        inp.intake.user_confirmed_facts["selected:property"] = fact("home-1", "căn này")
    if case == "compare":
        inp.intake.constraints.values.update(housing_mode="compare", listing_ids=["a", "b"])
    if case == "custom_input":
        inp.intake.constraints.values["custom_requirement"] = "quiet"
    if case == "other_target":
        inp.intake.target_task_ids = ["other"]
    if case == "validation":
        inp.validation = ValidationReport(verdict="NEED_MORE", action="REPLAN")
    if case == "blocked":
        inp.change_context = ChangeContext(blocked_by_commit=["booked"])
    if case == "other_change":
        inp.change_context = ChangeContext(invalidated_task_ids=["other"])
    if case == "mixed_plan":
        inp.previous_plan.tasks.append(Task(id="moving", agent="relocation", inputs={}))
    if case == "dependency":
        inp.previous_plan = Plan(
            version=2, tasks=[Task(id="search", agent="property", inputs=BASE, depends_on=["other"])]
        )
    if case == "multiple_searches":
        inp.previous_plan.tasks.append(Task(id="other-search", agent="property", inputs=BASE))
    if case == "previous_compare":
        inp.previous_plan = Plan(
            version=2, tasks=[Task(id="search", agent="property", inputs={**BASE, "housing_mode": "compare"})]
        )
    if case in {"historical_moving", "historical_comparison"}:
        inp.previous_results["older"] = TaskResult(
            task_id="older",
            agent="relocation" if case == "historical_moving" else "property",
            plan_version=1,
            status="done",
            data={"comparison": case == "historical_comparison"},
            fetched_at=utcnow(),
        )
    if case == "action":
        inp.previous_plan.commit_actions.append(object())
    if case == "receipt":
        inp.committed["booked"] = object()
    assert filter_followup_task(inp) is None


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", [RequestKind.CHANGE, RequestKind.REFINE])
async def test_planner_reuses_search_identity_and_issues_a_code_only_hint(kind):
    inp = followup_input()
    inp.intake.kind = kind
    inp.change_context = ChangeContext(invalidated_task_ids=["search"])
    old = copy.deepcopy(inp)
    model = Model()
    planned = await LlmPlanner(model, BASELINE_CAPABILITIES).plan(inp)
    assert planned.retrieval_only_task_ids == ["search"] and not model.calls
    assert planned.plan.tasks[0].id == "search"
    assert planned.plan.tasks[0].inputs == {**BASE, "max_price_vnd": 4_000_000}
    assert inp == old
    state = {"plan": planned.plan, "intake": inp.intake, "dispatch": ["search"]}
    assert not route_from_executor(state)[0].arg["retrieval_only"]  # Intake alone cannot authorize bypass.
    state["filter_search_task_ids"] = planned.retrieval_only_task_ids
    assert route_from_executor(state)[0].arg["retrieval_only"]


@pytest.mark.asyncio
async def test_disabling_the_flag_keeps_filter_edits_but_uses_the_full_planner():
    text = "Thêm điều hòa."
    intake_model = Model(draft(text, patch={"add_amenities": ["air_conditioning"]}))
    deps = intake_deps(intake=LlmIntake(intake_model, enable_filter_fast_path=False, max_calls=1))
    update = await make_intake(deps)({"messages": [HumanMessage(text)], "intake": prior(), "session": SessionContext()})
    current = update["intake"]
    assert not current.retrieval_only and current.constraints.values["must_have"] == ["internet", "air_conditioning"]
    inp = followup_input().model_copy(update={"intake": current})
    reply = plan_draft().model_copy(
        update={
            "tasks": [
                plan_draft()
                .tasks[0]
                .model_copy(update={"id": "search", "inputs_json": json.dumps(current.constraints.values)})
            ]
        }
    )
    planner_model = Model(reply)
    planned = await LlmPlanner(planner_model, BASELINE_CAPABILITIES, max_calls=1).plan(inp)
    assert len(planner_model.calls) == 1 and not planned.retrieval_only_task_ids


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "state_change", ["legacy", "viewing_selection", "goal_selection", "pending_payment", "custom_goal"]
)
async def test_prior_choices_and_non_filter_requirements_cannot_be_erased_by_a_followup_hint(state_change):
    text = "Giảm xuống dưới 4 triệu."
    old = prior()
    state = {"messages": [HumanMessage(text)], "intake": old, "session": SessionContext()}
    if state_change in {"legacy", "custom_goal"}:
        old.retrieval_only = False
    if state_change == "viewing_selection":
        state["housing_selection"] = [{"listing_id": "home-1"}]
    if state_change == "goal_selection":
        state["goal_selections"] = {"search": "home-1"}
    if state_change == "pending_payment":
        state["pending_payment"] = object()
    deps = intake_deps(intake=LlmIntake(Model(draft(text, values={"max_price_vnd": 4_000_000})), max_calls=1))
    update = await make_intake(deps)(state)
    assert not update["intake"].retrieval_only
    assert update["intake"].constraints.values["max_price_vnd"] == 4_000_000


@pytest.mark.asyncio
async def test_two_threads_do_not_share_filter_patches_or_planner_hints():
    a, _, a_planner, a_adapter, _ = workflow(
        [
            draft(FIRST, kind="new_goal", values=BASE),
            draft("Bỏ internet.", patch={"remove_amenities": ["internet"]}),
        ]
    )
    other = "Tìm nhà Đà Nẵng dưới 3 triệu."
    b, _, b_planner, b_adapter, _ = workflow(
        [draft(other, kind="new_goal", values={"city": "Đà Nẵng", "max_price_vnd": 3_000_000})]
    )
    await a.say(FIRST)
    await b.say(other)
    await a.say("Bỏ internet.")
    assert a_adapter.requests[-1].inputs == {**BASE, "must_have": []}
    assert b_adapter.requests[-1].inputs == {"city": "Đà Nẵng", "max_price_vnd": 3_000_000}
    assert not a_planner.calls and not b_planner.calls


@pytest.mark.asyncio
async def test_one_generation_budget_allows_filter_planning_but_not_a_model_fallback():
    session, _, planner_model, adapter, _ = workflow(
        [
            draft(FIRST, kind="new_goal", values=BASE),
            draft("Giảm xuống dưới 4 triệu.", values={"max_price_vnd": 4_000_000}),
        ]
    )
    session.deps.settings.max_llm_calls_per_turn = 1
    for text in (FIRST, "Giảm xuống dưới 4 triệu."):
        result = await session.say(text)
        assert result["response"].kind == "ANSWER", result.get("outcome")
    assert len(adapter.requests) == 2 and not planner_model.calls
    # A non-filter task must still fail before any model invocation when the
    # Intake has already consumed the turn's one generation.
    inp = followup_input()
    inp.intake.retrieval_only = False
    update = await make_orchestrator(session.deps)(
        {
            "intake": inp.intake,
            "session": SessionContext(),
            "plan": inp.previous_plan,
            "thread_id": "th1",
            "request_id": "r2",
        }
    )
    assert update["outcome"].code == OutcomeCode.BUDGET and not planner_model.calls
