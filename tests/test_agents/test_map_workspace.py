"""Map workspace backend rules: place grouping, structured choices, viewport, trusted map inputs, ranking.

Pure functions plus an in-process fake LLM transport for the ranking rule; no provider is mocked as live data.
"""

import json
from types import SimpleNamespace
from uuid import uuid4

import pytest
from pydantic import ValidationError

from src.agents.common import utcnow
from src.agents.contracts import AgentTaskRequest, AgentTaskResult
from src.agents.models import AgentBudget, AgentName, Quote, RequestKind, SessionContext
from src.agents.planner_llm import LlmPlanner, PlanDraft, TaskDraft
from src.agents.planning import PlannerInput
from src.agents.subagents.capabilities import BASELINE_CAPABILITIES, PROPERTY
from src.agents.subagents.services.location import (
    bbox_around,
    bbox_of_points,
    location_choices,
    pick_place,
)
from src.agents.subagents.services.read_llm import ReadLlmAgent
from src.models.schemas import ChatRequest
from tests.test_agents.helpers import intake_result


def place(pid, name, lat, lng, source, match="exact"):
    return {
        "entity_type": "place",
        "canonical_id": pid,
        "name": name,
        "category": "marketplace",
        "location": {"lat": lat, "lng": lng},
        "source": {"source_id": source},
        "match_type": match,
        "match_score": 1.0 if match == "exact" else 0.5,
    }


# --- Place grouping: duplicates of one destination vs real ambiguity ---


def test_exact_duplicates_within_radius_are_one_destination_with_richest_geometry():
    node = place("p1", "Chợ A", 16.06824, 108.22458, "node/1")
    area = place("p2", "Chợ A", 16.06835, 108.22428, "area/2")  # ~35 m away
    assert pick_place([node, area])["canonical_id"] == "p2"


def test_exact_matches_far_apart_stay_ambiguous_and_carry_choices():
    a = place("p1", "Bưu điện", 10.7800, 106.7000, "way/1")
    b = place("p2", "Bưu điện", 10.8200, 106.7300, "way/2")  # several km away
    assert pick_place([a, b]) is None
    choices = location_choices([a, b])
    assert [c.id for c in choices] == ["p1", "p2"] and choices[0].lat == 10.78


def test_bbox_helpers_cover_center_and_points():
    box = bbox_around({"lat": 21.0, "lng": 105.8}, 1000)
    assert box["west"] < 105.8 < box["east"] and box["south"] < 21.0 < box["north"]
    assert bbox_of_points([]) is None
    pts = bbox_of_points([{"lat": 21.0, "lng": 105.8}, {"lat": 21.01, "lng": 105.82}])
    assert pts["west"] <= 105.8 and pts["east"] >= 105.82


# --- API validation of map view / place choice ---


def test_chat_request_validates_map_view_and_place_choice():
    ok = ChatRequest(
        message="khu này",
        map_view={"bounding_box": {"west": 105.7, "south": 20.9, "east": 105.9, "north": 21.1}, "zoom": 14},
        place_choice={"field": "route_to", "place_id": "p1"},
    )
    assert ok.map_view.zoom == 14
    for bad in (
        {"bounding_box": {"west": 106, "south": 21, "east": 105, "north": 22}, "zoom": 14},  # inverted
        {"bounding_box": {"west": 100, "south": 10, "east": 108, "north": 22}, "zoom": 5},  # whole country
    ):
        with pytest.raises(ValidationError):
            ChatRequest(message="x", map_view=bad)
    with pytest.raises(ValidationError):
        ChatRequest(message="x", place_choice={"field": "from_address", "place_id": "p1"})


# --- Planner binds trusted map inputs; the model cannot invent them ---

BOX = {"west": 105.7, "south": 20.9, "east": 105.9, "north": 21.1}


def planner_input(values, domains=(AgentName.PROPERTY,)):
    intake = intake_result(RequestKind.REFINE, domains=list(domains), values=values)
    return PlannerInput(intake=intake, session=SessionContext(), available_agents=list(domains))


def convert(inputs, values, agent=AgentName.PROPERTY):
    planner = LlmPlanner(None, BASELINE_CAPABILITIES)
    task = TaskDraft(id="t", agent=agent, inputs_json=json.dumps(inputs), depends_on=[], required=True)
    plan = planner._convert(PlanDraft(tasks=[task], actions=[], needs_input=[]), planner_input(values, [agent]))
    return plan.tasks[0].inputs


def test_planner_injects_map_view_and_drops_invented_box():
    assert convert({"max_price_vnd": 1}, {"bounding_box": BOX, "max_price_vnd": 1})["bounding_box"] == BOX
    invented = {**BOX, "west": 105.0}
    assert "bounding_box" not in convert({"city": "Hà Nội", "bounding_box": invented}, {"city": "Hà Nội"})


def test_planner_binds_chosen_place_only_to_the_same_endpoint_text():
    values = {"map_mode": "route", "route_from": "A", "route_to": "Chợ Hàn", "route_to_place_id": "p2"}
    task = {"map_mode": "route", "route_from": "A", "route_to": "Chợ Hàn", "city": "Đà Nẵng"}
    assert convert(task, values, AgentName.MAP)["route_to_place_id"] == "p2"
    renamed = {**task, "route_to": "Cầu Rồng", "route_to_place_id": "p2"}
    assert "route_to_place_id" not in convert(renamed, values, AgentName.MAP)


def test_confirmed_moving_pin_fixes_the_endpoint_even_over_the_selected_home_marker():
    gate = {"lat": 21.0301, "lng": 105.7802}
    values = {
        "from_address": "Đại học Bách khoa Hà Nội",
        "to_address": "Đường Mễ Trì, Cầu Giấy",
        "destination_coordinate": gate,
        "move_date": "2026-10-03",
        "move_time": "10:00",
    }
    task = {**values, "mode": "quote", "to_address": "selected:property"}
    task.pop("destination_coordinate")
    out = convert(task, values, AgentName.RELOCATION)
    assert out["to_address"] == "Đường Mễ Trì, Cầu Giấy" and out["destination_coordinate"] == gate
    assert "pickup_coordinate" not in out
    # Without a confirmed point the marker stays for Moving to read the chosen home itself.
    plain = {k: v for k, v in values.items() if k != "destination_coordinate"}
    assert convert({**task}, {**plain, "to_address": "selected:property"}, AgentName.RELOCATION)["to_address"] == (
        "selected:property"
    )


# --- Domain ranking: a partial order is a priority prefix, never a failure ---


class FakeResponses:
    def __init__(self, replies):
        self.replies = list(replies)

    async def create(self, **_):
        return self.replies.pop(0)


def call(name, arguments):
    item = SimpleNamespace(type="function_call", name=name, arguments=json.dumps(arguments), call_id=uuid4().hex)
    return SimpleNamespace(status="completed", output=[item], usage=None)


class FakeHousing:
    capability = PROPERTY
    client = None

    async def run(self, req):
        rows = [{"id": i, "title": i, "price_vnd": 1} for i in ("a", "b", "c")]
        return AgentTaskResult(
            task_id=req.task_id,
            plan_version=req.plan_version,
            status="done",
            data={"candidates": rows},
            quotes=[Quote(option_id=i, label=i, amount_vnd=1, recurrence="monthly") for i in ("a", "b", "c")],
            source="lifeflow-location",
            source_kind="live",
            fetched_at=utcnow(),
        )


@pytest.mark.asyncio
async def test_partial_ranking_keeps_every_observed_option():
    agent = ReadLlmAgent("sk-test-local", "test-model", FakeHousing())
    agent.llm_client = SimpleNamespace(
        responses=FakeResponses([call("search_housing", {}), call("finish", {"option_ids": ["c"]})])
    )
    req = AgentTaskRequest(
        request_id="r",
        thread_id="t",
        task_id="property",
        plan_version=1,
        attempt=1,
        agent=AgentName.PROPERTY,
        inputs={"city": "Hà Nội"},
        budget=AgentBudget(max_llm_calls=4, max_provider_calls=6),
    )
    result = await agent.run(req)
    assert result.status == "done"
    assert [r["id"] for r in result.data["candidates"]] == ["c", "a", "b"]
    assert [q.option_id for q in result.quotes] == ["c", "a", "b"]


@pytest.mark.asyncio
async def test_viewport_ignores_fuzzy_district_and_uses_returned_listings():
    from src.agents.subagents.services.common import CountingClient
    from src.agents.subagents.services.location import LocationSubagent

    class Areas:
        async def call(self, tool, args):
            # Snapshot without a polygon for a legacy district: only fuzzy neighbours elsewhere.
            return {
                "results": [
                    {
                        "area_id": "x",
                        "name": "Xã Khác",
                        "match_type": "fuzzy",
                        "match_score": 0.4,
                        "bounding_box": {"west": 107, "south": 11, "east": 107.2, "north": 11.2},
                    }
                ]
            }

    agent = LocationSubagent(Areas(), AgentName.PROPERTY)
    homes = [{"lat": 10.78, "lng": 106.68}, {"lat": 10.785, "lng": 106.69}]
    box = await agent._viewport(
        CountingClient(Areas(), 3),
        {"administrative_area_ids": ["hcm"]},
        {"district": "Quận 3"},
        homes,
        {"west": 105, "south": 8, "east": 108, "north": 11.5},
    )
    assert 106.6 < box["west"] < 106.7 and box["east"] < 106.75, box
