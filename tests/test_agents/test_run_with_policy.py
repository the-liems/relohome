"""Wrapper run_with_policy, trần chi phí và gợi ý bước tiếp theo (agent-graph.md §6.3.6, §7.5, §6.10)."""

import asyncio

import pytest
from relohome_agent.agents.common import utcnow
from relohome_agent.agents.contracts import AgentTaskResult
from relohome_agent.agents.deps import AgentRegistry, GraphSettings, fake_registry, test_deps
from relohome_agent.agents.intake import ScriptedIntake
from relohome_agent.agents.models import AgentName, Constraints, Question, RequestKind, Task, TaskStatus
from relohome_agent.agents.planning import TemplatePlanner
from relohome_agent.agents.subagents.base import AgentPolicy, AgentTransportError, run_with_policy
from relohome_agent.agents.subagents.fake import FakeAgent

from tests.test_agents.helpers import Session, fact, intake_result


def agent_input(**constraints):
    return {
        "task": Task(id="t1", agent=AgentName.PROPERTY, inputs={"city": "Hồ Chí Minh"}),
        "plan_version": 3,
        "attempt": 1,
        "request_id": "r",
        "thread_id": "th",
        "constraints": Constraints(values={"city": "Hồ Chí Minh", "secret_note": "x", **constraints}),
        "hints": {"origin": "Hà Nội"},
        "upstream": {},
    }


async def run(agent, policy=None):
    return await run_with_policy(agent, agent_input(), policy=policy or AgentPolicy(timeout_s=1), clock=utcnow)


@pytest.mark.asyncio
async def test_filters_constraints_and_hints_by_manifest():
    agent = FakeAgent(AgentName.PROPERTY)
    out = await run(agent)
    req = agent.requests[0]
    assert req.constraints == {"city": "Hồ Chí Minh"}  # chỉ key có trong constraint_keys
    assert req.hints == {}
    assert req.budget.deadline_at is not None
    assert out["task_status"] == {"t1": TaskStatus.DONE}


@pytest.mark.asyncio
async def test_transport_error_retried_once_only():
    calls = []

    def responder(req):
        calls.append(1)
        raise AgentTransportError("down")

    out = await run(FakeAgent(AgentName.PROPERTY, responder=responder))
    assert len(calls) == 2
    assert out["task_results"]["t1"].error_code == "provider_unavailable"
    assert out["task_results"]["t1"].retryable is True


@pytest.mark.asyncio
async def test_timeout_and_crash_become_data():
    async def slow(req):
        await asyncio.sleep(5)

    class Slow(FakeAgent):
        async def run(self, req):
            return await slow(req)

    out = await run(Slow(AgentName.PROPERTY), AgentPolicy(timeout_s=0.01, grace_s=0.01))
    assert out["task_results"]["t1"].error_code == "timeout"

    def boom(req):
        raise ValueError("bug")

    out = await run(FakeAgent(AgentName.PROPERTY, responder=boom))
    assert out["task_results"]["t1"].error_code == "internal"


@pytest.mark.asyncio
async def test_result_for_other_task_or_major_version_is_rejected():
    def wrong_task(req):
        return AgentTaskResult(
            task_id="other",
            plan_version=req.plan_version,
            status="done",
            source="x",
            source_kind="fake",
            fetched_at=utcnow(),
        )

    out = await run(FakeAgent(AgentName.PROPERTY, responder=wrong_task))
    assert out["task_status"]["t1"] == TaskStatus.FAILED

    def wrong_major(req):
        return AgentTaskResult(
            contract_version="2.0",
            task_id=req.task_id,
            plan_version=req.plan_version,
            status="done",
            source="x",
            source_kind="fake",
            fetched_at=utcnow(),
        )

    out = await run(FakeAgent(AgentName.PROPERTY, responder=wrong_major))
    assert out["task_results"]["t1"].error_code == "unsupported_contract"


@pytest.mark.asyncio
async def test_needs_input_maps_to_status():
    def ask(req):
        return {"status": "needs_input", "questions": [Question(field="near", text="Ở đâu?")]}

    out = await run(FakeAgent(AgentName.PROPERTY, responder=ask))
    assert out["task_status"]["t1"] == TaskStatus.NEEDS_INPUT



@pytest.mark.asyncio
async def test_paid_cap_gives_partial_answer():
    intake = intake_result(
        RequestKind.NEW_GOAL,
        [AgentName.PROPERTY, AgentName.FLIGHT],
        values={"city": "Hồ Chí Minh", "origin": "HAN", "flight_date": "2026-11-15"},
    )
    deps = test_deps(ScriptedIntake([intake]), TemplatePlanner(), settings=GraphSettings(max_paid_calls_per_turn=0))
    out = await Session(deps).say("Tìm phòng và vé")
    assert out["response"].kind == "PARTIAL"
    assert "giới hạn chi phí" in out["response"].text
    assert deps.agents.get(AgentName.FLIGHT).requests == []
    assert out["task_status"]["t1"] == TaskStatus.DONE


@pytest.mark.asyncio
async def test_suggestions_skip_declined_and_unsupported():
    search = intake_result(RequestKind.NEW_GOAL, [AgentName.PROPERTY], values={"city": "Hồ Chí Minh"})
    chosen = {"selected:property": fact("p1", "Phòng số 1")}
    choose = intake_result(RequestKind.REFINE, [AgentName.PROPERTY], values={"city": "Hồ Chí Minh"}, facts=chosen)
    decline = intake_result(
        RequestKind.REFINE,
        [AgentName.PROPERTY],
        values={"city": "Hồ Chí Minh"},
        facts=chosen,
        declined_suggestions=["quote:relocation"],
    )
    deps = test_deps(ScriptedIntake([search, choose, decline]), TemplatePlanner())
    s = Session(deps)
    out = await s.say("Tìm phòng ở Hồ Chí Minh")
    assert out["response"].suggestions == []  # nothing chosen yet
    out = await s.say("Phòng số 1")
    assert "quote:relocation" in [x.key for x in out["response"].suggestions]
    out = await s.say("không cần chuyển đồ, mình tự chở")
    assert "quote:relocation" not in [x.key for x in out["response"].suggestions]
    # Không có service moving thì không gợi ý báo giá chuyển đồ.
    registry = AgentRegistry({n: a for n, a in fake_registry()._agents.items() if n != AgentName.RELOCATION})
    deps = test_deps(ScriptedIntake([search]), TemplatePlanner(), agents=registry)
    out = await Session(deps).say("Tìm phòng ở Hồ Chí Minh")
    assert out["response"].suggestions == []


@pytest.mark.asyncio
async def test_llm_cap_stops_before_calling_intake():
    class LlmIntake(ScriptedIntake):
        uses_llm = True

    intake = LlmIntake([intake_result(RequestKind.NEW_GOAL, [AgentName.PROPERTY], values={"city": "Hồ Chí Minh"})])
    deps = test_deps(intake, TemplatePlanner(), settings=GraphSettings(max_llm_calls_per_turn=0))
    out = await Session(deps).say("Tìm phòng ở Hồ Chí Minh")
    assert out["response"].kind == "ERROR" and "giới hạn chi phí" in out["response"].text
    assert intake.inputs == []
