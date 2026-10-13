"""Issue #73: real PostGIS/MCP and separately authorized synthetic demo dataset.

RUN_SEARCH_SCOPE_ROOMMATE_LIVE=1. Zero LLM, booking, contact or real-profile writes.
"""

import asyncio
import os
from datetime import UTC
from uuid import uuid4

import httpx
import pytest
from relohome_agent.agents.contracts import AgentTaskRequest
from relohome_agent.agents.llm_context import decision_data
from relohome_agent.agents.models import AgentBudget, AgentName
from relohome_agent.agents.subagents.services.location import LocationSubagent, _meters, pick_place
from relohome_agent.services.adapters.mcp import McpEndpoint, McpToolClient
from relohome_agent.services.adapters.registry import LOCATION_READ_TOOLS
from relohome_roommate.demo import DemoDataset
from relohome_roommate.models import RoommateSearchCriteria

from tests import live
from tests.test_llm_agents.test_workspace_repairs_live import ROOT

pytestmark = pytest.mark.skipif(os.getenv("RUN_SEARCH_SCOPE_ROOMMATE_LIVE") != "1", reason="Real read services opt-in")


def client():
    return McpToolClient(
        McpEndpoint(
            service="location",
            url=live.mcp_url("location"),
            token=live.mcp_token("location"),
            allowed_tools=LOCATION_READ_TOOLS,
        )
    )


def request(inputs):
    return AgentTaskRequest(
        request_id=uuid4().hex,
        thread_id="issue73_read",
        task_id="housing",
        plan_version=1,
        attempt=1,
        agent=AgentName.PROPERTY,
        goal="Read actual scope",
        inputs=inputs,
        budget=AgentBudget(max_llm_calls=0, max_provider_calls=12),
    )


def test_current_named_ward_uses_polygon_and_narrowest_filter():
    async def run():
        tools = client()
        original = await tools.call("search_areas", {"text": "Cầu Giấy", "include_geometry": True})
        result = await LocationSubagent(tools, AgentName.PROPERTY).run(
            request({"city": "Hà Nội", "district": "Cầu Giấy"})
        )
        assert result.status == "done"
        scope = result.data["map_context"]["search_scope"]
        area = next(a for a in original["results"] if a["area_id"] == scope["area_id"])
        assert scope["geometry"] == area["geometry"] and scope["geometry"]["type"] in {"Polygon", "MultiPolygon"}
        assert scope["label"] == area["name"] and "Phường" in scope["label"]
        assert result.data["search_request"]["administrative_area_ids"] == [area["area_id"]]
        assert "district" not in result.data["search_request"]
        assert scope["center"] is None and scope["boundary_kind"] == "administrative_polygon"
        assert "geometry" not in str(decision_data(result.data))

    asyncio.run(run())


def test_actual_radius_and_map_pan_do_not_broaden_search():
    async def run():
        tools = client()
        resolved = await tools.call("resolve_location", {"text": "Đại học Bách khoa Hà Nội", "limit": 10})
        place = pick_place([r for r in resolved["results"] if r.get("category") == "university"])
        assert place and place["location"]
        result = await LocationSubagent(tools, AgentName.PROPERTY).run(
            request(
                {
                    "near": place["name"],
                    "near_coordinate": place["location"],
                    "search_radius_m": 2000,
                    "limit": 5,
                }
            )
        )
        assert result.status == "done"
        query = result.data["search_request"]
        map_query = {k: v for k, v in query.items() if k != "pagination"}
        map_query["listing_type"] = [query["listing_type"]]
        box = result.data["map_context"]["viewport"]
        async with httpx.AsyncClient(base_url=live.platform_api_url(), timeout=30) as platform:
            mapped_response = await platform.post(
                "/housing/map",
                json={**map_query, "bounding_box": box, "zoom": 17},
            )
            mapped_response.raise_for_status()
            mapped = mapped_response.json()
        features = [f for f in mapped["features"] if f["kind"] == "listing"]
        assert features and all(_meters(place["location"], f["location"]) < 2020 for f in features)
        width = box["east"] - box["west"]
        shifted = {**box, "west": box["west"] + width * 3, "east": box["east"] + width * 3}
        async with httpx.AsyncClient(base_url=live.platform_api_url(), timeout=30) as platform:
            panned_response = await platform.post(
                "/housing/map",
                json={**map_query, "bounding_box": shifted, "zoom": 17},
            )
            panned_response.raise_for_status()
            panned = panned_response.json()
        assert not panned["features"]

    asyncio.run(run())


def test_hundred_demo_profiles_never_enter_real_discovery_or_identity():
    from datetime import datetime

    from pydantic import ValidationError
    from relohome_roommate.ports import Actor

    dataset = DemoDataset.load(ROOT / os.environ["ROOMMATE_DEMO_DATASET"])
    now = datetime.now(UTC)
    assert len(dataset.profiles) == 100
    total = sum(
        dataset.search("issue73_viewer", RoommateSearchCriteria(city=city), now, 0, 50)["total"]
        for city in ("hanoi", "hcm", "danang")
    )
    assert total == 100
    for record in dataset.profiles:
        with pytest.raises(ValidationError):
            Actor(id=record.owner_id)
    assert (
        len(dataset.room_profiles({p.content.room.listing_id for p in dataset.profiles if p.content.room}, now)) == 60
    )
