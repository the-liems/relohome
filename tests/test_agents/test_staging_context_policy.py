"""Pure policy regressions: no mocked LLM, tools, provider records or database."""

from datetime import UTC, datetime, timedelta

import pytest
from relohome_agent.agents.deps import GraphSettings
from relohome_agent.agents.location_names import city_search_text
from relohome_agent.agents.memory import prefill_from_memory
from relohome_agent.agents.models import (
    AgentName,
    IntakeResult,
    MemoryValue,
    Outcome,
    OutcomeCode,
    Plan,
    PrefilledValue,
    Question,
    RequestKind,
    SessionContext,
    Task,
    TaskStatus,
)
from relohome_agent.agents.nodes.respond import compose, moving_destination_question

AT = datetime(2026, 10, 11, 3, tzinfo=UTC)


@pytest.mark.parametrize(
    "value,expected",
    [
        ("hanoi", "Hà Nội"),
        ("HANOI", "Hà Nội"),
        ("hcm", "Hồ Chí Minh"),
        ("danang", "Đà Nẵng"),
        ("Phường Cầu Giấy", "Phường Cầu Giấy"),
        ("Đại học VinUni Hà Nội", "Đại học VinUni Hà Nội"),
        ("Hà Nội", "Hà Nội"),
        ("Hanoi University", "Hanoi University"),
    ],
)
def test_only_supported_city_ids_are_translated(value, expected):
    assert city_search_text(value) == expected


def remembered(value):
    return MemoryValue(value=value, stated_at=AT, last_confirmed_at=AT)


def test_budget_is_not_inherited_when_named_district_changes():
    session = SessionContext(
        preferences={
            "city": remembered("Hà Nội"),
            "district": remembered("Hai Bà Trưng"),
            "max_price_vnd": remembered(5_000_000),
        }
    )
    args = (session, [AgentName.PROPERTY], {AgentName.PROPERTY: "cheap"}, GraphSettings().prefill_ttl, AT)
    assert "max_price_vnd" not in prefill_from_memory({"city": "Hà Nội", "district": "Cầu Giấy"}, *args)
    assert "max_price_vnd" not in prefill_from_memory({"city": "Hà Nội", "district": "Hai Bà Trưng"}, *args)


def test_unknown_district_history_cannot_authorize_a_budget_for_a_new_named_area():
    session = SessionContext(preferences={"city": remembered("Hà Nội"), "max_price_vnd": remembered(5_000_000)})
    result = prefill_from_memory(
        {"city": "Hà Nội", "district": "Cầu Giấy"},
        session,
        [AgentName.PROPERTY],
        {AgentName.PROPERTY: "cheap"},
        GraphSettings().prefill_ttl,
        AT,
    )
    assert "max_price_vnd" not in result


def test_district_does_not_follow_a_changed_city():
    session = SessionContext(preferences={"city": remembered("Hà Nội"), "district": remembered("Cầu Giấy")})
    result = prefill_from_memory(
        {"city": "Đà Nẵng"},
        session,
        [AgentName.PROPERTY],
        {AgentName.PROPERTY: "cheap"},
        GraphSettings().prefill_ttl,
        AT,
    )
    assert "district" not in result


def test_failed_retrieval_still_discloses_remembered_filters():
    intake = IntakeResult(
        kind=RequestKind.NEW_GOAL,
        prefilled={
            "max_price_vnd": PrefilledValue(value=5_000_000, source="preference", last_confirmed_at=AT),
        },
    )
    response = compose({"intake": intake, "outcome": Outcome(node="execute", code=OutcomeCode.ERROR)}, None)
    assert response.data["prefilled"]["max_price_vnd"] == 5_000_000
    assert "như lần trước" in response.text and "ngân sách" in response.text


@pytest.mark.parametrize("status", [TaskStatus.NEEDS_INPUT, TaskStatus.FAILED, TaskStatus.PENDING])
def test_moving_does_not_ask_to_choose_a_home_before_housing_has_results(status):
    plan = Plan(version=1, tasks=[Task(id="housing", agent=AgentName.PROPERTY, inputs={"city": "hanoi"})])
    response = moving_destination_question(
        Question(field="relocation.selected:property", text="Chọn căn?"),
        {"plan": plan, "task_status": {"housing": status}},
    )
    assert "Tìm nhà chưa có kết quả" in response.text
    assert not response.options and not response.blocking


def test_expired_memory_stays_expired():
    session = SessionContext(preferences={"district": remembered("Cầu Giấy")})
    result = prefill_from_memory(
        {},
        session,
        [AgentName.PROPERTY],
        {AgentName.PROPERTY: "cheap"},
        GraphSettings().prefill_ttl,
        AT + timedelta(days=61),
    )
    assert "district" not in result
