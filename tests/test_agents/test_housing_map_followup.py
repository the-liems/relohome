"""Catalog-backed scope recovery, not hard-coded Cầu Giấy coordinates or LLM calls."""

from types import SimpleNamespace

import pytest
from langchain_core.messages import HumanMessage
from relohome_agent.agents.deps import AgentRegistry, test_deps
from relohome_agent.agents.intake import FixedIntake
from relohome_agent.agents.intake_llm import LlmIntake
from relohome_agent.agents.models import AgentName, RequestKind, SessionContext
from relohome_agent.agents.nodes.intake import make_intake
from relohome_agent.agents.planner_llm import LlmPlanner
from relohome_agent.agents.subagents.capabilities import BASELINE_CAPABILITIES
from relohome_agent.agents.subagents.conformance import sample_request
from relohome_agent.agents.subagents.services.location import LocationSubagent, requested_area_query
from relohome_agent.agents.subagents.services.read_llm import ReadLlmAgent

from tests.test_agents.helpers import Session, fact, intake_result
from tests.test_agents.test_housing_filter_followups import SequenceModel, draft
from tests.test_agents.test_intake import memory
from tests.test_agents.test_map_workspace import FakeResponses, call
from tests.test_agents.test_service_subagents import FakeToolClient, listing
from tests.test_agents.test_token_efficiency import Model

CITY = {
    "area_id": "hanoi",
    "name": "Thành phố Hà Nội",
    "match_type": "exact",
    "bounding_box": {"west": 105, "south": 20, "east": 106, "north": 22},
}
AREA = {
    "area_id": "caugiay",
    "name": "Phường Cầu Giấy",
    "match_type": "contains",
    "bounding_box": {"west": 105.77, "south": 21.01, "east": 105.82, "north": 21.05},
}


def client_for(areas):
    return FakeToolClient(
        {
            "search_areas": lambda args: {"results": [CITY] if args["text"] == "Hà Nội" else areas},
            "resolve_location": {"results": []},
            "search_housing": {"results": [listing(1, 4_000_000)]},
        }
    )


@pytest.mark.parametrize(
    "near,message,goal,expected",
    [
        ("cầu giấy", "đổi lại khu vực cầu giấy", "", "cầu giấy"),
        ("cầu giấy hà nội", "đổi lại khu vực cầu giấy hà nội", "", "cầu giấy"),
        ("Cầu Giấy", "Giảm xuống dưới 4 triệu", "Tìm nhà ở khu vực Cầu Giấy dưới 4 triệu", "Cầu Giấy"),
        ("Cầu Giấy", "Giảm xuống dưới 4 triệu", "Tìm nhà ở Cầu Giấy dưới 4 triệu", "Cầu Giấy"),
        ("Cầu Giấy", "Tìm gần Cầu Giấy", "Tìm nhà ở khu vực Cầu Giấy", None),
        ("Bệnh viện Cầu Giấy", "đổi lại khu vực cầu giấy", "", None),
        ("Ocean Park 2", "gần Ocean Park 2", "", None),
        ("Ocean Park 1", "Tìm nhà ở khu Ocean Park 1 dưới 5 triệu", "", "Ocean Park 1"),
        ("Ocean Park 1", "Tìm nhà trong khu Ocean Park 1 dưới 5 triệu", "", "Ocean Park 1"),
        ("Ocean Park 1", "Tìm nhà tại khu Ocean Park 1 dưới 5 triệu", "", "Ocean Park 1"),
        ("Ocean Park 1", "Tìm nhà ở khu đô thị Ocean Park 1", "", "Ocean Park 1"),
        ("Ocean Park 1", "Tìm nhà trong khu dân cư Ocean Park 1", "", "Ocean Park 1"),
        ("Ocean Park 1", "Tìm nhà gần khu Ocean Park 1", "Tìm trong khu Ocean Park 1", None),
        ("Ocean Park 1", "Tìm nhà ở khu Ocean Park 2", "", None),
    ],
)
def test_recovery_requires_explicit_scope_intent_matching_the_input(near, message, goal, expected):
    req = sample_request(AgentName.PROPERTY, {"city": "Hà Nội", "near": near}, user_request=message, goal=goal)
    assert requested_area_query(req) == expected
    assert requested_area_query(req.model_copy(update={"inputs": {**req.inputs, "search_radius_m": 1000}})) is None


@pytest.mark.asyncio
async def test_wrongly_extracted_near_resolves_exact_catalog_area_without_point_or_extra_model():
    client = client_for([AREA])
    req = sample_request(
        AgentName.PROPERTY,
        {"city": "Hà Nội", "near": "cầu giấy hà nội", "max_price_vnd": 5_000_000},
        user_request="đổi lại khu vực cầu giấy hà nội",
    )
    result = await LocationSubagent(client, AgentName.PROPERTY).run(req)
    assert result.status == "done"
    search = result.data["search_request"]
    assert search["administrative_area_ids"] == ["caugiay"]  # never OR with the whole city
    assert search["max_price"]["amount"] == 5_000_000
    assert "center" not in search and "radius_m" not in search
    assert result.data["area_name"] == AREA["name"]
    assert result.data["map_context"]["viewport"] == AREA["bounding_box"]
    assert result.usage.llm_calls == 0
    assert [name for name, _ in client.calls] == ["search_areas", "search_areas", "search_housing"]
    assert client.calls[1][1]["bounding_box"] == CITY["bounding_box"]
    assert req.inputs["near"] == "cầu giấy hà nội"  # request remains immutable


@pytest.mark.asyncio
async def test_real_near_request_does_not_switch_to_a_polygon():
    client = client_for([AREA])
    client.handlers["resolve_location"] = {
        "results": [{"name": "Cầu Giấy", "location": {"lat": 21.03, "lng": 105.8}, "match_type": "exact"}]
    }
    req = sample_request(
        AgentName.PROPERTY, {"city": "Hà Nội", "near": "Cầu Giấy"}, user_request="Tìm nhà gần Cầu Giấy"
    )
    result = await LocationSubagent(client, AgentName.PROPERTY).run(req)
    assert result.status == "done"
    assert result.data["search_request"]["center"] == {"lat": 21.03, "lng": 105.8}
    assert [name for name, _ in client.calls].count("search_areas") == 1


@pytest.mark.parametrize(
    "area",
    [
        {**AREA, "name": "Cầu Giấy Đông"},
        {**AREA, "match_type": "fuzzy", "match_score": 0.99},
        {**AREA, "bounding_box": {"west": 106, "south": 10, "east": 107, "north": 11}},
        {**AREA, "bounding_box": None},
    ],
)
@pytest.mark.asyncio
async def test_recovery_never_accepts_partial_fuzzy_outside_city_or_unverifiable_area(area):
    client = client_for([area])
    result = await LocationSubagent(client, AgentName.PROPERTY).run(
        sample_request(AgentName.PROPERTY, {"city": "Hà Nội", "near": "Cầu Giấy"}, user_request="đổi khu vực Cầu Giấy")
    )
    assert result.status == "needs_input"
    assert not any(name == "search_housing" for name, _ in client.calls)
    assert result.questions and "tọa độ" in result.questions[0].text


@pytest.mark.asyncio
async def test_two_real_matching_areas_ask_instead_of_picking_the_first():
    other = {**AREA, "area_id": "other", "bounding_box": {**AREA["bounding_box"], "east": 105.83}}
    client = client_for([AREA, other])
    result = await LocationSubagent(client, AgentName.PROPERTY).run(
        sample_request(AgentName.PROPERTY, {"city": "Hà Nội", "near": "Cầu Giấy"}, user_request="đổi khu vực Cầu Giấy")
    )
    assert result.status == "needs_input"
    assert len(result.questions[0].choices) == 2
    assert not any(name in {"resolve_location", "search_housing"} for name, _ in client.calls)


@pytest.mark.asyncio
async def test_new_scope_cannot_restore_a_stale_city_from_account_preferences():
    text = "đổi lại khu vực Cầu Giấy"
    current = intake_result(
        RequestKind.CHANGE,
        [AgentName.PROPERTY],
        values={"district": "Cầu Giấy"},
        facts={"district": fact("Cầu Giấy", "Cầu Giấy")},
    )
    previous = intake_result(
        domains=[AgentName.PROPERTY],
        values={"city": "Đà Nẵng", "near": "Bãi biển cũ", "max_price_vnd": 5000000},
        facts={"city": fact("Đà Nẵng", "Đà Nẵng"), "near": fact("Bãi biển cũ", "Bãi biển cũ")},
    )
    deps = test_deps(intake=FixedIntake(current), planner=LlmPlanner(Model(), BASELINE_CAPABILITIES))
    result = (
        await make_intake(deps)(
            {
                "thread_id": "t",
                "request_id": "r",
                "messages": [HumanMessage(text)],
                "intake": previous,
                "session": SessionContext(preferences={"city": memory("Đà Nẵng")}),
                "map_view": {"bounding_box": {"west": 108.1, "south": 16, "east": 108.2, "north": 16.1}},
            }
        )
    )["intake"]
    assert result.constraints.values == {"district": "Cầu Giấy", "max_price_vnd": 5000000}
    assert not result.prefilled
    assert "city" in result.housing_prefill_exclusions


@pytest.mark.asyncio
async def test_ocean_park_to_cau_giay_then_price_edit_uses_catalog_and_preserves_filters():
    first = "Tìm nhà ở Hà Nội gần Ocean Park 2 dưới 5 triệu"
    changed = "đổi lại khu vực Cầu Giấy Hà Nội"
    cheaper = "giảm xuống dưới 4 triệu"
    drafts = [
        draft(first, kind="new_goal", values={"city": "Hà Nội", "near": "Ocean Park 2", "max_price_vnd": 5000000}),
        # Reproduce the observed extraction, rather than relying on a better prompt.
        draft(changed, values={"city": "Hà Nội", "near": "Cầu Giấy Hà Nội"}),
        draft(cheaper, values={"max_price_vnd": 4000000}).model_copy(
            update={"normalized_goal": "Tìm nhà ở khu vực Cầu Giấy Hà Nội dưới 4 triệu"}
        ),
    ]
    model, planner = SequenceModel(drafts), Model()
    client = client_for([AREA])
    client.handlers["resolve_location"] = {
        "results": [{"name": "Ocean Park 2", "location": {"lat": 21, "lng": 105.9}, "match_type": "exact"}]
    }
    session = Session(
        test_deps(
            intake=LlmIntake(model, max_calls=1),
            planner=LlmPlanner(planner, BASELINE_CAPABILITIES),
            agents=AgentRegistry({AgentName.PROPERTY: LocationSubagent(client, AgentName.PROPERTY)}),
        )
    )
    for text in (first, changed, cheaper):
        if text == changed:
            await session.graph.aupdate_state(
                session.config,
                {
                    "map_view": {"bounding_box": {"west": 105.85, "south": 20.98, "east": 105.95, "north": 21.02}},
                    "housing_location": {"address": "Ocean Park 2", "lat": 21, "lng": 105.9, "confirmed": True},
                },
            )
        result = await session.say(text)
        assert result["response"].kind == "ANSWER", result["response"].text
        if text != first:
            assert result.get("housing_location") is None
            assert "bounding_box" not in result["intake"].constraints.values
    searches = [args for name, args in client.calls if name == "search_housing"]
    assert len(searches) == 3
    assert searches[0]["center"] == {"lat": 21, "lng": 105.9}
    for search in searches[1:]:
        assert search["administrative_area_ids"] == [AREA["area_id"]]
        assert "center" not in search
    assert searches[-1]["max_price"]["amount"] == 4000000
    assert len(model.calls) == 3 and not planner.calls  # no additional LLM repair or scope classifier


@pytest.mark.asyncio
async def test_full_model_tool_loop_scope_preparation_does_not_bind_polygon_as_point_or_repeat_wire_lookup():
    client = client_for([AREA])
    responses = FakeResponses(
        [
            call("resolve_location", {"field": "near"}),
            call("search_housing_and_return", {"limit": None}),
        ]
    )
    agent = ReadLlmAgent("test-key", "test-model", LocationSubagent(client, AgentName.PROPERTY))
    agent.llm_client = SimpleNamespace(responses=responses)
    req = sample_request(
        AgentName.PROPERTY,
        {"city": "Hà Nội", "near": "Cầu Giấy Hà Nội", "max_price_vnd": 5000000},
        user_request="đổi lại khu vực Cầu Giấy Hà Nội",
    )
    req.budget.max_llm_calls = 3  # existing loop reserves the last two slots from preparation
    result = await agent.run(req)
    assert result.status == "done", result.error
    assert result.data["search_request"]["administrative_area_ids"] == [AREA["area_id"]]
    assert "center" not in result.data["search_request"]
    assert result.usage.llm_calls == 2 and result.usage.provider_calls == 3
    assert [name for name, _ in client.calls] == ["search_areas", "search_areas", "search_housing"]
    assert not responses.replies
