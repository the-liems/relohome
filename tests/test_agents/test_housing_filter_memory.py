"""Real graph/session memory, fixture model/providers: cleared filters stay cleared in this goal."""

from dataclasses import replace

import pytest
from langchain_core.messages import HumanMessage
from relohome_agent.agents.intake_llm import LlmIntake, ScalarIntakeDraft
from relohome_agent.agents.models import IntakeResult, MemoryUpdate
from relohome_agent.agents.nodes.intake import make_intake
from relohome_agent.services.adapters.fakes import InMemorySessionPort
from relohome_agent.services.adapters.sqlite_runtime import RuntimeDatabase, SqliteSessionPort

from tests.test_agents.helpers import Session
from tests.test_agents.test_housing_filter_followups import draft, workflow
from tests.test_agents.test_token_efficiency import Model


@pytest.fixture(params=["memory", "sqlite"])
def session_store(request, tmp_path):
    if request.param == "memory":
        yield InMemorySessionPort()
    else:
        db = RuntimeDatabase(str(tmp_path / "runtime"))
        try:
            yield SqliteSessionPort(db)
        finally:
            db.close()


def remembered_workflow(store, drafts):
    original, model, planner, adapter, agent = workflow(drafts)
    return Session(replace(original.deps, session=store)), model, planner, adapter, agent


@pytest.mark.asyncio
async def test_clearing_the_last_scope_asks_for_a_new_area_instead_of_restoring_memory(session_store):
    initial = "Tìm nhà gần Ocean Park 2 dưới 5 triệu."
    clear = "Không cần gần Ocean Park 2 nữa."
    followup = "Giảm xuống dưới 4 triệu."
    session, model, planner, adapter, agent = remembered_workflow(
        session_store,
        [
            draft(initial, kind="new_goal", values={"near": "Ocean Park 2", "max_price_vnd": 5_000_000}),
            draft(clear, patch={"clear_fields": ["near"]}),
            draft(followup, values={"max_price_vnd": 4_000_000}),
        ],
    )
    first = await session.say(initial)
    assert first["response"].kind == "ANSWER"
    remembered = await session_store.load(session.user_id)
    assert remembered.preferences["near"].value == "Ocean Park 2"
    assert not remembered.preferences["near"].stop_prefill
    for index, (text, price) in enumerate(((clear, 5_000_000), (followup, 4_000_000)), 2):
        state = await session.say(text)
        current = state["intake"]
        assert current.constraints.values == {"max_price_vnd": price}
        assert state["response"].kind == "CLARIFY", state.get("outcome")
        assert current.blocking_missing and not current.prefilled
        assert "near" not in current.user_confirmed_facts
        assert len(adapter.requests) == 1 and len(model.calls) == index
        counts = await session.deps.usage.counts("th1", f"r{index}")
        assert counts.llm_calls == 1 and counts.subagent_llm_calls == 0
    # The goal-local exclusion must not delete/disable the account's preference.
    after = await session_store.load(session.user_id)
    assert after.preferences["near"] == remembered.preferences["near"]
    assert not planner.calls and agent.llm_client is None


@pytest.mark.asyncio
@pytest.mark.parametrize("new_near", ["Ocean Park 2", "Bách Khoa"])
async def test_explicitly_reintroducing_a_scope_reopens_only_that_field(session_store, new_near):
    initial, clear = "Tìm gần Ocean Park 2 dưới 5 triệu.", "Không cần gần Ocean Park 2 nữa."
    add = f"Bây giờ tìm gần {new_near}."
    session, model, planner, adapter, _ = remembered_workflow(
        session_store,
        [
            draft(initial, kind="new_goal", values={"near": "Ocean Park 2", "max_price_vnd": 5_000_000}),
            draft(clear, patch={"clear_fields": ["near"]}),
            draft(add, values={"near": new_near}),
        ],
    )
    await session.say(initial)
    blocked = await session.say(clear)
    assert blocked["response"].kind == "CLARIFY" and len(adapter.requests) == 1
    restored = await session.say(add)
    assert restored["response"].kind == "ANSWER", restored.get("outcome")
    assert restored["intake"].constraints.values == {"near": new_near, "max_price_vnd": 5_000_000}
    assert "near" not in restored["intake"].housing_prefill_exclusions
    assert restored["intake"].prefilled == {}
    assert len(adapter.requests) == 2 and len(model.calls) == 3 and not planner.calls


@pytest.mark.asyncio
async def test_another_remembered_city_cannot_replace_the_last_scope_that_was_removed(session_store):
    initial, clear = "Tìm gần Ocean Park 2 dưới 5 triệu.", "Không cần gần Ocean Park 2 nữa."
    session, _, planner, adapter, _ = remembered_workflow(
        session_store,
        [
            draft(initial, kind="new_goal", values={"near": "Ocean Park 2", "max_price_vnd": 5_000_000}),
            draft(clear, patch={"clear_fields": ["near"]}),
        ],
    )
    await session.say(initial)
    # Another conversation may update shared account preferences between turns.
    await session_store.save(
        session.user_id,
        "other-thread",
        [
            MemoryUpdate(group="preferences", key="city", value="Hà Nội", evidence="Hà Nội"),
            MemoryUpdate(group="preferences", key="district", value="Hoàng Mai", evidence="Hoàng Mai"),
        ],
    )
    state = await session.say(clear)
    assert state["intake"].constraints.values == {"max_price_vnd": 5_000_000}
    assert state["response"].kind == "CLARIFY" and len(adapter.requests) == 1 and not planner.calls
    assert {"city", "district", "near"} <= set(state["intake"].housing_prefill_exclusions)
    account = await session_store.load(session.user_id)
    assert account.preferences["city"].value == "Hà Nội" and account.preferences["near"].value == "Ocean Park 2"


@pytest.mark.asyncio
async def test_cleared_price_is_still_excluded_when_the_scope_is_removed_on_a_later_turn(session_store):
    initial = "Tìm gần Ocean Park 2 dưới 5 triệu."
    clear_price, clear_scope = "Không giới hạn giá nữa.", "Không cần gần Ocean Park 2 nữa."
    refresh = "Tìm căn khác."
    session, _, planner, adapter, _ = remembered_workflow(
        session_store,
        [
            draft(initial, kind="new_goal", values={"near": "Ocean Park 2", "max_price_vnd": 5_000_000}),
            draft(clear_price, patch={"clear_fields": ["max_price_vnd"]}),
            draft(clear_scope, patch={"clear_fields": ["near"]}),
            draft(refresh, kind="refine"),
        ],
    )
    await session.say(initial)
    no_price = await session.say(clear_price)
    assert no_price["intake"].constraints.values == {"near": "Ocean Park 2"}
    assert no_price["response"].kind == "ANSWER"
    for text in (clear_scope, refresh):
        state = await session.say(text)
        assert state["intake"].constraints.values == {} and state["intake"].prefilled == {}
        assert state["response"].kind == "CLARIFY" and len(adapter.requests) == 2
        assert {"near", "max_price_vnd"} <= set(state["intake"].housing_prefill_exclusions)
    remembered = await session_store.load(session.user_id)
    assert remembered.preferences["max_price_vnd"].value == 5_000_000 and not planner.calls


@pytest.mark.asyncio
async def test_exclusions_survive_checkpoint_roundtrip_but_a_new_goal_can_use_account_memory(session_store):
    initial, clear = "Tìm gần Ocean Park 2 dưới 5 triệu.", "Không cần gần Ocean Park 2 nữa."
    session, _, _, _, _ = remembered_workflow(
        session_store,
        [
            draft(initial, kind="new_goal", values={"near": "Ocean Park 2", "max_price_vnd": 5_000_000}),
            draft(clear, patch={"clear_fields": ["near"]}),
        ],
    )
    await session.say(initial)
    state = await session.say(clear)
    saved = IntakeResult.model_validate_json(state["intake"].model_dump_json())
    assert "near" in saved.housing_prefill_exclusions
    assert "housing_prefill_exclusions" not in ScalarIntakeDraft.model_fields  # Code-owned, no larger LLM schema.
    text = "Bắt đầu mục tiêu tìm nhà mới."
    model = Model(draft(text, kind="new_goal"))
    deps = replace(session.deps, intake=LlmIntake(model, max_calls=1))
    result = await make_intake(deps)(
        {
            "intake": saved,
            "messages": [HumanMessage(text)],
            "session": await session_store.load(session.user_id),
        }
    )
    current = result["intake"]
    assert not current.housing_prefill_exclusions
    assert current.prefilled["near"].value == "Ocean Park 2" and not current.blocking_missing
    assert len(model.calls) == 1
