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
from dotenv import load_dotenv

from src.agents.common import utcnow
from src.agents.contracts import AgentTaskRequest
from src.agents.models import AgentBudget, AgentName
from src.agents.subagents.conformance import _result_problems
from src.agents.subagents.services.moving import QuoteContact
from src.agents.subagents.services.moving_llm import MovingLlmAgent
from src.services.adapters.mcp import McpEndpoint, McpToolClient
from src.services.adapters.registry import MOVING_READ_TOOLS

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env.local")
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
    assert os.environ.get("MOVING_TEST_ISOLATED_DB") == "1"
    assert os.environ.get("OPENAI_API_KEY")
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    token = secrets.token_urlsafe(32)
    env = {
        **os.environ,
        "MOVING_MCP_PORT": str(port),
        "MOVING_MCP_HOST": "127.0.0.1",
        "MOVING_MCP_AUTH_TOKEN": token,
        "MOVING_MCP_WRITE_TOKEN": "",
        "AHAMOVE_WRITE_ENABLED": "false",
        "AHAMOVE_ENV": "staging",
    }
    process = subprocess.Popen(
        ["node", "moving-mcp-server/dist/http-server.js"],
        cwd=ROOT / "Maps VN/LifeFlow",
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    agent = MovingLlmAgent(
        os.environ["OPENAI_API_KEY"],
        os.getenv("AGENT_MOVING_MODEL", "gpt-4.1-mini"),
        McpToolClient(McpEndpoint("moving", MOVING_READ_TOOLS, url=f"http://127.0.0.1:{port}/mcp", token=token)),
        contact=QuoteContact(os.environ["MOVING_QUOTE_CONTACT_NAME"], os.environ["MOVING_QUOTE_CONTACT_MOBILE"])
        if os.getenv("MOVING_QUOTE_CONTACT_MOBILE") and os.getenv("MOVING_QUOTE_CONTACT_NAME")
        else None,
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


@pytest.mark.skipif(not os.getenv("MOVING_LIVE_QUOTE_INPUTS"), reason="Operator-approved real route required")
async def test_real_llm_quote_with_approved_route(moving):
    assert moving.contact is not None, "A real configured quote contact is required"
    inputs = json.loads(os.environ["MOVING_LIVE_QUOTE_INPUTS"])
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
