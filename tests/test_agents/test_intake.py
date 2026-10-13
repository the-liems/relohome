"""resolve_missing và kiểm dữ kiện (agent-graph.md §6.1)."""

from dataclasses import replace
from datetime import timedelta

import pytest
from langchain_core.messages import HumanMessage
from relohome_agent.agents.common import utcnow
from relohome_agent.agents.deps import GraphSettings, default_deps
from relohome_agent.agents.intake import FixedIntake, ground_facts, resolve_missing
from relohome_agent.agents.models import (
    AgentName,
    MemoryValue,
    Plan,
    RequestKind,
    SessionContext,
    Task,
    TaskResult,
    TaskStatus,
)
from relohome_agent.agents.nodes.intake import continue_referenced_goal, make_intake, remembered_home

from tests.test_agents.helpers import fact, intake_result

TIERS = {AgentName.PROPERTY: "cheap", AgentName.MAP: "cheap", AgentName.FLIGHT: "paid", AgentName.RELOCATION: "paid"}
TTL = GraphSettings().prefill_ttl


def resolve(result, session=None, plan=None):
    return resolve_missing(
        result, session=session or SessionContext(), plan=plan, cost_tiers=TIERS, prefill_ttl=TTL, now=utcnow()
    )


def memory(value, days_ago=1, **kw):
    at = utcnow() - timedelta(days=days_ago)
    return MemoryValue(value=value, stated_at=at, last_confirmed_at=at, **kw)


def test_blocks_only_when_no_task_can_run():
    out = resolve(intake_result(domains=[AgentName.PROPERTY]))
    assert out.blocking_missing == ["property.city|near|district"]


@pytest.mark.asyncio
async def test_new_named_city_replaces_old_housing_city_when_model_only_extracts_landmark():
    previous = intake_result(RequestKind.REFINE, [AgentName.PROPERTY],
                             values={"city": "Thành phố Hồ Chí Minh", "near": "Gò Vấp"},
                             facts={"city": fact("Thành phố Hồ Chí Minh", "TP.HCM"),
                                    "near": fact("Gò Vấp", "Gò Vấp")})
    current = intake_result(RequestKind.REFINE, [AgentName.PROPERTY],
                            values={"near": "đại học bách khoa hà nội"},
                            facts={"near": fact("đại học bách khoa hà nội", "đại học bách khoa hà nội")})
    deps = replace(default_deps(), intake=FixedIntake(current))
    state = {"thread_id": "t", "request_id": "r", "messages": [HumanMessage("Tìm nhà gần đại học bách khoa hà nội")],
             "intake": previous, "session": SessionContext()}
    result = (await make_intake(deps)(state))["intake"]
    assert result.constraints.values["city"] == "Hà Nội"
    assert result.constraints.values["near"] == "đại học bách khoa hà nội"
    assert not result.conflicts


@pytest.mark.asyncio
async def test_new_district_does_not_inherit_unrelated_old_city_or_landmark():
    previous = intake_result(RequestKind.REFINE, [AgentName.PROPERTY],
                             values={"city": "Thành phố Hồ Chí Minh", "near": "Gò Vấp"},
                             facts={"city": fact("Thành phố Hồ Chí Minh", "TP.HCM"),
                                    "near": fact("Gò Vấp", "Gò Vấp")})
    current = intake_result(RequestKind.REFINE, [AgentName.PROPERTY],
                            values={"district": "Cầu Giấy"},
                            facts={"district": fact("Cầu Giấy", "Cầu Giấy")})
    deps = replace(default_deps(), intake=FixedIntake(current))
    state = {"thread_id": "t", "request_id": "r", "messages": [HumanMessage("Tìm nhà ở Cầu Giấy")],
             "intake": previous, "session": SessionContext()}
    result = (await make_intake(deps)(state))["intake"]
    assert result.constraints.values["district"] == "Cầu Giấy"
    assert "city" not in result.constraints.values
    assert "near" not in result.constraints.values


@pytest.mark.asyncio
async def test_compare_cheapest_in_new_area_searches_before_comparing():
    previous = intake_result(RequestKind.REFINE, [AgentName.PROPERTY],
                             values={"city": "Thành phố Hồ Chí Minh"},
                             facts={"city": fact("Thành phố Hồ Chí Minh", "TP.HCM")})
    request = "Hãy so sánh 3-4 căn giá rẻ nhất ở Cầu Giấy"
    current = intake_result(RequestKind.REFINE, [AgentName.PROPERTY],
                            values={"housing_mode": "compare", "district": "Cầu Giấy"},
                            facts={"housing_mode": fact("compare", "so sánh"),
                                   "district": fact("Cầu Giấy", "Cầu Giấy")},
                            conflicts=["Bạn muốn so sánh căn đã xem nào?"])
    deps = replace(default_deps(), intake=FixedIntake(current))
    state = {"thread_id": "t", "request_id": "r", "messages": [HumanMessage(request)],
             "intake": previous, "session": SessionContext()}
    result = (await make_intake(deps)(state))["intake"]
    assert result.constraints.values["housing_mode"] == "search_compare"
    assert result.constraints.values["limit"] == 4
    assert not result.blocking_missing and not result.conflicts


def test_asks_only_root_task_when_dependent_can_derive():
    # "tìm phòng và vé bay vào đó": chỉ hỏi khu vực; điểm đến suy ra từ phòng, ngày bay hỏi sau.
    out = resolve(intake_result(domains=[AgentName.PROPERTY, AgentName.FLIGHT], values={"origin": "Hà Nội"}))
    assert out.blocking_missing == ["property.city|near|district"]


def test_runnable_task_defers_missing_of_others():
    out = resolve(intake_result(domains=[AgentName.PROPERTY, AgentName.RELOCATION], values={"city": "HCM"}))
    assert out.blocking_missing == []
    assert set(out.constraints.missing) == {
        "relocation.from_address",
        "relocation.move_date",
        "relocation.move_time",
        "relocation.selected:property",
    }


def test_relocation_alone_must_ask_to_address():
    # S3: không có tìm phòng thì to_address phải do người dùng nói.
    out = resolve(intake_result(domains=[AgentName.RELOCATION]))
    assert set(out.blocking_missing) == {
        "relocation.from_address",
        "relocation.to_address",
        "relocation.move_date",
        "relocation.move_time",
    }


def test_derivation_from_existing_plan():
    plan = Plan(version=1, tasks=[Task(id="t1", agent=AgentName.PROPERTY, inputs={"city": "HCM"})])
    out = resolve(
        intake_result(RequestKind.REFINE, [AgentName.FLIGHT], values={"origin": "HAN", "flight_date": "2026-11-15"}),
        plan=plan,
    )
    assert out.blocking_missing == [] and out.constraints.missing == []


def test_prefill_for_cheap_domain_with_notice():
    session = SessionContext(preferences={"near": memory("Quận 10"), "max_price_vnd": memory(5_000_000)})
    out = resolve(intake_result(domains=[AgentName.PROPERTY]), session=session)
    assert out.blocking_missing == []
    assert set(out.prefilled) == {"near", "max_price_vnd"}
    assert out.constraints.values["near"] == "Quận 10"


def test_no_prefill_for_paid_domain():
    session = SessionContext(hints={"origin": memory("Hà Nội")}, preferences={"near": memory("Quận 10")})
    out = resolve(intake_result(domains=[AgentName.FLIGHT]), session=session)
    assert "flight.origin" in out.blocking_missing
    assert out.prefilled == {}


def test_confirmed_home_remains_referable_after_an_unrelated_flight_goal():
    previous = intake_result(RequestKind.REFINE, [AgentName.FLIGHT])
    home = TaskResult(
        task_id="home", agent=AgentName.PROPERTY, plan_version=1, status="done", fetched_at=utcnow(),
        data={"candidates": [{"id": "h1", "title": "Căn đã chọn"}]},
    )
    state = {
        "goal_selections": {"home": "h1"},
        "task_results": {"home": home},
        "task_status": {"home": TaskStatus.DONE},
    }
    restored = remembered_home(previous, state)
    assert restored.user_confirmed_facts["selected:property"].value == "h1"
    moving = intake_result(RequestKind.NEW_GOAL, [AgentName.RELOCATION],
                           values={"to_address": "selected:property"})
    assert continue_referenced_goal(moving, restored).kind == RequestKind.REFINE
    state["task_status"]["home"] = TaskStatus.STALE
    assert "selected:property" not in remembered_home(previous, state).user_confirmed_facts


def test_expired_or_stopped_memory_not_prefilled():
    session = SessionContext(
        preferences={"near": memory("Quận 10", days_ago=200), "city": memory("HCM", stop_prefill=True)}
    )
    out = resolve(intake_result(domains=[AgentName.PROPERTY]), session=session)
    assert out.blocking_missing == ["property.city|near|district"]


def test_anchor_changed_blocks_dependent_prefill():
    session = SessionContext(
        preferences={"near": memory("Quận 10"), "max_price_vnd": memory(5_000_000), "has_pet": memory(True)}
    )
    out = resolve(intake_result(domains=[AgentName.PROPERTY], values={"near": "Thủ Đức"}), session=session)
    assert "max_price_vnd" not in out.prefilled
    assert out.constraints.values["near"] == "Thủ Đức"  # tin nhắn luôn thắng bộ nhớ


def test_facts_need_user_evidence_and_no_pii():
    new = {
        "city": fact("HCM", "TP.HCM"),
        "budget": fact(5, "năm triệu"),  # không có trong tin nhắn
        "email": fact("a@b.com", "a@b.com"),
        "note": fact("0901234567", "0901234567"),
    }
    out = ground_facts(new, {}, RequestKind.NEW_GOAL, ["Tìm phòng ở TP.HCM, mail a@b.com, sđt 0901234567"], [])
    assert set(out.facts) == {"city"}
    assert set(out.dropped) == {"budget", "email", "note"}


def test_confirmed_fact_only_overwritten_on_change():
    old = {"city": fact("HCM", "HCM")}
    refine = ground_facts({"city": fact("Hà Nội", "Hà Nội")}, old, RequestKind.REFINE, ["HCM", "Hà Nội"], [])
    assert refine.facts["city"].value == "HCM" and refine.conflicts
    change = ground_facts({"city": fact("Hà Nội", "Hà Nội")}, old, RequestKind.CHANGE, ["HCM", "Hà Nội"], [])
    assert change.facts["city"].value == "Hà Nội"


def test_bare_yes_with_many_suggestions_is_ambiguous():
    new = {"commit:flight_booking": fact(True, "có", suggestion_key="book:flight")}
    one = ground_facts(new, {}, RequestKind.REFINE, ["có"], ["book:flight"])
    assert "commit:flight_booking" in one.facts
    many = ground_facts(new, {}, RequestKind.REFINE, ["có"], ["book:flight", "search:property"])
    assert "commit:flight_booking" not in many.facts and many.conflicts
    unknown = ground_facts(new, {}, RequestKind.REFINE, ["có"], ["search:property"])
    assert "commit:flight_booking" not in unknown.facts
