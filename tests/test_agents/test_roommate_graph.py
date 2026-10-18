import json

import pytest
from relohome_agent.agents.intake import FixedIntake
from relohome_agent.agents.models import AgentName, RequestKind, TaskStatus
from relohome_agent.agents.planner_llm import LlmPlanner, PlanDraft, TaskDraft
from relohome_agent.agents.planning import PlannerInput, TemplatePlanner, validate_plan
from relohome_agent.agents.progress import plan_progress
from relohome_agent.agents.subagents.capabilities import BASELINE_CAPABILITIES
from relohome_agent.agents.wiring import AgentService
from relohome_agent.config import Settings

from tests.test_agents.helpers import Session, intake_result
from tests.test_roommate.test_discovery_api import make_app


@pytest.mark.asyncio
async def test_roommate_opens_eligibility_entry_without_payment_or_llm(tmp_path):
    _, runtime = make_app(tmp_path)
    intake = intake_result(RequestKind.NEW_GOAL, [AgentName.ROOMMATE])
    service = AgentService.create(
        intake=FixedIntake(intake),
        roommate_runtime=runtime,
        services=Settings(_env_file=None, agent_subagents="fake"),
    )
    session = Session(service.deps)
    out = await session.say("Tôi muốn tìm người ở cùng")
    assert out["response"].kind == "ANSWER", (out["response"], out.get("validation"), out.get("task_results"))
    assert out["plan"].commit_actions == []
    task = out["plan"].tasks[0]
    assert task.agent == AgentName.ROOMMATE and task.depends_on == []
    assert out["task_status"][task.id] == TaskStatus.DONE
    result = out["task_results"][task.id]
    assert result.data["availability"] == "eligibility_required"
    assert result.usage.llm_calls == 0
    assert "đăng nhập" in out["response"].text.lower()
    progress = plan_progress(out)
    assert progress["items"][0]["roommate_availability"] == "eligibility_required"
    assert progress["totals"]["one_time_vnd"] == 0


@pytest.mark.asyncio
async def test_mixed_plan_keeps_domains_independent_and_scoped(tmp_path):
    _, runtime = make_app(tmp_path)
    intake = intake_result(
        domains=[AgentName.PROPERTY, AgentName.ROOMMATE],
        values={"city": "Hà Nội", "roommate_criteria": {"city": "hcm"}},
    )
    service = AgentService.create(
        roommate_runtime=runtime, services=Settings(_env_file=None, agent_subagents="fake")
    )
    out = await TemplatePlanner().plan(
        PlannerInput(intake=intake, session={}, available_agents=service.deps.agents.names())
    )
    assert validate_plan(out.plan, service.deps.agents, intake, {}) == []
    tasks = {task.agent: task for task in out.plan.tasks}
    assert tasks[AgentName.PROPERTY].inputs["city"] == "Hà Nội"
    assert tasks[AgentName.ROOMMATE].inputs == {"roommate_criteria": {"city": "hcm"}}
    assert tasks[AgentName.ROOMMATE].depends_on == [] and not out.plan.commit_actions


@pytest.mark.asyncio
@pytest.mark.parametrize("criteria", [None, {"city": "hcm"}])
async def test_llm_planner_supports_grounded_roommate_without_per_candidate_calls(criteria):
    inputs = {"roommate_criteria": criteria} if criteria else {}
    draft = PlanDraft(
        tasks=[
            TaskDraft(id="r1", agent=AgentName.ROOMMATE, inputs_json=json.dumps(inputs), depends_on=[], required=True)
        ],
        actions=[],
    )

    class Model:
        last_usage = (0, 0)
        calls = 0

        async def parse(self, prompt, data, schema):
            self.calls += 1
            assert "roommate" in data["available_capabilities"]
            return draft

    model = Model()
    planner = LlmPlanner(model, BASELINE_CAPABILITIES)
    inp = PlannerInput(
        intake=intake_result(domains=[AgentName.ROOMMATE], values=inputs),
        session={},
        available_agents=[AgentName.ROOMMATE],
    )
    result = await planner.plan(inp)
    assert result.plan.tasks[0].inputs == inputs and result.plan.commit_actions == []
    assert model.calls == 1
