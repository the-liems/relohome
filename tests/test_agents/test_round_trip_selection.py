"""A round-trip itinerary chosen from `return_options` is a current, priced selection."""

from datetime import timedelta

from relohome_agent.agents.common import utcnow
from relohome_agent.agents.models import AgentName, TaskResult, TaskStatus
from relohome_agent.agents.selections import option_is_expired, selected_option, selection_is_current


def flight_result(expires_in):
    now = utcnow()
    return TaskResult(
        task_id="flight-1",
        agent=AgentName.FLIGHT,
        plan_version=1,
        status="done",
        data={
            "trip_type": "round_trip",
            "offers": [{"id": "off_serp_rto_a", "kind": "round_trip_outbound", "expires_at": now.isoformat()}],
            "return_options": [
                {"id": "off_serp_rt_b", "kind": "round_trip", "expires_at": (now + expires_in).isoformat()}
            ],
        },
        source_kind="live",
        fetched_at=now,
    )


def test_itinerary_in_return_options_is_found_and_uses_its_own_deadline():
    result = flight_result(timedelta(minutes=20))
    assert selected_option(result, "off_serp_rt_b")["kind"] == "round_trip"
    assert option_is_expired(result, "off_serp_rt_b") is False
    values = {"task_results": {"flight-1": result}, "task_status": {"flight-1": TaskStatus.DONE}}
    assert selection_is_current(values, "flight-1", "off_serp_rt_b")


def test_expired_itinerary_is_not_current():
    result = flight_result(timedelta(minutes=-1))
    assert option_is_expired(result, "off_serp_rt_b") is True
