"""Resolution failures are not missing text and must not lead to repeated forms."""

import json
from pathlib import Path

import pytest
from relohome_agent.agents.deps import AgentRegistry, test_deps
from relohome_agent.agents.intake_llm import LlmIntake
from relohome_agent.agents.models import AgentName, Question
from relohome_agent.agents.nodes.respond import unique_questions
from relohome_agent.agents.planner_llm import LlmPlanner
from relohome_agent.agents.subagents.capabilities import BASELINE_CAPABILITIES
from relohome_agent.agents.subagents.conformance import sample_request
from relohome_agent.agents.subagents.services.location import LocationSubagent
from relohome_agent.agents.subagents.services.read_llm import ReadLlmAgent

from tests.test_agents.helpers import Session
from tests.test_agents.test_housing_filter_followups import SequenceModel, draft
from tests.test_agents.test_service_subagents import FakeToolClient, listing
from tests.test_agents.test_token_efficiency import Model

MESSAGE = "Tìm nhà ở khu Ocean Park 1 dưới 5 triệu"


def request(**inputs):
    return sample_request(
        AgentName.PROPERTY,
        {"near": "Ocean Park 1", "max_price_vnd": 5_000_000, **inputs},
        user_request=MESSAGE,
        goal=MESSAGE,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "options,status,count",
    [
        ([], "no_results", 0),
        ([{"name": "Other project", "match_type": "fuzzy", "match_score": 0.6}], "below_suggestion_threshold", 1),
    ],
)
async def test_unresolved_location_is_explicit_and_does_not_search_somewhere_else(options, status, count):
    client = FakeToolClient({"search_areas": {"results": []}, "resolve_location": {"results": options}})
    result = await LocationSubagent(client, AgentName.PROPERTY).run(request())
    assert result.status == "needs_input" and result.error is None
    question = result.questions[0]
    assert question.field == "near" and question.reason == "location_not_found"
    assert not question.choices and not question.options
    assert "tên đầy đủ" in question.text and "chưa mở rộng" in question.text
    assert result.data["location_resolution"] == {
        "field": "near",
        "status": status,
        "candidate_count": count,
        "offered_count": 0,
    }
    assert [name for name, _ in client.calls] == ["search_areas", "resolve_location"]


@pytest.mark.asyncio
async def test_actual_area_match_searches_its_polygon_and_preserves_budget():
    area = {
        "area_id": "catalog-area-1",
        "name": "Ocean Park 1",
        "match_type": "exact",
        "bounding_box": {"west": 105.9, "south": 20.9, "east": 105.95, "north": 21.0},
    }
    client = FakeToolClient(
        {"search_areas": {"results": [area]}, "search_housing": {"results": [listing(1, 4_000_000)]}}
    )
    result = await LocationSubagent(client, AgentName.PROPERTY).run(request())
    assert result.status == "done" and not result.questions
    body = next(args for name, args in client.calls if name == "search_housing")
    assert body["administrative_area_ids"] == ["catalog-area-1"]
    assert body["max_price"]["amount"] == 5_000_000
    assert "center" not in body and "radius_m" not in body
    assert not any(name == "resolve_location" for name, _ in client.calls)


@pytest.mark.asyncio
async def test_real_place_fallback_keeps_provider_point_not_guessed_coordinates():
    point = {"lat": 21.0, "lng": 105.94}
    client = FakeToolClient(
        {
            "search_areas": {"results": []},
            "resolve_location": {"results": [{"name": "Ocean Park 1", "match_type": "exact", "location": point}]},
            "search_housing": {"results": [listing(1, 4_000_000)]},
        }
    )
    result = await LocationSubagent(client, AgentName.PROPERTY).run(request())
    assert result.status == "done"
    assert result.data["search_request"]["center"] == point
    assert result.data["search_request"]["max_price"]["amount"] == 5_000_000
    assert result.data["map_context"]["search_scope"]["boundary_kind"] == "search_radius"


@pytest.mark.asyncio
async def test_ambiguous_location_preserves_provider_choices_and_reason():
    choices = [
        {
            "canonical_id": f"real-place-{index}",
            "name": "Ocean Park 1",
            "match_type": "exact",
            "entity_type": "place",
            "location": {"lat": 21.0 + index / 100, "lng": 105.94},
        }
        for index in range(2)
    ]
    client = FakeToolClient({"search_areas": {"results": []}, "resolve_location": {"results": choices}})
    result = await LocationSubagent(client, AgentName.PROPERTY).run(request())
    assert result.status == "needs_input"
    assert result.questions[0].reason == "location_ambiguous"
    assert [choice.id for choice in result.questions[0].choices] == ["real-place-0", "real-place-1"]
    assert result.data["location_resolution"]["status"] == "ambiguous"
    assert not any(name == "search_housing" for name, _ in client.calls)


def test_resolution_reason_survives_serialization_and_question_deduplication():
    missing = Question(field="property.near", text="Where?")
    resolution = Question(field="property.near", text="Not resolved", reason="location_not_found")
    assert Question.model_validate(resolution.model_dump()).reason == "location_not_found"
    assert unique_questions([missing, resolution]) == [resolution]
    assert unique_questions([resolution, missing]) == [resolution]


@pytest.mark.asyncio
@pytest.mark.parametrize("fast_path", [False, True])
async def test_reported_production_candidates_never_become_the_housing_location(fast_path):
    # Public POI response supplied by the user on 2026-10-18. No account/request identifiers.
    snapshot = json.loads(
        (Path(__file__).parents[1] / "fixtures/location/ocean-park-1-production-resolution.json").read_text(
            encoding="utf-8"
        )
    )
    assert len(snapshot["results"]) == 8
    # The UI map endpoint returns eight; the domain tool requests the first five.
    snapshot["results"] = snapshot["results"][:5]
    client = FakeToolClient({"search_areas": {"results": []}, "resolve_location": snapshot})
    adapter = LocationSubagent(client, AgentName.PROPERTY)
    agent = ReadLlmAgent("unused", "unused", adapter) if fast_path else adapter
    result = await agent.run(request().model_copy(update={"retrieval_only": True}))
    assert result.status == "needs_input" and result.questions[0].reason == "location_not_found"
    assert not result.questions[0].choices and not result.source_refs and not result.quotes
    assert result.data["location_resolution"] == {
        "field": "near",
        "status": "below_suggestion_threshold",
        "candidate_count": 5,
        "offered_count": 0,
    }
    assert result.usage.llm_calls == 0 and result.usage.provider_calls == 2
    assert [name for name, _ in client.calls] == ["search_areas", "resolve_location"]
    if fast_path:
        assert agent.llm_client is None
        assert result.data["agent_trace"]["implementation"] == "validated-filter-retrieval"


@pytest.mark.asyncio
async def test_actual_graph_preserves_resolution_reason_scope_and_budget_after_city_reply():
    correction = "Ở Hà Nội, giữ Ocean Park 1 và giá dưới 5 triệu"
    model = SequenceModel(
        [
            draft(MESSAGE, kind="new_goal", values={"near": "Ocean Park 1", "max_price_vnd": 5_000_000}),
            draft(correction, values={"city": "Hà Nội"}),
        ]
    )
    city = {
        "area_id": "hanoi",
        "name": "Hà Nội",
        "match_type": "exact",
        "bounding_box": {"west": 105, "south": 20, "east": 106, "north": 22},
    }
    client = FakeToolClient(
        {
            "search_areas": lambda args: {"results": [city] if args["text"] == "Hà Nội" else []},
            "resolve_location": {"results": []},
        }
    )
    agent = ReadLlmAgent("unused", "unused", LocationSubagent(client, AgentName.PROPERTY))
    planner = Model()
    session = Session(
        test_deps(
            intake=LlmIntake(model, max_calls=1),
            planner=LlmPlanner(planner, BASELINE_CAPABILITIES),
            agents=AgentRegistry({AgentName.PROPERTY: agent}),
        )
    )
    for text in (MESSAGE, correction):
        result = await session.say(text)
        assert result["response"].kind == "CLARIFY"
        assert result["response"].questions[0].reason == "location_not_found"
        assert result["intake"].constraints.values["near"] == "Ocean Park 1"
        assert result["intake"].constraints.values["max_price_vnd"] == 5_000_000
    assert result["intake"].constraints.values["city"] == "Hà Nội"
    assert agent.llm_client is None and not planner.calls
    assert len(model.calls) == 2  # existing semantic Intake only, no new classifier or repair
    assert not any(name == "search_housing" for name, _ in client.calls)
