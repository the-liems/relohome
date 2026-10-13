"""Presentation regressions for #153: no model, provider or transaction calls."""

from copy import deepcopy

import pytest
from relohome_agent.agents.models import AgentName, Outcome, OutcomeCode
from relohome_agent.agents.nodes.respond import compose, data_notes, describe_result

from tests.test_agents.test_housing_chat_summary import search_state


@pytest.mark.parametrize("count", [0, 1, 8])
@pytest.mark.parametrize(
    "agent,key,noun",
    [
        (AgentName.FLIGHT, "offers", "chuyến bay"),
        (AgentName.RELOCATION, "quotes", "báo giá chuyển đồ"),
        (AgentName.ROOMMATE, "profile_refs", "hồ sơ"),
    ],
)
def test_service_summary_does_not_repeat_catalogue_or_mutate_results(count, agent, key, noun):
    data = {
        key: [
            {
                "id": f"fixture-{i}",
                "carrier": "Fixture Air",
                "vehicle": "Fixture Van",
                "fare_vnd": 1_000_000,
                "price_vnd": 300_000,
            }
            for i in range(count)
        ]
    }
    before = deepcopy(data)
    text = "\n".join(describe_result(agent, data))
    assert data == before
    assert len(text.split()) <= 30
    assert "Fixture" not in text
    if count:
        assert f"{count} {noun}" in text
        assert "nhé" in text
    else:
        assert text.startswith("Chưa")
        assert "Mình có" not in text


@pytest.mark.parametrize("return_date", [None, "2026-11-15"])
def test_round_trip_keeps_return_date_and_indicative_price_disclosure(return_date):
    data = {
        "trip_type": "round_trip",
        "return_date": return_date,
        "offers": [{"kind": "round_trip_outbound", "fare_vnd": 2_000_000}],
    }
    text = "\n".join(describe_result(AgentName.FLIGHT, data))
    assert "khứ hồi" in text
    assert "chiều về" in text
    assert "giá hiện tại là tham khảo" in text
    assert "None" not in text
    if return_date:
        assert return_date in text


@pytest.mark.parametrize("profile,label", [("driving", "ô tô"), ("walking", "đi bộ"), ("motorcycle", "xe máy")])
def test_route_uses_human_labels_but_keeps_distance_time_and_uncertainty(profile, label):
    data = {
        "routing": {
            "profile": profile,
            "route": {"distance_meters": 2400, "duration_seconds": 1200},
            "warnings": ["approximate_origin"],
        }
    }
    text = "\n".join(describe_result(AgentName.MAP, data))
    assert f"Tuyến {label}: khoảng 2.40 km, 20 phút" in text
    assert "chưa tính giao thông thực tế" in text
    assert "chỉ gần đúng" in text
    assert "OSRM" not in text


def test_pagination_is_structured_and_does_not_duplicate_housing_workspace_disclaimer():
    state = search_state(has_more=True, warnings=["has_more", "destination_location_approximate"])
    reply = compose(state, None)
    assert "toàn bộ thị trường" not in reply.text
    assert "giá chuyển đồ có thể thay đổi" in reply.text
    assert reply.data["results"]["search"]["data"]["has_more"] is True
    assert data_notes({"has_more": True}, AgentName.FLIGHT)  # Only housing moves this note to its workspace.


def test_booking_and_order_receipts_are_not_replaced_by_a_search_summary():
    assert describe_result(AgentName.FLIGHT, {"booking": {"pnr": "FIXTURE", "status": "held"}}) == [
        "Đặt chỗ FIXTURE: held"
    ]
    assert describe_result(
        AgentName.RELOCATION,
        {"order": {"order_id": "FIXTURE", "status": "accepted", "shared_link": "https://example.invalid/order"}},
    ) == ["Đơn FIXTURE: accepted — theo dõi: https://example.invalid/order"]


@pytest.mark.parametrize(
    "availability,expected",
    [("eligibility_required", "18 tuổi"), ("criteria_required", "chọn thành phố"), ("disabled", "chưa được bật")],
)
def test_roommate_prerequisites_are_not_hidden(availability, expected):
    assert expected in "\n".join(describe_result(AgentName.ROOMMATE, {"availability": availability}))


def test_error_is_still_an_error_not_a_friendly_success():
    state = search_state()
    state["outcome"] = Outcome(node="execute", code=OutcomeCode.ERROR)
    reply = compose(state, None)
    assert reply.kind == "ERROR"
    assert "chưa xử lý được" in reply.text
    assert "Không có giao dịch nào được thực hiện" in reply.text
    assert reply.data["error"] == {"node": "execute", "code": "error"}
