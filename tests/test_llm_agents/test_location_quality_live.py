"""Actual PostGIS/MCP records and Moving pin logic; no LLM calls or fake data."""

import os
import subprocess

import pytest
from relohome_agent.agents.contracts import AgentTaskRequest
from relohome_agent.agents.llm_runtime import Invocation
from relohome_agent.agents.models import AgentBudget, AgentName
from relohome_agent.agents.subagents.services.location import MIN_SUGGESTION_SCORE, LocationSubagent, to_candidate
from relohome_agent.agents.subagents.services.moving_llm import MovingExecution, MovingLlmAgent
from relohome_agent.services.adapters.mcp import McpEndpoint, McpToolClient
from relohome_agent.services.adapters.registry import LOCATION_READ_TOOLS

from tests import live

pytestmark = pytest.mark.skipif(os.getenv("RUN_LIVE_INTEGRATION") != "1", reason="Real PostGIS/MCP opt-in")


def listing_id(condition):
    query = (
        "SELECT id::text FROM housing.listings WHERE status='active' AND deleted_at IS NULL AND "
        + condition
        + " LIMIT 1"
    )
    read = subprocess.run(
        [
            "docker",
            "exec",
            "lifeflow-integration-postgis-1",
            "sh",
            "-c",
            # The container's own admin user; the application database is a test option.
            'psql -U "$POSTGRES_USER" -d "$1" -At -c "$2"',
            "psql",
            live.location_db_name(),
            query,
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    identifier = read.stdout.strip()
    if not identifier:
        pytest.skip("Snapshot has no matching live record")
    return identifier


def location():
    return McpToolClient(
        McpEndpoint(
            service="location",
            allowed_tools=LOCATION_READ_TOOLS,
            url=live.mcp_url("location"),
            token=live.mcp_token("location"),
            timeout_s=20,
        )
    )


@pytest.mark.asyncio
async def test_source_quality_flag_survives_mcp_and_conversion():
    identifier = listing_id("attributes->'quality'->'flags' @> '[{\"code\": \"price_outlier_low\"}]'::jsonb")
    row = await location().call("get_housing", {"listing_id": identifier})
    assert "price_outlier_low" in row["quality_flags"]
    candidate, _ = to_candidate(row, [])
    assert candidate["price_unverified"] and candidate["id"] == identifier


@pytest.mark.asyncio
async def test_approximate_house_offers_pin_but_never_automatic_pickup():
    identifier = listing_id("attributes->>'location_accuracy' = 'approximate'")
    req = AgentTaskRequest(
        request_id="pin-" + identifier,
        thread_id="live-pin-audit",
        task_id="moving",
        plan_version=1,
        attempt=1,
        agent=AgentName.RELOCATION,
        inputs={"mode": "quote", "selected_listing_id": identifier},
        budget=AgentBudget(max_llm_calls=0, max_provider_calls=2),
    )
    agent = MovingLlmAgent("", "gpt-6-luna", moving=None, location=location())
    execution = MovingExecution(agent, req, Invocation(max_calls=0))
    assert await execution.endpoint("selected:property") is None
    question = execution.location_question("to_address", "selected:property")
    assert len(question.choices) == 1 and question.choices[0].id == identifier
    assert "selected:property" not in question.text
    assert execution.run.usage.llm_calls == 0


@pytest.mark.asyncio
async def test_strong_fuzzy_landmark_offers_explicit_choices_not_auto_coordinates():
    text = "trường đại học bách khoa thành phố Hồ Chí Minh"
    client = location()
    observed = (await client.call("resolve_location", {"text": text, "limit": 5}))["results"]
    allowed = {r["canonical_id"] for r in observed if r["match_score"] >= MIN_SUGGESTION_SCORE}
    assert allowed, "Live snapshot must contain a strong match for this regression"
    agent = LocationSubagent(client=client, agent=AgentName.PROPERTY)
    req = AgentTaskRequest(
        request_id="live-natural-landmark",
        thread_id="live-landmark-audit",
        task_id="property",
        plan_version=1,
        attempt=1,
        agent=AgentName.PROPERTY,
        inputs={"near": text, "max_price_vnd": 5_000_000},
        budget=AgentBudget(max_llm_calls=0, max_provider_calls=2),
    )
    result = await agent.run(req)
    assert result.status == "needs_input" and not result.data.get("candidates")
    assert result.questions[0].choices
    assert {c.id for c in result.questions[0].choices} <= allowed
    assert result.usage.llm_calls == 0


@pytest.mark.asyncio
async def test_weak_landmark_matches_are_not_presented_as_valid_map_choices():
    agent = LocationSubagent(client=location(), agent=AgentName.MAP)
    req = AgentTaskRequest(
        request_id="live-weak-landmark",
        thread_id="live-landmark-audit",
        task_id="map",
        plan_version=1,
        attempt=1,
        agent=AgentName.MAP,
        inputs={"map_mode": "nearby", "near": "Bưu điện Trung tâm Sài Gòn", "categories": ["hospital"]},
        budget=AgentBudget(max_llm_calls=0, max_provider_calls=2),
    )
    result = await agent.run(req)
    assert result.status == "needs_input" and not result.data.get("nearby")
    assert result.questions and not result.questions[0].choices
    assert result.usage.llm_calls == 0
