"""Issue119: read-only actual MCP/PostGIS, opt-in; no LLM/transactions/fixtures."""

import asyncio
import os
from uuid import uuid4

import httpx
import pytest
from relohome_agent.agents.contracts import AgentTaskRequest
from relohome_agent.agents.models import AgentBudget, AgentName
from relohome_agent.agents.subagents.services.location import LocationSubagent
from relohome_agent.services.adapters.mcp import McpEndpoint, McpToolClient
from relohome_agent.services.adapters.registry import LOCATION_READ_TOOLS

from tests import live

pytestmark = pytest.mark.skipif(os.getenv("RUN_HOUSING_MAP_SCOPE_LIVE") != "1", reason="Actual read services opt-in")


@pytest.mark.parametrize(
    "inputs,missing_boundary",
    [
        ({"city": "hanoi", "max_price_vnd": 5_000_000}, False),
        ({"city": "hanoi", "district": "Cầu Giấy"}, False),
        ({"city": "hanoi", "district": "Hoàng Mai"}, False),
        ({"city": "hcm"}, False),
        ({"city": "danang"}, False),
        ({"city": "hcm", "district": "Quận 5"}, True),
    ],
)
def test_real_scope_and_unclustered_map(inputs, missing_boundary):
    async def run():
        client = McpToolClient(
            McpEndpoint(
                service="location",
                url=live.mcp_url("location"),
                token=live.mcp_token("location"),
                allowed_tools=LOCATION_READ_TOOLS,
            )
        )
        request = AgentTaskRequest(
            request_id=uuid4().hex,
            thread_id="issue119-read",
            task_id="housing",
            plan_version=1,
            attempt=1,
            agent=AgentName.PROPERTY,
            goal="Read actual search scope",
            inputs=inputs,
            budget=AgentBudget(max_llm_calls=0, max_provider_calls=16),
        )
        result = await LocationSubagent(client, AgentName.PROPERTY).run(request)
        assert result.status == "done", result.status
        scope = result.data["map_context"]["search_scope"]
        query = result.data["search_request"]
        assert "amenities" not in query
        if missing_boundary:
            assert scope["boundary_unavailable"] and scope["geometry"] is None
            assert query["district"] == inputs["district"]
        else:
            assert scope["geometry"]["type"] in {"Polygon", "MultiPolygon"}
            assert scope["area_id"] in query["administrative_area_ids"]
            catalog = await client.call("search_areas", {"text": scope["label"], "include_geometry": True, "limit": 10})
            observed = next(a for a in catalog["results"] if a["area_id"] == scope["area_id"])
            assert scope["geometry"] == observed["geometry"]
        body = {k: v for k, v in query.items() if k != "pagination"}
        body.update(
            listing_type=[query["listing_type"]],
            bounding_box=result.data["map_context"]["viewport"],
            zoom=10,
            cluster=False,
            limit=50,
        )
        async with httpx.AsyncClient(timeout=30) as http:
            response = await http.post(live.platform_api_url() + "/housing/map", json=body)
        response.raise_for_status()
        data = response.json()
        assert data["meta"]["mode"] == "listings"
        assert all(f["kind"] == "listing" for f in data["features"])
        assert len(data["features"]) <= 50
        if inputs.get("max_price_vnd"):
            assert all(f["price"]["amount"] <= inputs["max_price_vnd"] for f in data["features"])
        print(
            {
                "inputs": inputs,
                "scope": scope["label"],
                "missing_boundary": missing_boundary,
                "map_rows": len(data["features"]),
                "truncated": data["meta"]["truncated"],
            }
        )

    asyncio.run(run())
