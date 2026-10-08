"""Graph khi bật chọn nhiều căn: chọn qua chat chưa là căn của kế hoạch; chuyển đồ hỏi chờ chốt hay địa chỉ."""

from dataclasses import replace

import pytest

from src.agents.deps import GraphSettings, test_deps
from src.agents.intake import ScriptedIntake
from src.agents.models import AgentName, RequestKind
from src.agents.nodes.respond import MOVING_ADDRESS_NOW, MOVING_WAIT_FOR_HOME
from src.agents.planning import TemplatePlanner
from tests.test_agents.helpers import Session, fact, intake_result

VALUES = {"city": "HCM", "from_address": "12 Láng Hạ", "move_date": "2026-11-14", "move_time": "09:00"}


def viewing_deps(intakes, chosen):
    def selector(user_id, thread_id, task_id, row):
        chosen.append(row["id"])
        return [{"listing_id": i, "label": i, "task_id": task_id, "decided": False} for i in chosen]

    deps = test_deps(ScriptedIntake(intakes), TemplatePlanner())
    return replace(deps, settings=GraphSettings(housing_viewing=True), housing_selector=selector)


@pytest.mark.asyncio
async def test_moving_asks_wait_or_address_and_chat_choice_is_not_the_plan_home():
    chosen: list[str] = []
    domains = [AgentName.PROPERTY, AgentName.RELOCATION]
    first = intake_result(domains=domains, values=VALUES)
    pick = intake_result(
        RequestKind.REFINE, domains=domains, values=VALUES, facts={"selected:property": fact("lst_002", "căn số 2")}
    )
    deps = viewing_deps([first, pick], chosen)
    session = Session(deps)
    out = await session.say("Tìm phòng và chuyển đồ luôn")
    question = next(q for q in out["response"].questions if q.field == "relocation.selected:property")
    assert question.options == [MOVING_WAIT_FOR_HOME, MOVING_ADDRESS_NOW] and question.blocking
    assert "relocation.to_address" not in {q.field for q in out["response"].questions}
    assert deps.agents.get(AgentName.RELOCATION).requests == []

    out = await session.say("Chọn căn số 2")
    assert chosen == ["lst_002"]
    assert "selected:property" not in out["intake"].user_confirmed_facts
    assert out["housing_selection"][0]["listing_id"] == "lst_002"
    # Chọn để hẹn xem không phải chốt: chuyển đồ vẫn chưa báo giá.
    assert deps.agents.get(AgentName.RELOCATION).requests == []


@pytest.mark.asyncio
async def test_wait_for_home_turns_the_question_into_a_note():
    domains = [AgentName.PROPERTY, AgentName.RELOCATION]
    intakes = [intake_result(domains=domains, values=VALUES), intake_result(domains=domains, values=VALUES)]
    deps = viewing_deps(intakes, [])
    session = Session(deps)
    await session.say("Tìm phòng và chuyển đồ luôn")
    await session.graph.aupdate_state(session.config, {"moving_destination_mode": "wait_for_home"}, as_node="respond")
    out = await session.say("Tìm phòng và chuyển đồ luôn")
    question = next(q for q in out["response"].questions if q.field == "relocation.selected:property")
    assert not question.blocking and question.options == [MOVING_ADDRESS_NOW]
