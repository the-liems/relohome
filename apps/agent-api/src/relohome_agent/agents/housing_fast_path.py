"""Narrow read-only optimization after semantic Intake, never keyword routing.

The ordinary planner and domain LLM remain responsible for comparisons, custom
assessment and multi-service dependencies. Old checkpoints default off.
"""

from typing import TYPE_CHECKING

from relohome_agent.agents.housing_constraints import HOUSING_INPUT_KEYS
from relohome_agent.agents.models import AgentName, IntakeResult, RequestKind, Task

if TYPE_CHECKING:
    from relohome_agent.agents.planning import PlannerInput


def is_filter_search(intake: IntakeResult) -> bool:
    return (
        intake.kind == RequestKind.NEW_GOAL
        and is_filter_retrieval(intake)
        and not intake.target_task_ids
        and not intake.change_request
    )


def is_filter_retrieval(intake: IntakeResult) -> bool:
    return bool(
        intake.retrieval_only
        and intake.kind in {RequestKind.NEW_GOAL, RequestKind.REFINE, RequestKind.CHANGE}
        and intake.domains == [AgentName.PROPERTY]
        and not intake.needs_clarification
        and not intake.constraints.missing
        and not intake.commit_requested
        and not intake.unavailable_commit_requested
        and not intake.prefilled
        and not intake.declined_suggestions
        and intake.housing_filter_patch is None
        and not any(key.startswith("selected:") for key in intake.user_confirmed_facts)
        and intake.constraints.values.get("housing_mode", "search") == "search"
        and "listing_ids" not in intake.constraints.values
        and set(intake.constraints.values) <= set(HOUSING_INPUT_KEYS)
    )


def filter_followup_task(inp: "PlannerInput") -> Task | None:
    """Return the sole active search only when no other workflow can be affected.

    Called inside the planner; semantic Intake has already merged/grounded the
    filter delta. This does not approve transactions or suppress change-impact.
    """
    intake, previous = inp.intake, inp.previous_plan
    if (
        intake.kind not in {RequestKind.REFINE, RequestKind.CHANGE}
        or not is_filter_retrieval(intake)
        or previous is None
        or len(previous.tasks) != 1
        or previous.commit_actions
        or inp.committed
        or inp.validation is not None
    ):
        return None
    old = previous.tasks[0]
    if (
        old.agent != AgentName.PROPERTY
        or old.depends_on
        or old.inputs.get("housing_mode", "search") != "search"
        or "listing_ids" in old.inputs
        or set(old.inputs) - set(HOUSING_INPUT_KEYS)
        or set(intake.target_task_ids) - {old.id}
        or any(
            result.agent != AgentName.PROPERTY or result.data.get("comparison")
            for result in inp.previous_results.values()
        )
    ):
        return None
    change = inp.change_context
    if change and (change.blocked_by_commit or set(change.invalidated_task_ids + change.reusable_task_ids) - {old.id}):
        return None
    return old
