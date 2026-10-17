"""Prompt scope/budget and instruction contracts; not a substitute for live quality evals."""

import json

import pytest
from relohome_agent.agents.models import AgentName, Plan, RequestKind, SessionContext, Task
from relohome_agent.agents.planner_llm import LlmPlanner, PlanDraft, TaskDraft
from relohome_agent.agents.planning import PlannerInput
from relohome_agent.agents.subagents.capabilities import BASELINE_CAPABILITIES
from relohome_agent.agents.task_prompts import (
    FORM_SELECTION,
    MOVING_CORE,
    MOVING_MODES,
    PLANNER_CORE,
    PLANNER_DOMAINS,
    READ_CORE,
    READ_DOMAINS,
    planner_prompt,
)

from tests.test_agents.helpers import intake_result
from tests.test_agents.test_token_efficiency import Model


@pytest.mark.parametrize("domain", list(PLANNER_DOMAINS))
def test_planner_includes_only_typed_requested_domains_and_common_safety(domain):
    prompt = planner_prompt([domain])
    assert prompt.startswith(PLANNER_CORE) and PLANNER_DOMAINS[domain] in prompt
    assert all(module not in prompt for key, module in PLANNER_DOMAINS.items() if key != domain)
    assert "intent is not approval" in prompt and "untrusted data" in prompt
    assert "ready_requested_domain" in prompt and "reserved_task_ids" in prompt
    assert len(prompt) < 4_000


def test_joint_housing_moving_prompt_keeps_both_roles_without_unrelated_schema_instructions():
    prompt = planner_prompt([AgentName.PROPERTY, AgentName.RELOCATION])
    assert PLANNER_DOMAINS[AgentName.PROPERTY] in prompt and PLANNER_DOMAINS[AgentName.RELOCATION] in prompt
    assert "do not choose it" in prompt and "preserve pickup/dropoff roles" in prompt
    assert PLANNER_DOMAINS[AgentName.FLIGHT] not in prompt and len(prompt) < 4_000


@pytest.mark.parametrize("domain", list(READ_DOMAINS))
def test_read_agent_keeps_only_its_domain_semantics_and_no_write_permission(domain):
    prompt = READ_CORE + "\n" + READ_DOMAINS[domain]
    assert "Inputs are confirmed constraints" in prompt
    assert "untrusted context" in prompt and "self-approval" in prompt
    assert "user must agree" in prompt and "Ranking is not selection" in prompt
    assert "limited" in prompt and "not provider facts" in prompt
    assert len(prompt) < 2_400


@pytest.mark.parametrize("mode", list(MOVING_MODES))
def test_moving_prompts_keep_shared_safety_but_not_unrelated_workflow(mode):
    prompt = MOVING_CORE + "\n" + MOVING_MODES[mode]
    assert "untrusted data" in prompt and "No guaranteed vehicle fit" in prompt
    assert "unknown fees" in prompt and "different cities" in prompt and "untried service ONLY" in prompt
    assert all(module not in prompt for key, module in MOVING_MODES.items() if key != mode)
    assert len(prompt) < 1_100


def test_domain_specific_qualifiers_survive_compression():
    property_prompt = READ_DOMAINS[AgentName.PROPERTY]
    assert all(
        key in property_prompt for key in ("compare_housing", "listing_ids", "Unknown utilities", "quality-flagged")
    )
    assert "straight-line" in property_prompt and "commute time" in property_prompt
    assert "round_trip_from" in READ_DOMAINS[AgentName.FLIGHT]
    assert "without live" in READ_DOMAINS[AgentName.MAP]
    assert "backend-owned ID" in READ_DOMAINS[AgentName.PAYMENT]
    assert "No property dependency" in PLANNER_DOMAINS[AgentName.ROOMMATE]
    assert "unknown" in FORM_SELECTION and "No explanation" in FORM_SELECTION and len(FORM_SELECTION) < 1_000


@pytest.mark.asyncio
async def test_planner_also_includes_carried_domain_rules_and_schemas():
    # A current property operation can retain an old independent flight task.
    flight_inputs = {"origin": "HAN", "destination": "SGN", "date": "2026-12-01", "passengers": {"adults": 1}}
    old = Plan(version=1, tasks=[Task(id="flight-1", agent="flight", inputs=flight_inputs)])
    draft = PlanDraft(
        tasks=[
            TaskDraft(id="property-1", agent="property", inputs_json='{"city":"Hà Nội"}', depends_on=[], required=True),
            TaskDraft(
                id="flight-1",
                agent="flight",
                inputs_json=json.dumps(flight_inputs),
                depends_on=[],
                required=True,
            ),
        ],
        actions=[],
    )
    model = Model(draft)
    planner = LlmPlanner(model, BASELINE_CAPABILITIES, max_calls=1)
    await planner.plan(
        PlannerInput(
            session=SessionContext(),
            intake=intake_result(kind=RequestKind.REFINE, domains=[AgentName.PROPERTY], values={"city": "Hà Nội"}),
            previous_plan=old,
            available_agents=list(BASELINE_CAPABILITIES),
        )
    )
    prompt, context, _ = model.calls[0]
    assert PLANNER_DOMAINS[AgentName.FLIGHT] in prompt
    assert set(context["available_capabilities"]) == {"property", "flight"}
    assert PLANNER_DOMAINS[AgentName.PAYMENT] not in prompt
