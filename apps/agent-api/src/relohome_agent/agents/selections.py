"""Read-only selection validity shared by UI projections and conversation memory.

Remembering a choice is not proof that its result or price remains usable.
Receipts live in ``committed`` and are deliberately not interpreted as quotes.
"""

from datetime import datetime
from typing import Any

from relohome_agent.agents.common import utcnow
from relohome_agent.agents.models import AgentName, TaskResult, TaskStatus


def option_ids(result: TaskResult | None) -> set[str]:
    if result is None:
        return set()
    ids = {q.option_id for q in result.quotes}
    for items in result.data.values():
        if isinstance(items, list):
            ids |= {str(i.get("id") or i.get("option_id")) for i in items if isinstance(i, dict)}
    ids.discard("None")
    return ids


# Round trip: the payable choice is an itinerary in `return_options` (payment-design §8.2).
OPTION_KEYS = {
    AgentName.PROPERTY: ("candidates",),
    AgentName.FLIGHT: ("offers", "return_options"),
    AgentName.RELOCATION: ("quotes",),
}


def selected_option(result: TaskResult, option_id: str) -> dict[str, Any]:
    keys = OPTION_KEYS.get(result.agent)
    collections = [result.data.get(key, []) for key in keys] if keys else result.data.values()
    for items in collections:
        if isinstance(items, list):
            for item in items:
                if isinstance(item, dict) and option_id in (item.get("id"), item.get("option_id")):
                    return item
    return {}


def option_is_expired(result: TaskResult, option_id: str | None = None, *, now: datetime | None = None) -> bool:
    """Check the selected offer, not an arbitrary sibling's expiration.

    Flight and Moving prices must have a parseable, timezone-aware deadline.
    An explicit invalid option-level deadline must not fall back to another one.
    Housing has no mandatory price TTL; an explicit deadline is still respected.
    """
    option = selected_option(result, option_id) if option_id is not None else {}
    raw = option.get("expires_at") if "expires_at" in option else result.data.get("expires_at")
    if raw is None and "expires_at" not in option and "expires_at" not in result.data:
        return result.agent in {AgentName.FLIGHT, AgentName.RELOCATION}
    try:
        deadline = raw if isinstance(raw, datetime) else datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except (AttributeError, TypeError, ValueError):
        return True
    return deadline.tzinfo is None or deadline <= (now or utcnow())


def selection_is_current(values: dict, task_id: str, option_id: str) -> bool:
    result: TaskResult | None = (values.get("task_results") or {}).get(task_id)
    if (
        result is None
        or bool(result.data.get("comparison"))
        or result.task_id != task_id
        or result.status != "done"
        or (values.get("task_status") or {}).get(task_id) != TaskStatus.DONE
        or option_id not in option_ids(result)
    ):
        return False
    plan = values.get("plan")
    task = plan.task(task_id) if plan else None
    historical = (values.get("goal_tasks") or {}).get(task_id)
    expected_agent = task.agent if task else historical.get("agent") if historical else None
    if expected_agent is not None and expected_agent != result.agent:
        return False
    return not option_is_expired(result, option_id)
