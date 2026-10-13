"""Graph khi bật chọn nhiều căn: chọn qua chat chưa là căn của kế hoạch; chuyển đồ hỏi chờ chốt hay địa chỉ."""

from dataclasses import replace

import pytest
from relohome_agent.agents.deps import GraphSettings, test_deps
from relohome_agent.agents.intake import ScriptedIntake
from relohome_agent.agents.models import AgentName, RequestKind
from relohome_agent.agents.nodes.respond import MOVING_ADDRESS_NOW, MOVING_WAIT_FOR_HOME
from relohome_agent.agents.planning import TemplatePlanner

from tests.test_agents.helpers import Session, fact, intake_result

VALUES = {"city": "HCM", "from_address": "12 Láng Hạ", "move_date": "2026-11-14", "move_time": "09:00"}


def viewing_deps(intakes, chosen):
    def view():
        return [{"listing_id": i, "label": i, "task_id": "t", "decided": False} for i in chosen]

    def selector(user_id, thread_id, task_id, row):
        chosen.append(row["id"])
        return view()

    def unselector(user_id, thread_id, listing_id):
        chosen.remove(listing_id)
        return view()

    deps = test_deps(ScriptedIntake(intakes), TemplatePlanner())
    return replace(
        deps, settings=GraphSettings(housing_viewing=True), housing_selector=selector, housing_unselector=unselector
    )


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


@pytest.mark.asyncio
async def test_chat_adds_several_homes_then_swaps_one():
    chosen: list[str] = []
    search = intake_result(domains=[AgentName.PROPERTY], values={"city": "HCM"})
    add = intake_result(
        RequestKind.REFINE,
        domains=[AgentName.PROPERTY],
        values={"city": "HCM"},
        facts={"housing_select_ids": fact(["lst_001", "lst_003"], "căn 1 và căn 3")},
    )
    swap = intake_result(
        RequestKind.REFINE,
        domains=[AgentName.PROPERTY],
        values={"city": "HCM"},
        facts={
            "housing_unselect_ids": fact(["lst_001"], "đổi căn 1"),
            "housing_select_ids": fact(["lst_002"], "căn 2"),
        },
    )
    session = Session(viewing_deps([search, add, swap], chosen))
    await session.say("Tìm phòng ở HCM")
    out = await session.say("Mình muốn xem căn 1 và căn 3")
    assert chosen == ["lst_001", "lst_003"]
    # Chỉ đổi căn đang xem: trả lời ngay, không tìm lại.
    assert len(session.deps.agents.get(AgentName.PROPERTY).requests) == 1
    assert out["response"].kind == "ANSWER" and "đang chọn để đi xem (2)" in out["response"].text
    assert [h["listing_id"] for h in out["housing_selection"]] == ["lst_001", "lst_003"]
    out = await session.say("Mình muốn đổi căn 1 thành căn 2")
    assert chosen == ["lst_003", "lst_002"]
    assert "selected:property" not in out["intake"].user_confirmed_facts
    assert "housing_select_ids" not in out["intake"].constraints.values
