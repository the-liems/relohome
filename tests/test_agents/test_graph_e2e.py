"""E2E không cần mạng: FixedIntake/ScriptedIntake + TemplatePlanner + FakeAgent (agent-graph.md §10)."""

import pytest
from relohome_agent.agents.deps import test_deps
from relohome_agent.agents.intake import ScriptedIntake
from relohome_agent.agents.models import AgentName, CommitActionKind, RequestKind, TaskStatus
from relohome_agent.agents.planning import TemplatePlanner

from tests.test_agents.helpers import ALL_DOMAINS, Session, commit_fact, fact, intake_result

MSG1 = (
    "Tháng 11 mình chuyển từ Hà Nội vào Thành phố Hồ Chí Minh, cần phòng dưới 6 triệu gần bệnh viện Chợ Rẫy, "
    "có Wi-Fi; đặt giúp chuyển đồ và vé máy bay."
)
MSG2 = "Phòng số 2. Bay 15/11, chuyển đồ 14/11 từ 12 Láng Hạ."

PII = {
    "flight_booking:t3": {
        "passengers": [{"title": "MR", "first_name": "VAN A", "last_name": "NGUYEN", "date_of_birth": "1999-01-01"}],
        "contact": {"email": "a@example.com", "phone": "0901234567"},
    },
    "moving_booking:t4": {
        "pickup_contact": {"name": "Nguyen Van A", "mobile": "0901234567"},
        "destination_contact": {"name": "Nguyen Van A", "mobile": "0901234567"},
    },
}


def turn1():
    return intake_result(
        RequestKind.NEW_GOAL,
        ALL_DOMAINS,
        values={
            "city": "Thành phố Hồ Chí Minh",
            "near": "Bệnh viện Chợ Rẫy",
            "max_price_vnd": 6_000_000,
            "must_have": ["wifi"],
            "origin": "Hà Nội",
        },
        facts=dict(
            [
                commit_fact(CommitActionKind.MOVING_BOOKING, "đặt giúp chuyển đồ"),
                commit_fact(CommitActionKind.FLIGHT_BOOKING, "vé máy bay"),
                ("max_price_vnd", fact(6_000_000, "dưới 6 triệu")),
                ("city", fact("Thành phố Hồ Chí Minh", "Thành phố Hồ Chí Minh")),
            ]
        ),
    )


def turn2():
    return intake_result(
        RequestKind.REFINE,
        ALL_DOMAINS,
        values={
            "flight_date": "2026-11-15",
            "move_date": "2026-11-14",
            "move_time": "09:00",
            "from_address": "12 Láng Hạ",
            "destination": "SGN",
            "origin": "HAN",
        },
        facts={
            "selected:property": fact("lst_002", "Phòng số 2"),
            "from_address": fact("12 Láng Hạ", "12 Láng Hạ"),
        },
    )


@pytest.mark.asyncio
async def test_two_turns_confirm_and_pay():
    deps = test_deps(ScriptedIntake([turn1(), turn2()]), TemplatePlanner())
    s = Session(deps)

    # Lượt 1: chạy phần làm được (phòng + tiện ích), hỏi sau phần còn thiếu (D10).
    out = await s.say(MSG1)
    response = out["response"]
    assert response.kind == "CLARIFY"
    assert [t.agent for t in out["plan"].tasks] == [AgentName.PROPERTY, AgentName.MAP]
    assert set(out["intake"].constraints.missing) >= {
        "flight.flight_date",
        "relocation.from_address",
        "relocation.move_date",
        "relocation.move_time",
        "relocation.selected:property",
    }
    assert "Studio 28m² Quận 10" in response.text
    assert out["intake"].commit_requested == [CommitActionKind.MOVING_BOOKING, CommitActionKind.FLIGHT_BOOKING]

    # Lượt 2: giữ t1, t2 DONE; thêm vé + chuyển đồ; một lần xác nhận cho cả hai (S7).
    out = await s.say(MSG2)
    payload = out["__interrupt__"][0].value
    assert payload["type"] == "confirmation_required"
    plan = (await s.state())["plan"]
    assert plan.version == 2
    assert [t.id for t in plan.tasks] == ["t1", "t2", "t3", "t4"]
    assert {a.id for a in plan.commit_actions} == {"flight_booking:t3", "moving_booking:t4"}
    property_requests = deps.agents.get(AgentName.PROPERTY).requests
    assert len(property_requests) == 1  # t1 được tái dùng, không gọi lại
    assert payload["cost_summary"]["selected"]["t1"] == "lst_002"
    assert payload["pii_required"] == {
        "flight_booking:t3": ["passengers", "contact"],
        "moving_booking:t4": ["pickup_contact", "destination_contact"],
    }

    # Xác nhận: chuyển đồ (tiền mặt) đặt trước, vé chờ thanh toán bất đồng bộ.
    out = await s.confirm(out, PII)
    payment = out["__interrupt__"][0].value
    assert payment["type"] == "payment_required"
    state = await s.state()
    assert "moving_booking:t4" in state["committed"]
    assert state["pending_payment"].status == "PENDING"

    out = await s.resume({"action": "check"})
    assert out["response"].kind == "COMMITTED"
    assert set(out["committed"]) == {"flight_booking:t3", "moving_booking:t4"}
    # Dữ liệu cá nhân không nằm trong state.
    dumped = str(await s.state())
    assert "0901234567" not in dumped and "a@example.com" not in dumped


@pytest.mark.asyncio
async def test_new_user_asks_location_without_calling_agents():
    deps = test_deps(ScriptedIntake([intake_result(RequestKind.NEW_GOAL, [AgentName.PROPERTY])]), TemplatePlanner())
    out = await Session(deps).say("Tìm phòng giúp mình.")
    assert out["response"].kind == "CLARIFY"
    assert out["intake"].blocking_missing == ["property.city|near|district"]
    assert out.get("plan") is None
    assert deps.agents.get(AgentName.PROPERTY).requests == []


@pytest.mark.asyncio
async def test_search_only_goes_straight_to_answer():
    deps = test_deps(
        ScriptedIntake(
            [
                intake_result(
                    RequestKind.NEW_GOAL, [AgentName.PROPERTY], values={"near": "Quận 10", "max_price_vnd": 5_000_000}
                )
            ]
        ),
        TemplatePlanner(),
    )
    out = await Session(deps).say("Tìm phòng dưới 5 triệu ở Quận 10")
    assert out["response"].kind == "ANSWER"
    assert "__interrupt__" not in out
    assert out["task_status"]["t1"] == TaskStatus.DONE
    assert "dữ liệu mẫu" in out["response"].text
    # Next services are suggested only after the user chooses a home (no choice yet here).
    assert out["response"].suggestions == []
