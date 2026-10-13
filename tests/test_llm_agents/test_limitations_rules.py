"""Pure contract/policy tests: no mock clients, provider data or LLM responses."""

from relohome_agent.agents.common import utcnow
from relohome_agent.agents.intake import missing_for
from relohome_agent.agents.intake_llm import valid_value
from relohome_agent.agents.memory import memory_updates
from relohome_agent.agents.models import (
    AgentName,
    ConfirmedFact,
    Constraints,
    IntakeResult,
    Intent,
    Plan,
    Question,
    RequestKind,
    Task,
    TaskStatus,
)
from relohome_agent.agents.nodes.change_impact import selection_impact
from relohome_agent.agents.subagents.capabilities import PROPERTY
from relohome_agent.agents.subagents.services.location import pick_place


def intake(domain, values):
    return IntakeResult(
        kind=RequestKind.NEW_GOAL,
        intent=Intent(name=domain.value, domains=[domain]),
        constraints=Constraints(values=values),
        user_confirmed_facts={
            key: ConfirmedFact(value=value, evidence=str(value), stated_at=utcnow()) for key, value in values.items()
        },
    )


def test_map_request_cannot_become_housing_preferences():
    values = {"near": "địa điểm người dùng yêu cầu tra tiện ích", "city": "thành phố người dùng nêu"}
    state = {
        "intake": intake(AgentName.MAP, values),
        "plan": Plan(version=1, tasks=[Task(id="map", agent=AgentName.MAP, inputs=values)]),
        "task_status": {"map": TaskStatus.DONE},
    }
    assert memory_updates(state) == []
    state["plan"] = Plan(version=1, tasks=[Task(id="housing", agent=AgentName.PROPERTY, inputs=values)])
    state["task_status"] = {"housing": TaskStatus.DONE}
    assert {u.key for u in memory_updates(state)} == set(values)


def test_catalog_has_no_quote_requirements_and_valid_selector():
    assert valid_value("moving_mode", "catalog")
    assert not valid_value("moving_mode", "create_order")
    assert missing_for(AgentName.RELOCATION, {"moving_mode": "catalog"}, set(), {}) == []
    assert missing_for(AgentName.RELOCATION, {"moving_mode": "quote"}, set(), {})


def test_district_is_valid_scope_not_a_guessed_city():
    from jsonschema import Draft202012Validator

    values = {"district": "quận do người dùng nêu"}
    assert missing_for(AgentName.PROPERTY, values, set(), {}) == []
    assert Draft202012Validator(PROPERTY.input_schema).is_valid(values)


def test_selection_invalidates_direct_entity_references_and_descendants():
    plan = Plan(
        version=1,
        tasks=[
            Task(id="housing", agent=AgentName.PROPERTY),
            Task(id="map", agent=AgentName.MAP, inputs={"selected_listing_id": "previous-selection"}),
            Task(id="moving", agent=AgentName.RELOCATION, inputs={"selected_listing_id": "previous-selection"}),
            Task(id="dependent", agent=AgentName.MAP, depends_on=["map"]),
            Task(id="independent", agent=AgentName.FLIGHT),
        ],
    )
    assert selection_impact(plan, "housing", AgentName.PROPERTY, "previous-selection") == {
        "housing",
        "map",
        "moving",
        "dependent",
    }


def test_fuzzy_only_location_never_selected_automatically():
    # Empty structural input is sufficient: a fuzzy result must never reach coordinate access.
    assert pick_place([{"match_type": "fuzzy"}]) is None


def test_provider_date_alias_does_not_ask_twice():
    from relohome_agent.agents.nodes.respond import unique_questions

    questions = unique_questions(
        [
            Question(field="flight.flight_date", text="Bạn muốn bay ngày nào?"),
            Question(field="flight.date", text="Ngày bay?"),
            Question(field="relocation.move_date", text="Ngày chuyển đồ?"),
        ]
    )
    assert [q.field for q in questions] == ["flight.flight_date", "relocation.move_date"]


def test_new_domain_referencing_confirmed_house_is_continuation():
    from relohome_agent.agents.nodes.intake import continue_referenced_goal

    previous = intake(AgentName.PROPERTY, {"selected:property": "user-confirmed-listing"})
    moving = intake(AgentName.RELOCATION, {"to_address": "selected:property"})
    assert continue_referenced_goal(moving, previous).kind == RequestKind.REFINE
    assert continue_referenced_goal(moving, None).kind == RequestKind.NEW_GOAL
    independent = intake(AgentName.RELOCATION, {"to_address": "new explicit address"})
    assert continue_referenced_goal(independent, previous).kind == RequestKind.NEW_GOAL


def test_independent_map_anchor_never_narrows_housing():
    from relohome_agent.agents.planning import TemplatePlanner

    values = {
        "city": "phạm vi Housing người dùng nêu",
        "map_near": "điểm Map người dùng nêu",
        "nearby_categories": ["hospital"],
    }
    request = intake(AgentName.MAP, values)
    housing_inputs, _ = TemplatePlanner._inputs(AgentName.PROPERTY, values, request)
    map_inputs, dependency = TemplatePlanner._inputs(AgentName.MAP, values, request)
    assert "near" not in housing_inputs and "map_near" not in housing_inputs
    assert map_inputs["near"] == values["map_near"] and not dependency
    assert not missing_for(AgentName.MAP, values, {AgentName.PROPERTY}, {})
