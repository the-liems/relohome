import pytest
from relohome_agent.agents.models import AgentName
from relohome_agent.agents.subagents.conformance import check_conformance, sample_request
from relohome_agent.agents.subagents.services.payment import ACTOR_ID
from relohome_agent.agents.subagents.services.roommate import RoommateSubagent
from relohome_agent.agents.wiring import AgentService
from relohome_roommate.ports import Actor
from relohome_roommate.services.access import AccessService
from relohome_roommate.services.profiles import ProfileService

from tests.test_roommate.test_discovery_api import make_app
from tests.test_roommate.test_profile_lifecycle import complete


@pytest.mark.asyncio
async def test_runtime_uses_trusted_actor_and_references_only(tmp_path):
    _, runtime = make_app(tmp_path)
    with runtime.context() as ctx:
        for name in ("viewer", "candidate"):
            AccessService(ctx).accept(Actor(id=name), True, "roommate-1.0")
        profiles = ProfileService(ctx)
        profiles.save(Actor(id="candidate"), complete(), None)
        profiles.transition(Actor(id="candidate"), "publish", 1, reviewed=True)
    agent = RoommateSubagent(runtime)
    req = sample_request(AgentName.ROOMMATE, {"roommate_criteria": {"city": "hcm"}})
    assert (await agent.run(req)).data["availability"] == "eligibility_required"
    token = ACTOR_ID.set("viewer")
    try:
        assert await check_conformance(agent, [req]) == []
        result = await agent.run(req)
        assert result.data["profile_refs"] == [{"profile_id": "candidate"}]
        assert result.usage.llm_calls == result.usage.provider_calls == 0
        assert result.quotes == [] and result.source_kind == "live"
        assert "introduction" not in result.model_dump_json()
        req.inputs["actor_id"] = "candidate"
        assert (await agent.run(req)).error.code == "invalid_input"
    finally:
        ACTOR_ID.reset(token)


@pytest.mark.asyncio
async def test_disabled_entry_and_explicit_runtime_injection(tmp_path):
    result = await RoommateSubagent(None).run(sample_request(AgentName.ROOMMATE, {}))
    assert result.data["availability"] == "disabled" and result.data["profile_refs"] == []
    _, runtime = make_app(tmp_path)
    service = AgentService.create(roommate_runtime=runtime)
    agent = service.deps.agents.get(AgentName.ROOMMATE)
    assert isinstance(agent, RoommateSubagent) and agent.runtime is runtime
    assert not agent.capability.uses_llm and not agent.capability.commit_kinds
