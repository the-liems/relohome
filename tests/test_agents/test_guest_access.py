import sqlite3
from types import SimpleNamespace

import httpx
import pytest
from fastapi import Depends, FastAPI, HTTPException
from langchain_core.messages import HumanMessage
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from langgraph.graph import END, START, StateGraph
from pydantic import SecretStr
from relohome_agent.agents.common import utcnow
from relohome_agent.agents.graph import default_checkpointer, make_agent_node, run_config
from relohome_agent.agents.models import AgentName, MemoryUpdate, Task
from relohome_agent.agents.nodes.transaction import make_transaction
from relohome_agent.agents.state import WorkflowState
from relohome_agent.api.guest_claim import GuestClaim, claim
from relohome_agent.api.routes import authenticate
from relohome_agent.checkout.models import ServiceTransaction
from relohome_agent.checkout.store import CheckoutStore
from relohome_agent.guest_access import allowed, is_guest
from relohome_agent.services.adapters.fakes import InMemorySessionPort

GUEST = "guest_" + "a" * 32
ACCOUNT = "b" * 32
THREAD = "th_guest"


@pytest.mark.asyncio
async def test_claim_real_checkpoint_drafts_memory_retry_and_old_owner():
    graph = StateGraph(WorkflowState)
    graph.add_node("respond", lambda state: {})
    graph.add_edge(START, "respond")
    graph.add_edge("respond", END)
    graph = graph.compile(checkpointer=default_checkpointer())
    memory = InMemorySessionPort()
    await memory.save(GUEST, THREAD, [MemoryUpdate(group="preferences", key="city", value="Hà Nội")])
    db = sqlite3.connect(":memory:", isolation_level=None)
    store = CheckoutStore(db)
    draft = ServiceTransaction(
        transaction_id="tx_guest",
        user_id=GUEST,
        thread_id=THREAD,
        logical_key="housing:home",
        domain="property",
        option_id="home",
        status="selected",
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    store.put_tx(draft)
    deps = SimpleNamespace(settings=SimpleNamespace(recursion_limit=50), session=memory)
    service = SimpleNamespace(deps=deps, graph=graph, locks={}, viewing=SimpleNamespace(store=store), checkout=None)
    await graph.ainvoke(
        {"user_id": GUEST, "thread_id": THREAD, "messages": [HumanMessage("Tìm nhà")]}, run_config(THREAD, deps)
    )
    body = GuestClaim(thread_id=THREAD, target_user=ACCOUNT, operation_key="key_" + "1" * 40)
    assert await claim(body, service, GUEST) == {"claimed": True}
    assert await claim(body, service, GUEST) == {"claimed": True}
    values = (await graph.aget_state(run_config(THREAD, deps))).values
    assert values["user_id"] == ACCOUNT and values["messages"][0].content == "Tìm nhà"
    assert not store.list_tx(GUEST, THREAD)
    assert store.list_tx(ACCOUNT, THREAD)[0].user_id == ACCOUNT
    assert (await memory.load(ACCOUNT)).preferences["city"].value == "Hà Nội"
    assert not (await memory.load(GUEST)).preferences
    with pytest.raises(HTTPException) as invalid:
        await claim(body.model_copy(update={"operation_key": "key_" + "2" * 40}), service, GUEST)
    assert invalid.value.status_code == 404
    with pytest.raises(HTTPException):
        await claim(body, service, "guest_" + "c" * 32)
    db.close()


@pytest.mark.asyncio
async def test_guest_cannot_run_roommate_moving_payment_tools_or_transaction():
    class NeverCalled:
        capability = SimpleNamespace()

        async def invoke(self, *args, **kwargs):
            raise AssertionError("Protected provider was called")

    deps = SimpleNamespace(agents=SimpleNamespace(get=lambda name: NeverCalled()), clock=utcnow, transaction=None)
    for name in (AgentName.ROOMMATE, AgentName.RELOCATION, AgentName.PAYMENT):
        update = await make_agent_node(deps, name)(
            {
                "task": Task(id="private", agent=name),
                "user_id": GUEST,
                "plan_version": 1,
            }
        )
        assert update["task_results"]["private"].data["authentication_required"]
    with pytest.raises(HTTPException):
        await make_transaction(deps)({"user_id": GUEST})


def test_guest_endpoint_matrix_does_not_allow_private_reads_or_writes():
    assert is_guest(GUEST) and not is_guest("anonymous")
    for path, method in [
        ("/api/v1/chat", "POST"),
        ("/api/v1/map/search", "GET"),
        ("/api/v1/ui/chat/th/action", "POST"),
        ("/api/v1/chat/th/state", "GET"),
    ]:
        assert allowed(path, method)
    for path, method in [
        ("/api/v1/roommate/search", "POST"),
        ("/api/v1/roommate/profiles/p", "GET"),
        ("/api/v1/ui/checkout/tx/pay", "POST"),
        ("/api/v1/chat/th/decision", "POST"),
        ("/api/v1/ui/chat/th/viewings/schedule", "POST"),
        ("/api/v1/moving/quote", "POST"),
    ]:
        assert not allowed(path, method)


@pytest.mark.asyncio
async def test_guest_requires_trusted_gateway_bearer_and_private_routes_stay_denied():
    app = FastAPI()
    app.state.agent_service = SimpleNamespace(
        mode="fake", settings=SimpleNamespace(agent_api_token=SecretStr("trusted-token"))
    )

    async def endpoint():
        return {"ok": True}

    for path in ("/api/v1/chat", "/api/v1/chat/t/decision", "/api/v1/roommate/search"):
        app.add_api_route(path, endpoint, methods=["POST"], dependencies=[Depends(authenticate)])
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        for token in (None, "Bearer wrong"):
            headers = {"X-User-Id": GUEST}
            if token:
                headers["Authorization"] = token
            assert (await client.post("/api/v1/chat", headers=headers)).status_code == 401
        headers = {"X-User-Id": GUEST, "Authorization": "Bearer trusted-token"}
        assert (await client.post("/api/v1/chat", headers=headers)).status_code == 200
        for path in ("/api/v1/chat/t/decision", "/api/v1/roommate/search"):
            assert (await client.post(path, headers=headers)).status_code == 401
        headers["X-User-Id"] = "guest_spoof"
        assert (await client.post("/api/v1/chat", headers=headers)).status_code == 401


@pytest.mark.asyncio
async def test_claim_recovers_after_restart_between_checkpoint_and_draft_transfer(tmp_path):
    memory = InMemorySessionPort()
    await memory.save(
        GUEST,
        THREAD,
        [
            MemoryUpdate(group="preferences", key="city", value="Hà Nội"),
            MemoryUpdate(group="preferences", key="district", value="Cầu Giấy"),
        ],
    )
    await memory.save(ACCOUNT, "other-thread", [MemoryUpdate(group="preferences", key="city", value="Hồ Chí Minh")])
    deps = SimpleNamespace(settings=SimpleNamespace(recursion_limit=50), session=memory)
    db = sqlite3.connect(tmp_path / "checkout.db", isolation_level=None)
    store = CheckoutStore(db)
    store.put_tx(
        ServiceTransaction(
            transaction_id="tx_guest",
            user_id=GUEST,
            thread_id=THREAD,
            logical_key="housing:home",
            domain="property",
            option_id="home",
            status="selected",
            created_at=utcnow(),
            updated_at=utcnow(),
        )
    )
    checkpoint = str(tmp_path / "checkpoints.db")
    body = GuestClaim(thread_id=THREAD, target_user=ACCOUNT, operation_key="key_" + "3" * 40)

    def graph(saver):
        builder = StateGraph(WorkflowState)
        builder.add_node("respond", lambda state: {})
        builder.add_edge(START, "respond")
        builder.add_edge("respond", END)
        return builder.compile(checkpointer=saver)

    def interrupted_transaction():
        raise RuntimeError("Simulated process failure before draft transfer")

    async with AsyncSqliteSaver.from_conn_string(checkpoint) as saver:
        workflow = graph(saver)
        service = SimpleNamespace(
            deps=deps, graph=workflow, locks={}, viewing=SimpleNamespace(store=store), checkout=None
        )
        await workflow.ainvoke(
            {"user_id": GUEST, "thread_id": THREAD, "messages": [HumanMessage("Tìm nhà")]}, run_config(THREAD, deps)
        )
        original = store.transaction
        store.transaction = interrupted_transaction
        with pytest.raises(RuntimeError):
            await claim(body, service, GUEST)
        store.transaction = original
    # New graph/checkpointer and lock registry, using persisted journal.
    async with AsyncSqliteSaver.from_conn_string(checkpoint) as saver:
        service = SimpleNamespace(
            deps=deps, graph=graph(saver), locks={}, viewing=SimpleNamespace(store=store), checkout=None
        )
        assert await claim(body, service, GUEST) == {"claimed": True}
        assert await claim(body, service, GUEST) == {"claimed": True}
        values = (await service.graph.aget_state(run_config(THREAD, deps))).values
        assert values["user_id"] == ACCOUNT and values["guest_claim"]["complete"]
        assert values["messages"][0].content == "Tìm nhà"
        assert store.list_tx(ACCOUNT, THREAD)[0].user_id == ACCOUNT
        # Preserve existing account preferences; do not merge an incompatible district.
        preferences = (await memory.load(ACCOUNT)).preferences
        assert preferences["city"].value == "Hồ Chí Minh" and "district" not in preferences
        assert not (await memory.load(GUEST)).preferences
    db.close()
