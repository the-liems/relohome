"""McpTransaction cho Moving: báo giá lại, ghi approval sang Moving (Q22), tạo đơn CASH (Q21)."""

from contextlib import asynccontextmanager
from datetime import timedelta
from types import SimpleNamespace

import httpx2
import pytest
from mcp.types import CallToolResult
from relohome_agent.agents.common import utcnow
from relohome_agent.agents.models import Approval, CommitAction, CommitActionKind
from relohome_agent.services.adapters.commit import McpTransaction
from relohome_agent.services.adapters.mcp import McpEndpoint, McpToolClient, ToolCallError
from relohome_agent.services.adapters.moving_approval import moving_approval_id
from relohome_agent.services.adapters.ports import CommitError, CommitRequest
from relohome_agent.services.adapters.sqlite_runtime import RuntimeDatabase

from tests.test_agents.test_service_subagents import FakeToolClient, moving_client

APPROVAL = Approval(
    approval_id="0b8f6a4e-0000-4000-8000-000000000001",
    user_id="u1",
    thread_id="th",
    plan_version=2,
    payload_hash="h",
    created_at=utcnow(),
    expires_at=utcnow() + timedelta(minutes=10),
)
ACTION = CommitAction(
    id="moving_booking:t4",
    kind=CommitActionKind.MOVING_BOOKING,
    source_task_id="t4",
    pii_required=["pickup_contact", "destination_contact"],
)
ROUTE = {
    "pickup": {"address": "12 Láng Hạ", "lat": 21.0, "lng": 105.8},
    "destination": {"address": "45 Thành Thái", "lat": 10.77, "lng": 106.66},
    "order_time": None,
}
CONTACT = {"name": "Nguyen Van A", "mobile": "0901234567"}


class RecordingBridge:
    def __init__(self):
        self.calls = []

    async def register(self, **kw):
        self.calls.append(kw)
        return kw["approval_id"]


def request(amount=250_000, band=0.05) -> CommitRequest:
    return CommitRequest(
        action=ACTION,
        option_id="q_old:SGN-TRUCK-500",
        amount_vnd=amount,
        min_amount_vnd=int(amount * (1 - band)),
        max_amount_vnd=int(amount * (1 + band)),
        idempotency_key="k" * 64,
        approval=APPROVAL,
        option={"service_id": "SGN-TRUCK-500"},
        task_data={"route": ROUTE, "to_address": "45 Thành Thái"},
        pii={"pickup_contact": CONTACT, "destination_contact": CONTACT},
    )


def tx(client, bridge=None) -> McpTransaction:
    return McpTransaction(flight=None, payment=None, moving=client, moving_approvals=bridge)


def booking_client(total=250_000, existing=()):
    client = moving_client(total=total)
    client.handlers["find_move_orders_by_tracking_number"] = {"meta": {}, "orders": list(existing)}
    client.handlers["create_move_order"] = {
        "order": {"order_id": "O1", "status": "ASSIGNING", "shared_link": "https://t"}
    }
    return client


@pytest.mark.asyncio
async def test_moving_booking_registers_approval_then_creates_cash_order():
    client = booking_client()
    bridge = RecordingBridge()
    receipt = await tx(client, bridge).commit(request())
    tools = [c[0] for c in client.calls]
    assert tools == ["find_move_orders_by_tracking_number", "estimate_move", "create_move_order"]
    tracking = client.calls[0][1]["tracking_number"]
    estimate = client.calls[1][1]["draft"]
    assert estimate["pickup"]["mobile"] == "0901234567" and estimate["payment_method"] == "CASH"
    assert estimate["destinations"][0]["tracking_number"] == tracking and len(tracking) <= 30
    registered = bridge.calls[0]
    assert registered["action_type"] == "create"
    assert registered["payload"]["quote_id"] == "q1" and registered["payload"]["total_price"] == 250_000
    create = client.calls[2][1]
    assert create["approval_id"] == moving_approval_id(APPROVAL.approval_id, ACTION.id, "create:q1")
    assert receipt.receipt_id == "O1" and receipt.details["payment_method"] == "CASH"
    assert "0901234567" not in str(receipt.model_dump())


@pytest.mark.asyncio
async def test_price_within_consented_band_is_booked_at_actual_price():
    client = booking_client(total=260_000)  # +4%
    receipt = await tx(client, RecordingBridge()).commit(request(amount=250_000))
    assert receipt.amount_vnd == 260_000 and receipt.details["estimated_vnd"] == 250_000


@pytest.mark.asyncio
async def test_price_outside_band_stops_before_writing():
    client = booking_client(total=270_000)  # +8%
    bridge = RecordingBridge()
    with pytest.raises(CommitError, match="ngoài khoảng đã đồng ý"):
        await tx(client, bridge).commit(request(amount=250_000))
    assert bridge.calls == [] and "create_move_order" not in [c[0] for c in client.calls]


@pytest.mark.asyncio
async def test_existing_order_with_same_tracking_is_reused_not_recreated():
    client = booking_client(existing=[{"order_id": "O0", "status": "ACCEPTED"}])
    receipt = await tx(client, RecordingBridge()).commit(request())
    assert receipt.receipt_id == "O0"
    assert [c[0] for c in client.calls] == ["find_move_orders_by_tracking_number"]


@pytest.mark.asyncio
async def test_several_orders_with_same_tracking_is_uncertain():
    client = booking_client(existing=[{"order_id": "O0"}, {"order_id": "O9"}])
    with pytest.raises(CommitError) as err:
        await tx(client, RecordingBridge()).commit(request())
    assert err.value.uncertain


@pytest.mark.asyncio
async def test_missing_approval_endpoint_refuses_clearly():
    client = booking_client()
    with pytest.raises(CommitError, match="MOVING_APPROVAL_URL"):
        await tx(client).commit(request())
    assert "create_move_order" not in [c[0] for c in client.calls]


@pytest.mark.asyncio
async def test_flight_hold_amount_mismatch_releases_hold():
    flight = FakeToolClient(
        {
            "get_offer": {"offer": {"total_price": 100}},
            "hold_booking": {"booking_id": "bk_1", "total_price": 120, "hold_expires_at": None},
            "cancel_booking": {"status": "CANCELLED"},
        }
    )
    action = CommitAction(
        id="flight_booking:t1", kind=CommitActionKind.FLIGHT_BOOKING, source_task_id="t1", requires_payment=True
    )
    req = CommitRequest(
        action=action,
        option_id="off_1",
        amount_vnd=100,
        idempotency_key="k" * 64,
        approval=APPROVAL,
        pii={"passengers": [{}], "contact": {}},
    )
    with pytest.raises(CommitError, match="đã huỷ giữ chỗ"):
        await McpTransaction(flight=flight, payment=FakeToolClient({}), moving=None).start_payment(req)
    assert flight.calls[-1] == ("cancel_booking", {"booking_ref": "bk_1", "confirm": True})


@pytest.mark.asyncio
@pytest.mark.parametrize("total", [240_000, 260_000])
async def test_exact_price_change_requires_approval_before_any_write(total):
    client = booking_client(total=total)
    bridge = RecordingBridge()
    with pytest.raises(CommitError, match="ngoài khoảng đã đồng ý"):
        await tx(client, bridge).commit(request(band=0))
    assert bridge.calls == []
    assert [tool for tool, _ in client.calls] == ["find_move_orders_by_tracking_number", "estimate_move"]


@pytest.mark.asyncio
@pytest.mark.parametrize("after_dispatch", [False, True], ids=["before-dispatch", "after-dispatch"])
async def test_moving_disconnect_retry_boundary_survives_restart(tmp_path, monkeypatch, after_dispatch):
    """Exercise actual MCP classification and durable intents with a simulated session disconnect.

    In the post-dispatch case the session records the create as accepted, but returns no response.
    Tracking stays empty to model delayed visibility. No live provider or Moving DB is involved.
    """
    backend = booking_client()
    provider_creates = []
    disconnect = True
    sessions = 0

    class Session:
        async def call_tool(self, tool, arguments):
            if tool == "create_move_order":
                provider_creates.append(arguments)
                if disconnect:
                    raise httpx2.ReadError("response connection lost after acceptance")
            result = await backend.call(tool, arguments)
            return CallToolResult(content=[], structuredContent=result)

    @asynccontextmanager
    async def session():
        nonlocal sessions
        sessions += 1
        # Lookup and estimate succeed; only opening the create session fails before dispatch.
        if disconnect and not after_dispatch and sessions == 3:
            raise httpx2.ConnectError("connection failed before dispatch")
        yield Session()

    client = McpToolClient(
        McpEndpoint(
            service="moving",
            allowed_tools=frozenset({"find_move_orders_by_tracking_number", "estimate_move", "create_move_order"}),
        )
    )
    monkeypatch.setattr(client, "_session", session)
    req = request(band=0)
    db = RuntimeDatabase(str(tmp_path))
    transaction = tx(client, RecordingBridge())
    transaction.intent_store = db
    try:
        with pytest.raises(CommitError) as failed:
            await transaction.guarded_commit(req)
        assert failed.value.code == "unavailable"
        assert failed.value.uncertain is after_dispatch
        assert bool(db.get("write_intents", req.idempotency_key)) is after_dispatch
        assert len(provider_creates) == int(after_dispatch)
    finally:
        db.close()

    # A new transaction and reopened SQLite DB simulate a process restart.
    disconnect = False
    db = RuntimeDatabase(str(tmp_path))
    restarted = tx(client, RecordingBridge())
    restarted.intent_store = db
    prior_sessions = sessions
    try:
        if after_dispatch:
            with pytest.raises(CommitError) as blocked:
                await restarted.guarded_commit(req)
            assert blocked.value.uncertain and blocked.value.code == "pending_verification"
            assert sessions == prior_sessions  # No lookup, estimate, or second create on replay.
            assert db.get("write_intents", req.idempotency_key)["state"] == "started"
        else:
            receipt = await restarted.guarded_commit(req)
            assert receipt.receipt_id == "O1"
            assert db.get("write_intents", req.idempotency_key)["state"] == "done"
        assert len(provider_creates) == 1
    finally:
        db.close()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("error", "uncertain"),
    [
        (ToolCallError("BOOKING_STATE", "hold expired"), False),
        (ToolCallError("timeout", "flight timed out", retryable=True), True),
    ],
)
async def test_paid_ticketing_failure_is_uncertain_only_when_its_outcome_is_unknown(error, uncertain):
    def reject(_):
        raise error

    pending = SimpleNamespace(pre_payment_receipt=SimpleNamespace(receipt_id="bk_1"))
    transaction = McpTransaction(flight=FakeToolClient({"confirm_booking": reject}), payment=None, moving=None)
    with pytest.raises(CommitError) as failed:
        await transaction.complete_after_payment(request(), pending)
    assert failed.value.uncertain is uncertain
