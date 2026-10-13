import pytest
from relohome_agent.agents.deps import fake_registry
from relohome_agent.agents.models import AgentName
from relohome_agent.agents.subagents.capabilities import BASELINE_CAPABILITIES
from relohome_agent.agents.subagents.conformance import check_conformance, sample_request


@pytest.mark.asyncio
async def test_roommate_capability_is_read_only_and_fake_fixture_safe():
    name = AgentName.ROOMMATE
    capability = BASELINE_CAPABILITIES[name]
    assert not capability.uses_llm and capability.commit_kinds == []
    assert capability.default_budget.max_llm_calls == 0
    registry = fake_registry()
    agent = registry.get(name)
    assert await check_conformance(agent, [sample_request(name, {})]) == []
    result = await agent.run(sample_request(name, {}))
    assert result.quotes == [] and result.source_kind == "fake"
    assert result.data["profile_refs"] == []
