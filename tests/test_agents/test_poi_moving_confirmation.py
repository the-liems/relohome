"""Explicit fixtures for pin confirmation after POI dedup; no LLM or provider calls."""

from types import SimpleNamespace

import pytest
from relohome_agent.agents.contracts import AgentTaskRequest
from relohome_agent.agents.llm_runtime import Invocation
from relohome_agent.agents.models import AgentBudget, AgentName
from relohome_agent.agents.subagents.services.moving_llm import MovingExecution


class FixtureLocation:
    endpoint = SimpleNamespace(service="location")

    def __init__(self):
        self.calls = 0

    async def call(self, name, args):
        self.calls += 1
        assert name == "resolve_location"
        return {"results": [{
            "entity_type": "place", "canonical_id": "canonical-campus", "name": "Bách Khoa",
            "display_name": "Bách Khoa · Trường đại học · Hà Nội", "category": "university",
            "match_type": "exact", "location": {"lat": 21.0, "lng": 105.84},
        }]}


@pytest.mark.asyncio
async def test_one_exact_poi_requires_pin_confirmation_but_confirmed_coordinates_are_preserved():
    location = FixtureLocation()
    req = AgentTaskRequest(
        request_id="poi-fixture", thread_id="fixture", task_id="moving", plan_version=1,
        attempt=1, agent=AgentName.RELOCATION, inputs={"mode": "quote"},
        budget=AgentBudget(max_llm_calls=0, max_provider_calls=2),
    )
    execution = MovingExecution(SimpleNamespace(location=location, moving=None), req, Invocation(max_calls=0))
    assert await execution.point("Bách Khoa", None) is None
    question = execution.location_question("from_address", "Bách Khoa")
    assert question.choices[0].label == "Bách Khoa · Trường đại học · Hà Nội"
    assert question.choices[0].id == "canonical-campus"
    confirmed = {"lat": 21.001, "lng": 105.841}
    assert await execution.point("Cổng đã xác nhận", confirmed) == {"address": "Cổng đã xác nhận", **confirmed}
    assert location.calls == 1
    assert execution.run.usage.llm_calls == 0
