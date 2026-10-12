"""Actual PostGIS/MCP records and Moving pin logic; no LLM calls or fake data."""

import importlib.util
import os
import subprocess
from pathlib import Path

import pytest
from relohome_agent.agents.contracts import AgentTaskRequest
from relohome_agent.agents.llm_runtime import Invocation
from relohome_agent.agents.models import AgentBudget, AgentName
from relohome_agent.agents.subagents.services.location import MIN_SUGGESTION_SCORE, LocationSubagent, to_candidate
from relohome_agent.agents.subagents.services.moving_llm import MovingExecution, MovingLlmAgent
from relohome_agent.services.adapters.mcp import McpEndpoint, McpToolClient
from relohome_agent.services.adapters.registry import LOCATION_READ_TOOLS

pytestmark = pytest.mark.skipif(os.getenv("RUN_LIVE_INTEGRATION") != "1", reason="Real PostGIS/MCP opt-in")
ROOT = Path(__file__).resolve().parents[2]


def environment():
    spec = importlib.util.spec_from_file_location("local_runner", ROOT / "scripts/local-integration.py")
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    return runner.environment("api")


def listing_id(env, condition):
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
            "psql",
            "-U",
            env["POSTGRES_ADMIN_USER"],
            "-d",
            env["POSTGRES_DB"],
            "-At",
            "-c",
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


def location(env):
    return McpToolClient(
        McpEndpoint(
            service="location",
            allowed_tools=LOCATION_READ_TOOLS,
            url=env["LOCATION_MCP_URL"],
            token=env["LOCATION_MCP_AUTH_TOKEN"],
            timeout_s=20,
        )
    )


@pytest.mark.asyncio
async def test_source_quality_flag_survives_mcp_and_conversion():
    env = environment()
    identifier = listing_id(env, "attributes->'quality'->'flags' @> '[{\"code\": \"price_outlier_low\"}]'::jsonb")
    row = await location(env).call("get_housing", {"listing_id": identifier})
    assert "price_outlier_low" in row["quality_flags"]
    candidate, _ = to_candidate(row, [])
    assert candidate["price_unverified"] and candidate["id"] == identifier


@pytest.mark.asyncio
async def test_approximate_house_offers_pin_but_never_automatic_pickup():
    env = environment()
    identifier = listing_id(env, "attributes->>'location_accuracy' = 'approximate'")
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
    agent = MovingLlmAgent("", "gpt-6-luna", moving=None, location=location(env))
    execution = MovingExecution(agent, req, Invocation(max_calls=0))
    assert await execution.endpoint("selected:property") is None
    question = execution.location_question("to_address", "selected:property")
    assert len(question.choices) == 1 and question.choices[0].id == identifier
    assert "selected:property" not in question.text
    assert execution.run.usage.llm_calls == 0


@pytest.mark.asyncio
async def test_strong_fuzzy_landmark_offers_explicit_choices_not_auto_coordinates():
    env = environment()
    text = "trường đại học bách khoa thành phố Hồ Chí Minh"
    client = location(env)
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
    agent = LocationSubagent(client=location(environment()), agent=AgentName.MAP)
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
