"""Context and batching checks using an actual saved conversation + real MCP.

No fabricated listings, model responses or clients. These tests add zero paid
LLM calls. Supply RUN_CONTEXT_RUNTIME and RUN_CONTEXT_THREAD from a live run.
"""

import asyncio
import copy
import json
import os
import uuid
from pathlib import Path

import pytest
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from relohome_agent.agents.contracts import AgentTaskRequest
from relohome_agent.agents.graph import checkpoint_serde
from relohome_agent.agents.llm_context import PRESENTATION_KEYS, result_context
from relohome_agent.agents.llm_runtime import public_data
from relohome_agent.agents.models import AgentBudget, AgentName
from relohome_agent.agents.subagents.services.domain_tools import DomainToolSession
from relohome_agent.agents.subagents.services.location import LocationSubagent
from relohome_agent.services.adapters.mcp import McpEndpoint, McpToolClient
from relohome_agent.services.adapters.registry import LOCATION_READ_TOOLS

from tests import live

pytestmark = pytest.mark.skipif(os.getenv("RUN_LIVE_INTEGRATION") != "1", reason="Actual provider/checkpoint opt-in")


@pytest.fixture(scope="module")
def checkpoint():
    directory, thread = os.getenv("RUN_CONTEXT_RUNTIME"), os.getenv("RUN_CONTEXT_THREAD")
    if not directory or not thread:
        pytest.skip("An actual conversation is required; never fabricate history")

    async def read():
        async with AsyncSqliteSaver.from_conn_string(str(Path(directory) / "checkpoints.sqlite3")) as saver:
            saver.serde = checkpoint_serde()
            actual = await saver.aget_tuple({"configurable": {"thread_id": thread}})
            assert actual is not None
            return actual.checkpoint["channel_values"]

    return asyncio.run(read())


def test_real_projection_keeps_decision_facts_and_does_not_mutate_state(checkpoint):
    def compare(original, projected):
        if isinstance(original, dict):
            assert set(projected) == set(original) - PRESENTATION_KEYS
            for key in projected:
                compare(original[key], projected[key])
        elif isinstance(original, list):
            assert len(original) == len(projected), "Do not truncate options or unknown fields"
            for first, second in zip(original, projected, strict=True):
                compare(first, second)
        else:
            assert original == projected

    for result in checkpoint["task_results"].values():
        before = copy.deepcopy(result.data)
        projected = result_context(result)
        compare(public_data(result.data), projected["data"])
        assert projected["source_refs"] == result.source_refs
        assert projected["missing_fields"] == result.missing_fields
        assert projected["fetched_at"] == result.fetched_at.isoformat()
        assert result.data == before


def test_real_housing_batch_preserves_constraints_and_details(checkpoint):
    async def read():
        task = next(t for t in checkpoint["plan"].tasks if t.agent == AgentName.PROPERTY)
        client = McpToolClient(
            McpEndpoint(
                service="location",
                url=live.mcp_url("location"),
                token=live.mcp_token("location"),
                allowed_tools=LOCATION_READ_TOOLS,
            )
        )
        req = AgentTaskRequest(
            request_id=uuid.uuid4().hex,
            thread_id=checkpoint["thread_id"],
            task_id=task.id,
            plan_version=checkpoint["plan"].version,
            attempt=1,
            agent=AgentName.PROPERTY,
            inputs=task.inputs,
            goal="Đọc tối đa 8 phương án theo cùng bộ lọc đã xác nhận, không sửa điều kiện",
            budget=AgentBudget(max_llm_calls=0, max_provider_calls=8),
        )
        session = DomainToolSession(req, LocationSubagent(client, AgentName.PROPERTY))
        output, terminal = await session.execute("search_housing", {"limit": 8})
        assert not terminal and session.result.status == "done"
        assert len(session.rows) == 8, "Require actual listings; do not create replacements"
        assert session.result.data["search_request"]["radius_m"] == task.inputs["search_radius_m"]
        assert session.result.data["search_request"]["max_price"]["amount"] == task.inputs["max_price_vnd"]
        assert all(r["price_vnd"] <= task.inputs["max_price_vnd"] for r in session.rows)
        assert session.result.data["map_context"]["viewport"], "Projection must not remove authoritative UI data"
        assert "map_context" not in output["data"]
        identifier = session.rows[0]["id"]
        detail, _ = await session.execute("get_housing", {"id": identifier})
        assert detail["id"] == identifier and session.result.data["details"][identifier]["id"] == identifier
        assert identifier in session.result.source_refs
        print(
            "REAL_BATCH "
            + json.dumps(
                {
                    "count": len(session.rows),
                    "provider_calls": session.tools.calls,
                    "llm_calls": 0,
                    "cache_hits": session.tools.cached_calls,
                }
            )
        )

    asyncio.run(read())
