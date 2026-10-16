"""Narrow read-only optimization after semantic Intake, never keyword routing.

The ordinary planner and domain LLM remain responsible for comparisons, custom
assessment, changes and multi-service dependencies. Old checkpoints default off.
"""

from relohome_agent.agents.housing_constraints import HOUSING_INPUT_KEYS
from relohome_agent.agents.models import AgentName, IntakeResult, RequestKind


def is_filter_search(intake: IntakeResult) -> bool:
    return bool(
        intake.retrieval_only
        and intake.kind == RequestKind.NEW_GOAL
        and intake.domains == [AgentName.PROPERTY]
        and not intake.needs_clarification
        and not intake.constraints.missing
        and not intake.commit_requested
        and not intake.unavailable_commit_requested
        and not intake.prefilled
        and not intake.target_task_ids
        and not intake.change_request
        and not intake.declined_suggestions
        and not any(key.startswith("selected:") for key in intake.user_confirmed_facts)
        and intake.constraints.values.get("housing_mode", "search") == "search"
        and "listing_ids" not in intake.constraints.values
        and set(intake.constraints.values) <= set(HOUSING_INPUT_KEYS)
    )
