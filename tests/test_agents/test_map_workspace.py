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


# --- Follow-ups of the khoa retest (K-01..K-03) ---


def plan_errors(tasks, values, domains):
    planner = LlmPlanner(None, BASELINE_CAPABILITIES)
    drafts = [
        TaskDraft(
            id=t["id"],
            agent=t["agent"],
            inputs_json=json.dumps(t["inputs"]),
            depends_on=t.get("deps", []),
            required=True,
        )
        for t in tasks
    ]
    inp = planner_input(values, domains)
    plan = planner._convert(PlanDraft(tasks=drafts, actions=[], needs_input=[]), inp)
    return plan, LlmPlanner._grounding_errors(plan, inp)


def test_route_task_is_not_forced_to_carry_a_previous_nearby_anchor():
    # K-02: turn 1 searched pharmacies near a place, turn 2 asks a route; map_near is still in constraints.
    values = {
        "map_mode": "route",
        "map_near": "Văn Miếu - Quốc Tử Giám",
        "route_from": "Văn Miếu - Quốc Tử Giám",
        "route_to": "Nhà hát Lớn Hà Nội",
        "city": "Hà Nội",
        "route_profile": "walking",
        "nearby_categories": ["pharmacy"],
    }
    route = {k: values[k] for k in ("map_mode", "route_from", "route_to", "city", "route_profile")}
    _, errors = plan_errors([{"id": "m", "agent": AgentName.MAP, "inputs": route}], values, [AgentName.MAP])
    assert errors == []


def test_amenity_near_homes_is_a_housing_filter_not_a_map_task():
    # "gần bệnh viện" while searching homes: the Housing task must carry the proximity filter.
    values = {"city": "Hà Nội", "max_price_vnd": 5_000_000, "nearby_categories": ["hospital"]}
    home = {"id": "home", "agent": AgentName.PROPERTY, "inputs": {"city": "Hà Nội", "max_price_vnd": 5_000_000}}
    _, errors = plan_errors([home], values, [AgentName.PROPERTY])
    assert errors == ["home: omitted user constraint nearby_categories"]
    home["inputs"]["nearby_categories"] = ["hospital"]
    _, errors = plan_errors([home], values, [AgentName.PROPERTY])
    assert errors == []


def test_map_bound_to_housing_results_drops_a_named_anchor():
    # K-01 (directions-free Map nearby kept for old plans): a Housing dependency is the origin.
    values = {"city": "Hà Nội", "max_price_vnd": 5_000_000}
    tasks = [
        {"id": "home", "agent": AgentName.PROPERTY, "inputs": {"city": "Hà Nội", "max_price_vnd": 5_000_000}},
        {
            "id": "near",
            "agent": AgentName.MAP,
            "inputs": {"categories": ["supermarket"], "radius_m": 1500, "near": "các phòng đó"},
            "deps": ["home"],
        },
    ]
    plan, _ = plan_errors(tasks, {**values, "map_near": "các phòng đó"}, [AgentName.PROPERTY, AgentName.MAP])
    assert "near" not in plan.task("near").inputs


def test_intake_rejects_bounds_that_exclude_every_listing():
    # K-03: "ưu tiên phòng rộng nhất" must not become max_area_m2=0; the capability schema decides.
    from src.agents.intake_llm import valid_value

    assert not valid_value("max_area_m2", 0) and not valid_value("max_price_vnd", 0)
    assert valid_value("max_area_m2", 30) and valid_value("max_bedrooms", 0) and valid_value("min_area_m2", 0)


def test_amenity_request_in_a_housing_goal_becomes_a_housing_filter():
    from src.agents.intake import IntakeInput
    from src.agents.intake_llm import IntakeDraft, LlmIntake

    draft = IntakeDraft(
        kind="new_goal",
        normalized_goal="x",
        intent_name="x",
        domains=[AgentName.PROPERTY, AgentName.MAP],
        requested_actions=[],
        facts=[
            {"key": "city", "value": "Hà Nội", "evidence": "Hà Nội", "suggestion_key": None},
            {"key": "map_near", "value": "các phòng đó", "evidence": "các phòng đó", "suggestion_key": None},
            {"key": "nearby_categories", "value": ["supermarket"], "evidence": "siêu thị", "suggestion_key": None},
        ],
        unsupported_reason=None,
        drops_previous_goal=False,
        map_origin="housing_results",
        conflicts=[],
        change_request=None,
        target_task_ids=[],
        declined_suggestions=[],
    )
    inp = IntakeInput(messages=[], session=SessionContext(), supported_domains=[AgentName.PROPERTY, AgentName.MAP])
    result, _ = LlmIntake(None)._convert(draft, inp, "Tìm phòng ở Hà Nội và siêu thị gần các phòng đó")
    # Amenities are not a Map service: the Map domain is dropped, the proximity stays as a Housing filter.
    assert result.domains == [AgentName.PROPERTY]
    assert "map_near" not in result.user_confirmed_facts
    assert result.constraints.values["nearby_categories"] == ["supermarket"]


def test_fact_schema_check_only_applies_to_the_same_shaped_field():
    from src.agents.intake_llm import valid_value

    assert valid_value("passengers", 1)  # fact is a count; Flight's input is {adults: n}


def test_echoed_reference_labels_are_entities_not_places():
    from src.agents.intake import entity_reference

    assert entity_reference("housing_results") == "upstream:property"
    assert entity_reference("selected:property") == "selected:property"
    assert entity_reference("Đại học Bách khoa Hà Nội") is None


def test_completed_task_of_a_requested_domain_is_kept_when_the_model_leaves_it_out():
    from src.agents.models import Plan, Task, TaskResult

    values = {"origin": "Đà Nẵng", "destination": "Hà Nội", "flight_date": "2026-10-04", "moving_mode": "catalog"}
    flight_inputs = {"origin": "Đà Nẵng", "destination": "Hà Nội", "date": "2026-10-04", "passengers": {"adults": 1}}
    old = Plan(version=1, tasks=[Task(id="fly", agent=AgentName.FLIGHT, inputs=flight_inputs)])
    done = TaskResult(
        task_id="fly", agent=AgentName.FLIGHT, plan_version=1, status="done", fetched_at=utcnow(), data={"offers": []}
    )
    domains = [AgentName.FLIGHT, AgentName.RELOCATION]
    inp = planner_input(values, domains).model_copy(update={"previous_plan": old, "previous_results": {"fly": done}})
    planner = LlmPlanner(None, BASELINE_CAPABILITIES)
    draft = TaskDraft(
        id="move", agent=AgentName.RELOCATION, inputs_json='{"mode": "catalog"}', depends_on=[], required=True
    )
    plan = planner._convert(PlanDraft(tasks=[draft], actions=[], needs_input=[]), inp)
    assert [t.id for t in plan.tasks] == ["fly", "move"]
    # Changed constraints: the old flight no longer matches, so it is not silently reused.
    changed = inp.model_copy(update={"intake": planner_input({**values, "flight_date": "2026-10-09"}, domains).intake})
    assert [t.id for t in planner._convert(PlanDraft(tasks=[draft], actions=[], needs_input=[]), changed).tasks] == [
        "move"
    ]


def test_selected_listing_id_is_bound_from_state_not_from_the_draft():
    from src.agents.models import ConfirmedFact

    values = {
        "moving_mode": "quote",
        "from_address": "Đại học Bách khoa Hà Nội",
        "to_address": "selected:property",
        "move_date": "2026-10-04",
        "move_time": "17:00",
    }
    facts = {"selected:property": ConfirmedFact(value="home-1", evidence="chọn", stated_at=utcnow())}
    inp = planner_input(values, [AgentName.RELOCATION])
    inp = inp.model_copy(update={"intake": inp.intake.model_copy(update={"user_confirmed_facts": facts})})
    planner = LlmPlanner(None, BASELINE_CAPABILITIES)
    wrong = {**values, "mode": "quote", "selected_listing_id": "property_search"}  # model wrote the task id
    wrong.pop("moving_mode")
    draft = TaskDraft(
        id="move", agent=AgentName.RELOCATION, inputs_json=json.dumps(wrong), depends_on=[], required=True
    )
    plan = planner._convert(PlanDraft(tasks=[draft], actions=[], needs_input=[]), inp)
    assert plan.task("move").inputs["selected_listing_id"] == "home-1"
    assert LlmPlanner._grounding_errors(plan, inp) == []


def test_adding_a_service_to_an_unabandoned_goal_keeps_it():
    from src.agents.intake import IntakeInput
    from src.agents.intake_llm import IntakeDraft, LlmIntake

    def draft(drops):
        return IntakeDraft(
            kind="new_goal",
            normalized_goal="x",
            intent_name="x",
            domains=[AgentName.FLIGHT],
            requested_actions=[],
            facts=[{"key": "origin", "value": "Hà Nội", "evidence": "Hà Nội", "suggestion_key": None}],
            unsupported_reason=None,
            drops_previous_goal=drops,
            map_origin="none",
            conflicts=[],
            change_request=None,
            target_task_ids=[],
            declined_suggestions=[],
        )

    previous = intake_result(RequestKind.NEW_GOAL, [AgentName.PROPERTY], values={"city": "Đà Nẵng"})
    inp = IntakeInput(messages=[], session=SessionContext(), supported_domains=list(AgentName), previous=previous)
    kept, _ = LlmIntake(None)._convert(draft(False), inp, "tìm vé bay từ Hà Nội vào Đà Nẵng")
    assert kept.kind == RequestKind.REFINE and kept.domains == [AgentName.PROPERTY, AgentName.FLIGHT]
    dropped, _ = LlmIntake(None)._convert(draft(True), inp, "thôi không tìm nhà nữa, vé bay từ Hà Nội")
    assert dropped.kind == RequestKind.NEW_GOAL and dropped.domains == [AgentName.FLIGHT]


def test_reference_codes_are_not_dropped_as_personal_data():
    from src.agents.intake import ground_facts
    from src.agents.models import ConfirmedFact

    code = {"payment_id": ConfirmedFact(value="ZP123456789", evidence="ZP123456789", stated_at=utcnow())}
    assert list(ground_facts(code, {}, RequestKind.NEW_GOAL, ["thanh toán mã ZP123456789"], []).facts) == ["payment_id"]
    phone = {"payment_id": ConfirmedFact(value="0901234567", evidence="0901234567", stated_at=utcnow())}
    assert ground_facts(phone, {}, RequestKind.NEW_GOAL, ["mã 0901234567"], []).dropped == ["payment_id"]


def test_catalog_answer_matches_the_asked_city_across_spelling():
    from src.agents.nodes.respond import describe_result

    cities = {"cities": [{"city_id": "HAN", "city_name": "Hanoi"}, {"city_id": "VCA", "city_name": "Can Tho"}]}
    assert describe_result(AgentName.RELOCATION, cities, None, "Cần Thơ")[0] == "AhaMove có phục vụ Cần Thơ (Can Tho)."
    assert describe_result(AgentName.RELOCATION, cities, None, "Cà Mau")[0].endswith("không có Cà Mau.")
