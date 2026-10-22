"""Subagent Location theo phản hồi của service Location (Dũng, 2026-09-29)."""

import pytest
from relohome_agent.agents.contracts import UpstreamResult
from relohome_agent.agents.models import AgentName
from relohome_agent.agents.subagents.conformance import sample_request
from relohome_agent.agents.subagents.services.location import LocationSubagent, format_address
from relohome_agent.services.adapters.registry import LOCATION_READ_TOOLS

from tests.test_agents.test_service_subagents import FakeToolClient, listing


def test_address_prefers_raw_and_uses_real_keys():
    assert format_address({"raw": " 12 Lê Lợi, Q1 ", "housenumber": "12"}) == "12 Lê Lợi, Q1"
    assert format_address({"housenumber": "12", "street": "Lê Lợi", "district": "Quận 1", "city": "TP"}) == (
        "12, Lê Lợi, Quận 1, TP"
    )


@pytest.mark.asyncio
async def test_new_housing_fields_and_monthly_vnd_filter():
    item = listing(1, 5_000_000) | {
        "deposit": {"amount": 5_000_000, "currency": "VND"},
        "location_accuracy": "approximate",
        "location_method": "source_api",
        "amenities": ["air_conditioning"],
    }
    client = FakeToolClient(
        {
            "search_areas": {"results": [{"area_id": "a", "name": "Quận 10"}]},
            "search_housing": {"results": [item], "page": {"next_cursor": "c2"}},
        }
    )
    result = await LocationSubagent(client, AgentName.PROPERTY).run(
        sample_request(AgentName.PROPERTY, {"city": "Quận 10", "must_have": ["air_conditioning"]})
    )
    candidate = result.data["candidates"][0]
    assert candidate["deposit_vnd"] == 5_000_000 and candidate["location_accuracy"] == "approximate"
    assert result.data["has_more"] is True
    body = client.calls[-1][1]
    assert body["currency"] == "VND" and body["price_period"] == "month" and body["amenities"] == ["air_conditioning"]
    assert client.calls[0] == ("search_areas", {"text": "Quận 10", "limit": 5, "include_geometry": True})


@pytest.mark.asyncio
async def test_search_compare_uses_fresh_area_results_and_explains_price_basis():
    client = FakeToolClient(
        {
            "search_areas": {"results": [{"area_id": "a", "name": "Cầu Giấy"}]},
            "search_housing": {"results": [listing(1, 4_000_000), listing(2, 3_000_000)]},
        }
    )
    result = await LocationSubagent(client, AgentName.PROPERTY).run(
        sample_request(AgentName.PROPERTY, {"housing_mode": "search_compare", "district": "Cầu Giấy", "limit": 4})
    )
    assert result.status == "done"
    assert [row["rent_vnd"] for row in result.data["comparison"]["rows"]] == [3_000_000, 4_000_000]
    assert result.data["comparison"]["scope"] == "new_search_results_only"
    assert [name for name, _ in client.calls].count("get_housing") == 0


@pytest.mark.asyncio
async def test_unknown_landmark_offers_map_pin_or_wider_area_instead_of_repeating_clarification():
    client = FakeToolClient({"resolve_location": {"results": []}})
    result = await LocationSubagent(client, AgentName.PROPERTY).run(
        sample_request(AgentName.PROPERTY, {"near": "đại học bách khoa hà nội"})
    )
    assert result.status == "needs_input"
    assert result.questions[0].field == "near"
    assert "tên đầy đủ" in result.questions[0].text
    assert "quận/thành phố" in result.questions[0].text


@pytest.mark.asyncio
async def test_ambiguous_area_is_asked_back_with_options():
    areas = {
        "results": [
            {
                "area_id": "a1",
                "name": "Hải Châu",
                "match_type": "fuzzy",
                "match_score": 0.8,
                "parent": {"name": "Đà Nẵng"},
            },
            {
                "area_id": "a2",
                "name": "Hải Châu",
                "match_type": "fuzzy",
                "match_score": 0.78,
                "parent": {"name": "Nghệ An"},
            },
        ]
    }
    client = FakeToolClient({"search_areas": areas})
    result = await LocationSubagent(client, AgentName.PROPERTY).run(
        sample_request(AgentName.PROPERTY, {"city": "Hải Châu"})
    )
    assert result.status == "needs_input"
    # Only strong fuzzy matches (>= MIN_SUGGESTION_SCORE) are offered; weaker ones are not real choices.
    assert result.questions[0].options == ["Hải Châu (Đà Nẵng)"]
    assert [c[0] for c in client.calls] == ["search_areas"]


@pytest.mark.asyncio
async def test_map_flags_approximate_listing_locations():
    client = FakeToolClient({"find_nearby_places": {"results": []}})
    upstream = {
        "t1": UpstreamResult(
            task_id="t1",
            agent=AgentName.PROPERTY,
            data={"candidates": [{"id": "l1", "lat": 10.7, "lng": 106.6, "location_accuracy": "approximate"}]},
        )
    }
    result = await LocationSubagent(client, AgentName.MAP).run(
        sample_request(AgentName.MAP, {"categories": ["hospital"]}, upstream)
    )
    assert result.data["approximate_origins"] == ["l1"]


def test_entity_route_tool_is_allowed():
    assert "calculate_route_between_entities" in LOCATION_READ_TOOLS
