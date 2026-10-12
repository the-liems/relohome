"""Đổi ý khi đang chờ xác nhận, đổi thứ đã đặt, tự điền từ bộ nhớ (agent-graph.md §6.7, §6.8, §10.1)."""

from datetime import timedelta

import pytest
from relohome_agent.agents.common import utcnow
from relohome_agent.agents.deps import test_deps
from relohome_agent.agents.intake import ScriptedIntake
from relohome_agent.agents.models import (
    AgentName,
    CommitActionKind,
    MemoryValue,
    RequestKind,
    SessionContext,
    TaskStatus,
)
from relohome_agent.agents.planning import TemplatePlanner
from relohome_agent.services.adapters.fakes import InMemorySessionPort

from tests.test_agents.helpers import Session, commit_fact, fact, intake_result

FLIGHT_VALUES = {"origin": "HAN", "destination": "SGN", "flight_date": "2026-11-15"}
MOVE_VALUES = {"from_address": "12 Láng Hạ", "move_date": "2026-11-14", "move_time": "09:00"}


@pytest.mark.asyncio
async def test_change_during_confirm_replans_only_affected_tasks():
    domains = [AgentName.PROPERTY, AgentName.FLIGHT, AgentName.RELOCATION]
    first = intake_result(
        RequestKind.NEW_GOAL,
        domains,
        values={"city": "Thành phố Hồ Chí Minh", **FLIGHT_VALUES, **MOVE_VALUES},
        facts=dict(
            [
                commit_fact(CommitActionKind.FLIGHT_BOOKING, "đặt vé"),
                commit_fact(CommitActionKind.MOVING_BOOKING, "chuyển đồ"),
                ("selected:property", fact("lst_002", "phòng 2")),
            ]
        ),
    )
    change = intake_result(
        RequestKind.CHANGE,
        domains,
        facts={"selected:property": fact("lst_003", "phòng rẻ hơn")},
        target_task_ids=["t1"],
        change_request="phòng đắt quá, lấy phòng rẻ hơn",
    )
    deps = test_deps(ScriptedIntake([first, change]), TemplatePlanner())
    s = Session(deps)
    out = await s.say("Tìm phòng ở Thành phố Hồ Chí Minh, đặt vé và chuyển đồ, lấy phòng 2")
    assert out["__interrupt__"][0].value["plan_version"] == 1
    flight_calls = len(deps.agents.get(AgentName.FLIGHT).requests)

    out = await s.resume({"kind": "CHANGE", "plan_version": 1, "change_request": "phòng đắt quá, lấy phòng rẻ hơn"})
    payload = out["__interrupt__"][0].value
    assert payload["plan_version"] == 2
    assert payload["cost_summary"]["selected"]["t1"] == "lst_003"
    state = await s.state()
    # t1 (phòng) và t3 (chuyển đồ tới phòng) bị ảnh hưởng; vé (t2) được tái dùng, không gọi lại.
    assert len(deps.agents.get(AgentName.FLIGHT).requests) == flight_calls
    assert len(deps.agents.get(AgentName.RELOCATION).requests) == 2
    assert state["replan_count"] == 1


@pytest.mark.asyncio
async def test_change_to_booked_item_is_not_auto_cancelled():
    book = intake_result(
        RequestKind.NEW_GOAL,
        [AgentName.FLIGHT],
        values=FLIGHT_VALUES,
        facts=dict([commit_fact(CommitActionKind.FLIGHT_BOOKING, "Đặt vé")]),
    )
    change = intake_result(
        RequestKind.CHANGE,
        [AgentName.FLIGHT],
        values=FLIGHT_VALUES,
        target_task_ids=["t1"],
        change_request="đổi sang chuyến chiều",
    )
    deps = test_deps(ScriptedIntake([book, change]), TemplatePlanner())
    s = Session(deps)
    out = await s.confirm(
        await s.say("Đặt vé"), {"flight_booking:t1": {"passengers": [{}], "contact": {"email": "a@b.c", "phone": "1"}}}
    )
    out = await s.resume({"action": "check"})
    assert out["response"].kind == "COMMITTED"
    out = await s.say("đổi sang chuyến chiều")
    assert out["response"].kind == "CLARIFY"
    assert "muốn huỷ" in out["response"].text
    assert out["task_status"]["t1"] == TaskStatus.DONE


@pytest.mark.asyncio
async def test_returning_user_prefill_then_correction():
    at = utcnow() - timedelta(days=5)
    sessions = InMemorySessionPort()
    sessions.data["u1"] = SessionContext(
        preferences={
            "near": MemoryValue(value="Quận 10", stated_at=at, last_confirmed_at=at),
            "max_price_vnd": MemoryValue(value=5_000_000, stated_at=at, last_confirmed_at=at),
        }
    )
    ask = intake_result(RequestKind.NEW_GOAL, [AgentName.PROPERTY])
    fix = intake_result(
        RequestKind.CHANGE,
        [AgentName.PROPERTY],
        values={"near": "Thủ Đức"},
        facts={"near": fact("Thủ Đức", "Thủ Đức")},
        target_task_ids=["t1"],
    )
    deps = test_deps(ScriptedIntake([ask, fix]), TemplatePlanner(), session=sessions)
    s = Session(deps)
    out = await s.say("Tìm phòng giúp mình.")
    assert out["response"].kind == "ANSWER"
    assert "như lần trước" in out["response"].text
    assert out["plan"].tasks[0].inputs == {"near": "Quận 10", "soft_filters": {"max_price_vnd": 5_000_000}}

    out = await s.say("không, lần này ở Thủ Đức")
    assert out["plan"].tasks[0].inputs == {"near": "Thủ Đức"}  # ngân sách gắn với Quận 10: không tự điền
    memory = sessions.data["u1"].preferences
    assert memory["near"].value == "Thủ Đức"
    assert memory["max_price_vnd"].stop_prefill is True


@pytest.mark.asyncio
async def test_payment_without_target_asks_back():
    unclear = intake_result(RequestKind.NEW_GOAL, [], conflicts=["Bạn muốn thanh toán cho việc gì?"])
    out = await Session(test_deps(ScriptedIntake([unclear]), TemplatePlanner())).say("Thanh toán giúp mình")
    assert out["response"].kind == "CLARIFY"
    assert "thanh toán cho việc gì" in out["response"].text
