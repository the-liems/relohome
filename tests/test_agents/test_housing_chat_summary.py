"""Pure response-format regressions (#122); no LLM or provider calls."""

from copy import deepcopy

import pytest
from relohome_agent.agents.common import utcnow
from relohome_agent.agents.models import (
    AgentName,
    Outcome,
    OutcomeCode,
    Plan,
    Question,
    Task,
    TaskResult,
    TaskStatus,
)
from relohome_agent.agents.nodes.respond import compose, data_notes, describe_result

from tests.test_agents.helpers import fact, intake_result


def search_state(count=5, **data):
    candidates = [
        {
            "id": f"contract-{i}",
            "title": f"Contract listing {i} with a long title",
            "price_vnd": 3_000_000,
            "address": f"Contract address {i}",
            "bedrooms": 1,
            "nearby": [{"name": "Contract school", "distance_m": 123}],
            "price_unverified": False,
        }
        for i in range(count)
    ]
    result = TaskResult(
        task_id="search",
        agent=AgentName.PROPERTY,
        plan_version=1,
        status="done",
        source_kind="live",
        fetched_at=utcnow(),
        data={"candidates": candidates, "execution": {"request_id": "turn1"}, **data},
    )
    return {
        "request_id": "turn1",
        "intake": intake_result(domains=[AgentName.PROPERTY], values={"city": "Hà Nội"}),
        "plan": Plan(version=1, tasks=[Task(id="search", agent=AgentName.PROPERTY)]),
        "task_results": {"search": result},
        "task_status": {"search": TaskStatus.DONE},
        "outcome": Outcome(node="cost_summary", code=OutcomeCode.ANSWER),
    }


@pytest.mark.parametrize("count", [1, 5, 12])
def test_new_search_is_brief_but_keeps_all_map_and_dependency_data(count):
    state = search_state(count)
    original = deepcopy(state["task_results"]["search"].data)
    reply = compose(state, None)

    assert reply.kind == "ANSWER"
    assert f"{count} căn trong lượt này" in reply.text
    assert "Bạn mở bản đồ xem thử nhé" in reply.text
    assert "Đây là kết quả" not in reply.text
    assert len(reply.text.split()) < 35
    assert "Contract listing" not in reply.text
    assert "Contract address" not in reply.text
    assert "Contract school" not in reply.text
    assert reply.data["results"]["search"]["data"] == original
    assert state["task_results"]["search"].data == original


def test_price_warnings_are_aggregated_without_losing_per_listing_flags():
    state = search_state()
    for candidate in state["task_results"]["search"].data["candidates"]:
        candidate["price_unverified"] = True
        candidate["quality_flags"] = ["price_unverified"]
    reply = compose(state, None)

    assert reply.text.lower().count("giá chưa xác minh") == 1
    assert "chưa tính vào ngân sách" in reply.text
    assert len(reply.text.split()) < 55
    assert all(c["price_unverified"] for c in reply.data["results"]["search"]["data"]["candidates"])
    assert all(
        c["quality_flags"] == ["price_unverified"] for c in reply.data["results"]["search"]["data"]["candidates"]
    )


def test_no_matches_does_not_claim_results_or_prompt_a_choice():
    reply = compose(search_state(0), None)
    assert "Chưa có căn phù hợp" in reply.text
    assert "Đây là kết quả" not in reply.text
    assert "Đã tìm được" not in reply.text
    assert "xem và chọn" not in reply.text
    assert reply.data["results"]["search"]["data"]["candidates"] == []


def test_radius_pagination_and_location_accuracy_are_still_disclosed():
    state = search_state(
        search_radius_m=3000,
        radius_is_default=True,
        has_more=True,
        approximate_origins=True,
        warnings=["approximate_origins"],
    )
    reply = compose(state, None)
    assert "3000 m đường thẳng (mặc định, có thể đổi)" in reply.text
    assert "toàn bộ thị trường" not in reply.text
    assert reply.data["results"]["search"]["data"]["has_more"] is True
    assert reply.text.count("khoảng cách tới tiện ích là ước lượng") == 1
    assert "vị trí gần đúng" in reply.text
    assert len(reply.text.split()) < 75


def test_selected_home_keeps_identity_price_and_full_search_without_booking_claim():
    state = search_state()
    state["intake"].user_confirmed_facts["selected:property"] = fact("contract-2", "chọn căn 3")
    state["task_results"]["search"].data["candidates"][2]["price_unverified"] = True
    reply = compose(state, None)
    result = reply.data["results"]["search"]

    assert "Căn bạn đã chọn: Contract listing 2 with a long title — 3.000.000đ/tháng" in reply.text
    assert "Contract listing 1" not in reply.text
    assert "Đã tìm được 1 căn" not in reply.text
    assert "giá chưa xác minh" in reply.text.lower()
    assert "đã đặt" not in reply.text.lower()
    assert result["displayed_option_ids"] == ["contract-2"]
    assert len(result["data"]["candidates"]) == 5


def test_multi_service_clarification_and_other_domain_results_are_not_hidden():
    state = search_state()
    state["plan"].tasks.append(Task(id="flight", agent=AgentName.FLIGHT))
    state["task_status"]["flight"] = TaskStatus.DONE
    state["task_results"]["flight"] = TaskResult(
        task_id="flight",
        agent=AgentName.FLIGHT,
        plan_version=1,
        status="done",
        source_kind="sandbox",
        fetched_at=utcnow(),
        data={
            "offers": [{"carrier": "Contract Air", "depart_at": "2026-11-14T09:00", "fare_vnd": 1_000_000}],
            "execution": {"request_id": "turn1"},
        },
    )
    state["planner_questions"] = [Question(field="relocation.move_time", text="Bạn muốn xe đến lúc mấy giờ?")]
    reply = compose(state, None)

    assert reply.kind == "CLARIFY"
    assert "Mình tìm được 5 căn" in reply.text
    assert "Mình có 1 chuyến bay" in reply.text
    assert "Contract Air" not in reply.text
    assert reply.data["results"]["flight"]["data"]["offers"][0]["carrier"] == "Contract Air"
    assert "sandbox" in reply.text
    assert "Bạn muốn xe đến lúc mấy giờ?" in reply.text
    assert reply.questions[0].field == "relocation.move_time"
    assert set(reply.data["results"]) == {"search", "flight"}


def test_partial_failure_is_not_presented_as_all_services_succeeding():
    state = search_state()
    state["plan"].tasks.append(Task(id="moving", agent=AgentName.RELOCATION))
    state["task_status"]["moving"] = TaskStatus.FAILED
    reply = compose(state, None)
    assert reply.kind == "PARTIAL"
    assert "Mình mới hoàn thành được một phần yêu cầu" in reply.text
    assert "Mình tìm được 5 căn" in reply.text
    assert reply.data["failed_tasks"] == [{"agent": "relocation", "task_id": "moving"}]


def test_long_model_assessment_is_not_repeated_but_limits_and_rationale_are_retained():
    assessment = {
        "kind": "model_assessment_not_provider_fact",
        "satisfaction": "limited",
        "reason": "Contract model rationale " * 100,
        "next_step": "Contract model next step " * 100,
    }
    state = search_state(agent_assessment=assessment)
    reply = compose(state, None)
    assert reply.kind == "PARTIAL"
    assert "AI chưa xác minh đủ tiêu chí" in reply.text
    assert "chưa phải xác nhận từ bên cho thuê" in reply.text
    assert "Contract model" not in reply.text
    assert len(reply.text.split()) < 65
    assert reply.data["limited_tasks"]["search"] == assessment
    assert reply.data["results"]["search"]["data"]["agent_assessment"] == assessment


def test_comparison_stays_separate_and_full_table_is_retained():
    comparison = {"rows": [{"id": "contract-a"}, {"id": "contract-b"}]}
    reply = compose(search_state(comparison=comparison), None)
    assert "Đã so sánh 2 căn trong bảng dưới" in reply.text
    assert "Nhà bạn đã chọn không thay đổi" in reply.text
    assert "Mở bản đồ để xem và chọn" not in reply.text
    assert reply.data["results"]["search"]["data"]["comparison"] == comparison


def test_moving_summary_is_brief_and_location_warning_remains():
    assert describe_result(AgentName.RELOCATION, {"quotes": [{"vehicle": "Contract VAN", "price_vnd": 300_000}]}) == [
        "Mình có 1 báo giá chuyển đồ. Bạn xem các gói xe để chọn nhé; chưa đặt đơn."
    ]
    assert data_notes({"destination_location_approximate": True, "warnings": ["destination_location_approximate"]}) == [
        "Vị trí phòng chỉ gần đúng; giá chuyển đồ có thể thay đổi khi đặt."
    ]
