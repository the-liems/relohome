"""Provider-free regressions for the two Langfuse traces and the read-only fast path."""

import copy
import json
from types import SimpleNamespace

import pytest
from langchain_core.messages import HumanMessage
from relohome_agent.agents.common import utcnow
from relohome_agent.agents.contracts import AgentTaskRequest, AgentTaskResult
from relohome_agent.agents.deps import AgentRegistry, test_deps
from relohome_agent.agents.housing_fast_path import is_filter_search
from relohome_agent.agents.intake import IntakeInput
from relohome_agent.agents.intake_llm import DraftFact, IntakeDraft, LlmIntake, ScalarIntakeDraft
from relohome_agent.agents.intake_prompts import prompt_for
from relohome_agent.agents.llm import LLMError
from relohome_agent.agents.models import AgentBudget, AgentName, Plan, RequestKind, SessionContext, Task
from relohome_agent.agents.planner_llm import LlmPlanner, PlanDraft, TaskDraft
from relohome_agent.agents.planning import PlannerInput
from relohome_agent.agents.routing import route_from_executor
from relohome_agent.agents.subagents.base import AgentPolicy, build_request
from relohome_agent.agents.subagents.capabilities import BASELINE_CAPABILITIES, PROPERTY
from relohome_agent.agents.subagents.services.read_llm import ReadLlmAgent

from tests.test_agents.helpers import Session, fact, intake_result

VALUES = {"near": "Ocean Park 2", "max_price_vnd": 5_000_000}
MESSAGE = "Tìm nhà ở khu Ocean Park 2 dưới 5 triệu"


class Model:
    last_usage = (0, 0)

    def __init__(self, reply=None):
        self.reply, self.calls = reply, []

    async def parse(self, prompt, data, schema):
        self.calls.append((prompt, copy.deepcopy(data), schema))
        assert self.reply is not None, "Unexpected paid-model invocation"
        return schema.model_validate(self.reply.model_dump(mode="json"))


def search_intake(**changes):
    return intake_result(domains=[AgentName.PROPERTY], values=dict(VALUES), retrieval_only=True, **changes)


def planner_input(intake=None, **changes):
    return PlannerInput(
        intake=intake or search_intake(),
        session=SessionContext(),
        available_agents=list(BASELINE_CAPABILITIES),
        **changes,
    )


def plan_draft(**inputs):
    return PlanDraft(
        tasks=[
            TaskDraft(
                id="property-1",
                agent=AgentName.PROPERTY,
                inputs_json=json.dumps({**VALUES, **inputs}),
                depends_on=[],
                required=True,
            )
        ],
        actions=[],
    )


@pytest.mark.parametrize("mode", [None, "search"])
def test_grounding_accepts_default_search_without_inventing_a_user_fact(mode):
    inputs = {**VALUES, **({"housing_mode": mode} if mode else {})}
    plan = Plan(version=0, tasks=[Task(id="property-1", agent="property", inputs=inputs)])
    assert not LlmPlanner._grounding_errors(plan, planner_input())
    assert "housing_mode" not in planner_input().intake.user_confirmed_facts


@pytest.mark.parametrize(
    "inputs",
    [
        {"housing_mode": "compare"},
        {"housing_mode": "search_compare"},
        {"must_have": ["air_conditioning"]},
        {"city": "Hà Nội"},
        {"max_price_vnd": 8_000_000},
    ],
)
def test_default_search_never_allows_other_modes_or_invented_filters(inputs):
    plan = Plan(version=0, tasks=[Task(id="property-1", agent="property", inputs={**VALUES, **inputs})])
    assert LlmPlanner._grounding_errors(plan, planner_input())


@pytest.mark.asyncio
async def test_trace_repair_is_removed_even_when_the_fast_path_is_not_used():
    model = Model(plan_draft(housing_mode="search"))
    planner = LlmPlanner(model, BASELINE_CAPABILITIES, max_calls=1)
    intake = search_intake().model_copy(update={"retrieval_only": False})
    result = await planner.plan(planner_input(intake))
    assert result.plan.tasks[0].inputs == {**VALUES, "housing_mode": "search"}
    assert len(model.calls) == planner.last_call_count == 1
    assert set(model.calls[0][1]["available_capabilities"]) == {"property"}


@pytest.mark.asyncio
async def test_invented_filter_is_still_rejected_by_the_full_planner():
    planner = LlmPlanner(Model(plan_draft(must_have=["air_conditioning"])), BASELINE_CAPABILITIES, max_calls=1)
    intake = search_intake().model_copy(update={"retrieval_only": False})
    with pytest.raises(LLMError, match="must_have"):
        await planner.plan(planner_input(intake))


@pytest.mark.asyncio
async def test_new_filter_search_builds_a_valid_fresh_plan_without_llm_calls():
    model = Model()
    planner = LlmPlanner(model, BASELINE_CAPABILITIES)
    result = await planner.plan(planner_input(reserved_task_ids=["property-1"]))
    assert result.plan.tasks[0].inputs == VALUES
    assert result.plan.tasks[0].id != "property-1"
    assert not result.plan.commit_actions
    assert not model.calls and planner.last_call_count == 0


@pytest.mark.parametrize(
    "changes",
    [
        {"retrieval_only": False},
        {"kind": RequestKind.REFINE},
        {"kind": RequestKind.CHANGE},
        {"conflicts": ["Bạn muốn so sánh căn nào?"]},
        {"blocking_missing": ["property.near"]},
        {"commit_requested": ["moving_booking"]},
        {"unavailable_commit_requested": ["moving_booking"]},
        {"target_task_ids": ["old"]},
        {"change_request": "đổi khu vực"},
        {"declined_suggestions": ["old"]},
        {"user_confirmed_facts": {"selected:property": fact("a", "căn a")}},
    ],
)
def test_fast_path_is_explicit_and_fails_closed_for_other_operations(changes):
    assert not is_filter_search(search_intake().model_copy(update=changes))


@pytest.mark.parametrize("mode", ["compare", "search_compare"])
def test_intake_cannot_force_analysis_through_retrieval_by_setting_a_flag(mode):
    intake = search_intake()
    intake.constraints.values.update(housing_mode=mode, listing_ids=["a", "b"])
    assert not is_filter_search(intake)


def test_housing_plus_moving_remains_a_multi_service_mission_even_when_moving_is_blocked():
    intake = search_intake()
    intake.intent.domains.append(AgentName.RELOCATION)
    intake.constraints.missing.append("relocation.from_address")
    assert not is_filter_search(intake)


@pytest.mark.asyncio
async def test_replanning_and_previous_results_keep_the_full_llm_path():
    model = Model(plan_draft())
    planner = LlmPlanner(model, BASELINE_CAPABILITIES)
    old = Plan(version=1, tasks=[Task(id="property-1", agent="property", inputs=VALUES)])
    await planner.plan(planner_input(previous_plan=old))
    assert len(model.calls) == 1


def intake_draft(**changes):
    return IntakeDraft(
        kind="new_goal",
        normalized_goal=MESSAGE,
        intent_name="housing_search",
        domains=[AgentName.PROPERTY],
        requested_actions=[],
        facts=[
            DraftFact(key="near", value="Ocean Park 2", evidence="Ocean Park 2", suggestion_key=None),
            DraftFact(key="max_price_vnd", value=5_000_000, evidence="dưới 5 triệu", suggestion_key=None),
        ],
        unsupported_reason=None,
        drops_previous_goal=False,
        map_origin="none",
        conflicts=[],
        change_request=None,
        target_task_ids=[],
        declined_suggestions=[],
        **changes,
    )


@pytest.mark.asyncio
async def test_intake_wire_schema_excludes_unregistered_roommate_without_an_extra_classifier():
    model = Model(intake_draft(retrieval_only=True))
    result = await LlmIntake(model).understand(
        IntakeInput(
            messages=[HumanMessage(MESSAGE)],
            session=SessionContext(),
            supported_domains=[AgentName.PROPERTY],
        )
    )
    assert len(model.calls) == 1 and result.constraints.values == VALUES and result.retrieval_only
    prompt, data, schema = model.calls[0]
    assert schema is ScalarIntakeDraft
    assert "RoommateSearchCriteria" not in json.dumps(schema.model_json_schema())
    assert "roommate_criteria" not in data["allowed_fact_keys"]
    assert set(data["required_fields"]) == {"property"}
    assert len(prompt) < 5000
    assert len(json.dumps(schema.model_json_schema())) < len(json.dumps(IntakeDraft.model_json_schema())) / 2


@pytest.mark.asyncio
async def test_registered_roommate_keeps_the_typed_criteria_schema():
    model = Model(intake_draft())
    await LlmIntake(model).understand(
        IntakeInput(
            messages=[HumanMessage(MESSAGE)],
            session=SessionContext(),
            supported_domains=[AgentName.PROPERTY, AgentName.ROOMMATE],
        )
    )
    assert model.calls[0][2] is IntakeDraft
    assert "RoommateSearchCriteria" in json.dumps(model.calls[0][2].model_json_schema())


def test_unavailable_second_domain_does_not_turn_a_mixed_request_into_a_fast_search():
    draft = intake_draft(retrieval_only=True)
    draft.domains.append(AgentName.RELOCATION)
    inp = IntakeInput(
        messages=[HumanMessage(MESSAGE)], session=SessionContext(), supported_domains=[AgentName.PROPERTY]
    )
    result, _ = LlmIntake(None)._convert(draft, inp, MESSAGE)
    assert not result.retrieval_only


def test_fast_path_can_be_disabled_without_changing_grounding_or_search_results():
    draft = intake_draft(retrieval_only=True)
    inp = IntakeInput(
        messages=[HumanMessage(MESSAGE)], session=SessionContext(), supported_domains=[AgentName.PROPERTY]
    )
    result, rejected = LlmIntake(None, enable_filter_fast_path=False)._convert(draft, inp, MESSAGE)
    assert not rejected and result.constraints.values == VALUES and not result.retrieval_only


def test_comparison_evidence_disables_the_hint_even_if_the_model_marks_retrieval_only():
    message = "So sánh các căn ở Ocean Park 2"
    draft = intake_draft(retrieval_only=True, housing_comparison_evidence=message)
    inp = IntakeInput(
        messages=[HumanMessage(message)], session=SessionContext(), supported_domains=[AgentName.PROPERTY]
    )
    result, _ = LlmIntake(None)._convert(draft, inp, message)
    assert not result.retrieval_only and result.constraints.values["housing_mode"] == "compare"


def test_all_registered_services_keep_instructions_without_keyword_classification():
    prompt = prompt_for(list(BASELINE_CAPABILITIES))
    for name in ("Housing", "Map", "Moving", "Flight", "Payment", "Roommate"):
        assert name in prompt
    assert len(prompt) < 10_000


class Housing:
    capability = PROPERTY
    client = None

    def __init__(self, status="done"):
        self.requests, self.status = [], status

    async def run(self, req):
        self.requests.append(req)
        kwargs = {"questions": [{"field": "near", "text": "Bạn chọn khu nào?"}]} if self.status == "needs_input" else {}
        return AgentTaskResult(
            task_id=req.task_id,
            plan_version=req.plan_version,
            status=self.status,
            data={
                "candidates": [
                    {
                        "id": "actual-provider-id",
                        "title": "Căn từ provider",
                        "address": "Ocean Park 2",
                        "price_vnd": 4_000_000,
                    }
                ]
            },
            source="lifeflow-location",
            source_kind="live",
            source_refs=["actual-provider-id"],
            fetched_at=utcnow(),
            **kwargs,
        )


def request(**changes):
    return AgentTaskRequest(
        request_id="r",
        thread_id="t",
        task_id="property-1",
        plan_version=1,
        attempt=1,
        agent="property",
        inputs=dict(VALUES),
        retrieval_only=True,
        budget=AgentBudget(max_llm_calls=4, max_provider_calls=6),
        **changes,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["done", "needs_input"])
async def test_property_reuses_the_grounded_tool_without_llm_and_preserves_ambiguity(status):
    adapter = Housing(status)
    agent = ReadLlmAgent("unused-key", "unused-model", adapter)
    # No initialized LLM client; attempting a generation would fail the test.
    req = request()
    result = await agent.run(req)
    assert len(adapter.requests) == 1 and adapter.requests[0].inputs == VALUES
    assert result.status == status and result.usage.llm_calls == 0
    assert result.data["agent_trace"]["tools"] == ["search_housing_and_return"]
    assert result.data["agent_trace"]["implementation"] == "validated-filter-retrieval"
    assert "agent_assessment" not in result.data
    assert agent.llm_client is None
    if status == "needs_input":
        assert result.questions[0].text == "Bạn chọn khu nào?"
    else:
        assert result.data["agent_completion"]["model_assessed"] is False


@pytest.mark.asyncio
async def test_routing_and_request_builder_carry_only_the_validated_retrieval_hint():
    intake = search_intake()
    planned = await LlmPlanner(Model(), BASELINE_CAPABILITIES).plan(planner_input(intake))
    plan = planned.plan
    task = plan.tasks[0]
    sends = route_from_executor(
        {
            "dispatch": [task.id],
            "plan": plan,
            "intake": intake,
            "filter_search_task_ids": planned.retrieval_only_task_ids,
            "messages": [HumanMessage(MESSAGE)],
        }
    )
    req = build_request(PROPERTY, sends[0].arg, AgentPolicy(), utcnow())
    assert req.retrieval_only and req.inputs == VALUES
    intake.intent.domains.append(AgentName.RELOCATION)
    sends = route_from_executor({"dispatch": [task.id], "plan": plan, "intake": intake})
    assert not build_request(PROPERTY, sends[0].arg, AgentPolicy(), utcnow()).retrieval_only


@pytest.mark.asyncio
async def test_graph_uses_one_intake_call_and_no_planning_or_property_generations():
    intake_model = Model(intake_draft(retrieval_only=True))
    unused_planner_model = Model()
    adapter = Housing()
    agent = ReadLlmAgent("unused-key", "unused-model", adapter)
    deps = test_deps(
        intake=LlmIntake(intake_model),
        planner=LlmPlanner(unused_planner_model, BASELINE_CAPABILITIES),
        agents=AgentRegistry({AgentName.PROPERTY: agent}),
    )
    result = await Session(deps).say(MESSAGE)
    assert result["response"].kind == "ANSWER", result.get("outcome")
    assert len(intake_model.calls) == 1 and not unused_planner_model.calls and agent.llm_client is None
    assert len(adapter.requests) == 1 and adapter.requests[0].inputs == VALUES
    counts = await deps.usage.counts("th1", "r1")
    assert counts.llm_calls == 1 and counts.subagent_llm_calls == 0
    assert not result.get("committed") and not result["plan"].commit_actions


@pytest.mark.asyncio
async def test_mixed_housing_and_moving_keeps_missing_moving_questions_and_the_full_planner():
    draft = intake_draft(retrieval_only=False)
    draft.domains.append(AgentName.RELOCATION)
    draft.normalized_goal = MESSAGE + " và báo giá chuyển đồ tới đó"
    intake_model, planner_model = Model(draft), Model(plan_draft(housing_mode="search"))

    class Responses:
        calls = 0

        async def create(self, **_):
            self.calls += 1
            return SimpleNamespace(
                status="completed",
                usage=None,
                output=[
                    SimpleNamespace(
                        type="function_call",
                        name="search_housing_and_return",
                        arguments='{"limit":null}',
                        call_id="c",
                    )
                ],
            )

    from relohome_agent.agents.deps import fake_registry

    agent = ReadLlmAgent("unused-key", "unused-model", Housing())
    responses = Responses()
    agent.llm_client = SimpleNamespace(responses=responses)
    registry = fake_registry()
    agents = {name: registry.get(name) for name in registry.names()}
    agents[AgentName.PROPERTY] = agent
    deps = test_deps(
        intake=LlmIntake(intake_model),
        planner=LlmPlanner(planner_model, BASELINE_CAPABILITIES),
        agents=AgentRegistry(agents),
    )
    result = await Session(deps).say(draft.normalized_goal)
    assert AgentName.RELOCATION in result["intake"].domains
    assert result["response"].kind == "CLARIFY"
    assert any(q.field.startswith("relocation.") for q in result["response"].questions)
    assert len(planner_model.calls) == responses.calls == 1
    assert set(planner_model.calls[0][1]["available_capabilities"]) == {"property", "relocation"}
    assert not result.get("committed")


@pytest.mark.asyncio
async def test_normal_property_reasoning_keeps_its_llm_when_the_hint_is_absent():
    class Responses:
        calls = 0

        async def create(self, **_):
            self.calls += 1
            return SimpleNamespace(
                status="completed",
                usage=None,
                output=[
                    SimpleNamespace(
                        type="function_call",
                        name="search_housing_and_return",
                        arguments='{"limit":null}',
                        call_id="c",
                    )
                ],
            )

    adapter = Housing()
    agent = ReadLlmAgent("unused-key", "unused-model", adapter)
    responses = Responses()
    agent.llm_client = SimpleNamespace(responses=responses)
    result = await agent.run(request().model_copy(update={"retrieval_only": False}))
    assert result.status == "done" and result.usage.llm_calls == responses.calls == 1
    assert result.data["agent_trace"]["implementation"] == "llm-tool-loop"


@pytest.mark.asyncio
async def test_fast_tool_still_counts_provider_calls_and_honors_the_provider_budget():
    class Provider:
        calls = 0

        async def call(self, name, args):
            self.calls += 1
            return {"rows": []}

    class Adapter(Housing):
        async def run(self, req):
            await self.client.call("search_housing", req.inputs)
            return await super().run(req)

    provider = Provider()
    adapter = Adapter()
    adapter.client = provider
    agent = ReadLlmAgent("unused-key", "unused-model", adapter)
    result = await agent.run(request())
    assert result.status == "done" and result.usage.provider_calls == provider.calls == 1
    assert result.usage.llm_calls == 0
    blocked = await agent.run(
        request().model_copy(update={"budget": AgentBudget(max_llm_calls=4, max_provider_calls=0)})
    )
    assert blocked.status == "failed" and provider.calls == 1
