"""Map integration: IDs, metadata, bounded pagination and selected-home planning."""

import pytest
from relohome_agent.agents.deps import AgentRegistry, fake_registry, test_deps
from relohome_agent.agents.intake import ScriptedIntake, missing_for
from relohome_agent.agents.models import AgentName, Plan, RequestKind, SessionContext, Task
from relohome_agent.agents.planner_llm import LlmPlanner
from relohome_agent.agents.planning import PlannerInput, TemplatePlanner, validate_plan
from relohome_agent.agents.subagents.conformance import sample_request
from relohome_agent.agents.subagents.services.location import LocationSubagent

from tests.test_agents.helpers import Session, fact, intake_result
from tests.test_agents.test_service_subagents import FakeToolClient, listing

HOME = "30000000-0000-4000-8000-000000000010"
PLACE = "00000000-0000-4000-8000-000000000001"
BOX = {"west": 106.6, "south": 10.7, "east": 106.8, "north": 10.9}


@pytest.mark.asyncio
async def test_housing_keeps_source_thumbnail_and_resumable_page():
    item = listing(1, 5_000_000) | {
        "thumbnail_url": "https://example.com/home.jpg",
        "source": {"source_id": "original", "source_url": "https://example.com/listing"},
    }
    client = FakeToolClient(
        {
            "search_areas": {"results": [{"area_id": "hcm", "name": "Hồ Chí Minh"}]},
            "search_housing": {"results": [item], "page": {"next_cursor": "next"}, "query_id": "query"},
        }
    )
    result = await LocationSubagent(client, AgentName.PROPERTY).run(
        sample_request(
            AgentName.PROPERTY, {"city": "Hồ Chí Minh", "limit": 1, "cursor": "previous", "max_price_vnd": 6_000_000}
        )
    )
    request = client.calls[-1][1]
    assert request["pagination"] == {"limit": 1, "cursor": "previous"}
    assert request["max_price"]["amount"] == 6_000_000  # a 0 ceiling is not a valid Housing input
    assert result.data["search_request"] == request
    assert result.data["next_cursor"] == "next"
    assert result.data["candidates"][0]["thumbnail_url"] == item["thumbnail_url"]
    assert result.data["candidates"][0]["source"] == item["source"]
    assert result.data["map_context"]["listing_ids"] == [item["listing_id"]]


@pytest.mark.asyncio
async def test_empty_continuation_does_not_restart_search_with_relaxed_filters():
    client = FakeToolClient(
        {
            "search_areas": {"results": [{"area_id": "hcm", "name": "Hồ Chí Minh"}]},
            "search_housing": {"results": [], "page": {"next_cursor": None}},
        }
    )
    await LocationSubagent(client, AgentName.PROPERTY).run(
        sample_request(
            AgentName.PROPERTY, {"city": "Hồ Chí Minh", "cursor": "next", "soft_filters": {"max_price_vnd": 5_000_000}}
        )
    )
    assert [tool for tool, _ in client.calls].count("search_housing") == 1


@pytest.mark.asyncio
async def test_nearby_selected_home_hydrates_without_upstream_and_keeps_poi_coordinates():
    point = {"lat": 10.771, "lng": 106.701}
    client = FakeToolClient(
        {
            "get_housing": {"location": {"lat": 10.77, "lng": 106.7}, "location_accuracy": "unknown"},
            "find_nearby_places": {
                "results": [
                    {
                        "place_id": PLACE,
                        "name": "Hospital",
                        "category": "hospital",
                        "distance_meters": 150,
                        "location": point,
                        "source": {"source_id": "poi-source"},
                    }
                ]
            },
        }
    )
    result = await LocationSubagent(client, AgentName.MAP).run(
        sample_request(AgentName.MAP, {"categories": ["hospital"], "selected_listing_id": HOME})
    )
    assert client.calls[0] == ("get_housing", {"listing_id": HOME})
    poi = result.data["nearby"][HOME][0]
    assert poi["location"] == point and poi["distance_kind"] == "straight_line"
    assert result.data["coverage"] == "nearest_per_category"
    assert result.data["approximate_origins"] == [HOME]


@pytest.mark.asyncio
async def test_nearby_without_origin_asks_instead_of_claiming_empty_success():
    client = FakeToolClient({})
    result = await LocationSubagent(client, AgentName.MAP).run(
        sample_request(AgentName.MAP, {"categories": ["hospital"]})
    )
    assert result.status == "needs_input" and client.calls == []


@pytest.mark.asyncio
@pytest.mark.parametrize("selected_field", ["route_from", "route_to"])
async def test_route_selected_home_preserves_direction_and_does_not_resolve_its_name(selected_field):
    client = FakeToolClient(
        {
            "search_areas": {"results": [{"name": "Hồ Chí Minh", "bounding_box": BOX}]},
            "resolve_location": {"results": [{"entity_type": "place", "canonical_id": PLACE, "name": "Hospital"}]},
            "calculate_route_between_entities": {"warnings": [{"code": "APPROXIMATE_LOCATION", "endpoint": "origin"}]},
        }
    )
    inputs = {
        "map_mode": "route",
        "city": "Hồ Chí Minh",
        "route_from": "Hospital",
        "route_to": "Hospital",
        "selected_listing_id": HOME,
        "route_profile": "walking",
    }
    inputs[selected_field] = "selected:property"
    result = await LocationSubagent(client, AgentName.MAP).run(sample_request(AgentName.MAP, inputs))
    payload = client.calls[-1][1]
    end = "origin" if selected_field == "route_from" else "destination"
    assert payload[end] == {"type": "housing", "listing_id": HOME}
    assert payload["profile"] == "walking"
    resolves = [args for tool, args in client.calls if tool == "resolve_location"]
    assert len(resolves) == 1 and resolves[0]["bounding_box"] == BOX
    assert result.data["routing"]["warnings"]


def test_route_missing_home_selection_is_blocking():
    values = {"map_mode": "route", "city": "Hồ Chí Minh", "route_from": "selected:property", "route_to": "Hospital"}
    assert missing_for(AgentName.MAP, values, {AgentName.MAP}, {}) == ["map.selected:property"]


@pytest.mark.asyncio
@pytest.mark.parametrize("route", [True, False])
async def test_both_planners_ground_map_selection_without_rerunning_property(route):
    values = (
        {"city": "Hồ Chí Minh", "map_mode": "route", "route_from": "selected:property", "route_to": "Hospital"}
        if route
        else {}
    )
    intake = intake_result(domains=[AgentName.MAP], values=values, facts={"selected:property": fact(HOME, "căn này")})
    inp = PlannerInput(intake=intake, session=SessionContext(), available_agents=[AgentName.MAP])
    plan = (await TemplatePlanner().plan(inp)).plan
    assert len(plan.tasks) == 1
    task = plan.tasks[0]
    assert task.inputs["selected_listing_id"] == HOME and task.depends_on == []
    assert LlmPlanner._grounding_errors(plan, inp) == []
    assert validate_plan(plan, fake_registry(), intake, {}) == []
    bad = Task(id=task.id, agent=task.agent, inputs={**task.inputs, "selected_listing_id": "wrong"})
    assert validate_plan(Plan(version=0, tasks=[bad]), fake_registry(), intake, {})
    assert LlmPlanner._grounding_errors(Plan(version=0, tasks=[bad]), inp)


@pytest.mark.asyncio
async def test_named_landmark_search_keeps_explicit_city_scope():
    client = FakeToolClient(
        {
            "search_areas": {"results": [{"area_id": "hcm", "name": "Hồ Chí Minh", "bounding_box": BOX}]},
            "resolve_location": {"results": [{"name": "Hospital", "location": {"lat": 10.77, "lng": 106.7}}]},
            "search_housing": {"results": [], "page": {"next_cursor": None}},
        }
    )
    await LocationSubagent(client, AgentName.PROPERTY).run(
        sample_request(AgentName.PROPERTY, {"city": "Hồ Chí Minh", "near": "Hospital"})
    )
    assert client.calls[1][1]["bounding_box"] == BOX
    assert client.calls[-1][1]["administrative_area_ids"] == ["hcm"]


@pytest.mark.asyncio
async def test_conflicting_origin_modes_and_incomplete_route_are_rejected_without_tool_calls():
    for inputs in [
        {"categories": ["hospital"], "near": "Hospital", "selected_listing_id": HOME},
        {"categories": ["hospital"], "map_mode": "route"},
    ]:
        client = FakeToolClient({})
        result = await LocationSubagent(client, AgentName.MAP).run(sample_request(AgentName.MAP, inputs))
        assert result.status == "failed" and client.calls == []


@pytest.mark.asyncio
async def test_graph_search_then_selected_home_route_keeps_identity_across_turns():
    home_id = "30000000-0000-4000-8000-a0b0c0d0e010"
    client = FakeToolClient(
        {
            "search_areas": {"results": [{"area_id": "hcm", "name": "Hồ Chí Minh", "bounding_box": BOX}]},
            "search_housing": {
                "results": [listing(1, 5_000_000) | {"listing_id": home_id}],
                "page": {"next_cursor": None},
            },
            "resolve_location": {"results": [{"entity_type": "place", "canonical_id": PLACE, "name": "Hospital"}]},
            "calculate_route_between_entities": {
                "profile": "walking",
                "warnings": [],
                "route": {
                    "distance_meters": 1200,
                    "duration_seconds": 900,
                    "geometry": {"type": "LineString", "coordinates": [[106.66, 10.761], [106.7, 10.77]]},
                },
            },
        }
    )
    intake = ScriptedIntake(
        [
            intake_result(domains=[AgentName.PROPERTY], values={"city": "Hồ Chí Minh"}),
            intake_result(
                RequestKind.REFINE,
                [AgentName.MAP],
                values={
                    "map_mode": "route",
                    "route_from": "selected:property",
                    "route_to": "Hospital",
                    "route_profile": "walking",
                },
                facts={"selected:property": fact(home_id, "Chọn căn đầu")},
            ),
        ]
    )
    deps = test_deps(
        intake,
        TemplatePlanner(),
        agents=AgentRegistry(
            {
                AgentName.PROPERTY: LocationSubagent(client, AgentName.PROPERTY),
                AgentName.MAP: LocationSubagent(client, AgentName.MAP),
            }
        ),
    )
    session = Session(deps)
    first = await session.say("Tìm nhà tại Hồ Chí Minh")
    assert first["response"].kind == "ANSWER"
    second = await session.say("Chọn căn đầu, đi bộ từ căn này đến Hospital")
    assert second["response"].kind == "ANSWER", second.get("validation")
    routes = [args for tool, args in client.calls if tool == "calculate_route_between_entities"]
    assert len(routes) == 1 and routes[0]["origin"] == {"type": "housing", "listing_id": home_id}
    assert [tool for tool, _ in client.calls].count("search_housing") == 1
    assert "1.20 km" in second["response"].text


@pytest.mark.asyncio
async def test_amenity_proximity_is_sent_as_a_housing_filter():
    item = listing(1, 5_000_000) | {
        "nearby": [{"place_id": PLACE, "name": "Bệnh viện A", "category": "hospital", "distance_meters": 420.5}]
    }
    client = FakeToolClient(
        {
            "search_areas": {"results": [{"area_id": "hn", "name": "Hà Nội"}]},
            "search_housing": {"results": [item], "page": {"next_cursor": None}},
        }
    )
    result = await LocationSubagent(client, AgentName.PROPERTY).run(
        sample_request(AgentName.PROPERTY, {"city": "Hà Nội", "nearby_categories": ["hospital"]})
    )
    request = client.calls[-1][1]
    assert request["nearby"] == [{"category": "hospital", "max_distance_m": 1500}]
    assert result.data["candidates"][0]["nearby"] == [
        {"name": "Bệnh viện A", "category": "hospital", "distance_m": 420.5}
    ]
