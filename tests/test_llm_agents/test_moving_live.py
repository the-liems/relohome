"""Opt-in real OpenAI -> real HTTP MCP -> real AhaMove staging. No writes or mocks."""

import asyncio
import json
import os
import secrets
import socket
import subprocess
from datetime import timedelta
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio
from relohome_agent.agents.common import utcnow
from relohome_agent.agents.contracts import AgentTaskRequest
from relohome_agent.agents.models import AgentBudget, AgentName
from relohome_agent.agents.subagents.conformance import _result_problems
from relohome_agent.agents.subagents.services.moving import QuoteContact
from relohome_agent.agents.subagents.services.moving_llm import MovingLlmAgent
from relohome_agent.services.adapters.mcp import McpEndpoint, McpToolClient
from relohome_agent.services.adapters.registry import MOVING_READ_TOOLS

from tests import live

ROOT = Path(__file__).resolve().parents[2]
pytestmark = [
    pytest.mark.asyncio,
    pytest.mark.skipif(os.getenv("RUN_LIVE_MOVING_AGENT") != "1", reason="Live isolated database runner required"),
]


def request(inputs, **kwargs):
    return AgentTaskRequest(
        request_id=str(uuid4()),
        thread_id=str(uuid4()),
        task_id="moving",
        plan_version=1,
        attempt=1,
        agent=AgentName.RELOCATION,
        inputs=inputs,
        budget=AgentBudget(max_llm_calls=8, max_provider_calls=8),
        **kwargs,
    )


@pytest_asyncio.fixture
async def moving():
    # The native runner owns the isolated database and passes it as an option.
    database_url = live.moving_database_url()
    key = live.env_test("OPENAI_API_KEY")
    contact_name = live.env_test("MOVING_QUOTE_CONTACT_NAME", required=False)
    contact_mobile = live.env_test("MOVING_QUOTE_CONTACT_MOBILE", required=False)
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    token = secrets.token_urlsafe(32)
    env = {
        **os.environ,
        "MOVING_DATABASE_URL": database_url,
        "AHAMOVE_API_KEY": live.env_test("AHAMOVE_API_KEY", required=False),
        "AHAMOVE_MOBILE": live.env_test("AHAMOVE_MOBILE", required=False),
        "AHAMOVE_USER_TOKEN": live.env_test("AHAMOVE_USER_TOKEN", required=False),
        "MOVING_MCP_PORT": str(port),
        "MOVING_MCP_HOST": "127.0.0.1",
        "MOVING_MCP_AUTH_TOKEN": token,
        "MOVING_MCP_WRITE_TOKEN": "",
        "AHAMOVE_WRITE_ENABLED": "false",
        "AHAMOVE_ENV": "staging",
    }
    process = subprocess.Popen(
        ["node", "apps/moving-mcp/dist/http-server.js"],
        cwd=ROOT,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    agent = MovingLlmAgent(
        key,
        live.env_test("AGENT_MOVING_MODEL", required=False) or "gpt-4.1-mini",
        McpToolClient(McpEndpoint("moving", MOVING_READ_TOOLS, url=f"http://127.0.0.1:{port}/mcp", token=token)),
        contact=QuoteContact(contact_name, contact_mobile) if contact_name and contact_mobile else None,
    )
    try:
        async with httpx.AsyncClient() as http:
            for _ in range(80):
                assert process.poll() is None, "Real Moving server failed to start; inspect configuration."
                try:
                    if (await http.get(f"http://127.0.0.1:{port}/health")).is_success:
                        break
                except httpx.TransportError:
                    pass
                await asyncio.sleep(0.25)
            else:
                pytest.fail("Real Moving MCP did not become healthy")
        yield agent
    finally:
        await agent.close()
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=10)


async def test_real_llm_catalog_and_services(moving):
    areas = await moving.run(request({"mode": "catalog"}))
    assert areas.status == "done", areas.model_dump_json()
    assert areas.data["cities"] and areas.source_kind == "sandbox"
    assert areas.usage.llm_calls >= 2 and areas.usage.provider_calls >= 1
    city = areas.data["cities"][0]["city_id"]
    services = await moving.run(request({"mode": "catalog", "city_id": city}))
    assert services.status == "done", services.model_dump_json()
    assert services.data["services"], "Agent must complete requested city catalog, not just list areas"
    assert services.source_refs and services.usage.tokens_in > 0


async def test_no_write_tools_and_contract_rejection(moving):
    assert not any(
        n in moving.moving.endpoint.allowed_tools
        for n in ("create_move_order", "cancel_move_order", "update_move_order")
    )
    result = await moving.run(request({"mode": "catalog"}, contract_version="99.0"))
    assert result.status == "failed" and result.error.code == "unsupported_contract"
    assert result.usage.llm_calls == result.usage.provider_calls == 0


async def test_budget_is_enforced_without_provider_call(moving):
    req = request({"mode": "catalog"})
    req.budget.max_llm_calls = 0
    result = await moving.run(req)
    assert result.status == "failed" and result.error.code == "budget_exceeded"
    assert result.usage.provider_calls == 0


async def test_real_llm_quote_with_approved_route(moving):
    assert moving.contact is not None, "A real configured quote contact is required"
    inputs = json.loads(live.env_test("MOVING_LIVE_QUOTE_INPUTS"))
    inputs.update(mode="quote", move_date=(utcnow() + timedelta(days=2)).date().isoformat(), move_time="10:00")
    req = request(inputs)
    result = await moving.run(req)
    assert result.status == "done", result.model_dump_json()
    assert result.data["quote_id"] and result.data["expires_at"] and result.quotes
    assert result.usage.llm_calls >= 4 and result.usage.provider_calls >= 2
    assert all(q.amount_vnd > 0 for q in result.quotes)
    assert all(item["movers"] is None for item in result.data["quotes"])
    assert all("fee_breakdown" in item and "distance_km" in item for item in result.data["quotes"])
    assert moving.contact.mobile not in result.model_dump_json()
    assert _result_problems(moving, req, result) == []
