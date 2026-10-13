"""Explicit opt-in sandbox writes only. Never executed by normal CI.

Creates one AhaMove staging order then cancels it, and one 1,000 VND ZaloPay
sandbox request (does NOT pay it). Requires operator approval before enabling.
"""

import json
import os
from uuid import uuid4

import httpx
import pytest

from tests import live

pytestmark = pytest.mark.skipif(os.getenv("RUN_SANDBOX_WRITES") != "1", reason="Operator-approved sandbox writes only")


@pytest.fixture
def client():
    with httpx.Client(
        base_url="http://127.0.0.1:8000/api/v1",
        timeout=240,
        headers={"Authorization": "Bearer " + live.api_token(), "X-User-Id": "sandbox-acceptance"},
    ) as c:
        status = c.get("/status").json()
        assert status["writes_enabled"] and status["sandbox_payments_enabled"]
        yield c


def test_zalopay_create_query_and_idempotency(client):
    body = {"request_id": str(uuid4()), "amount_vnd": 1000, "confirmed": True}
    created = client.post("/sandbox/payments", json=body)
    assert created.status_code == 200, created.text
    payment = created.json()
    assert payment["provider"] == "zalopay" and payment["status"] == "PENDING"
    assert payment.get("pay_url") or payment.get("qr_code")
    repeated = client.post("/sandbox/payments", json=body)
    assert repeated.json()["payment_id"] == payment["payment_id"]
    assert client.post("/sandbox/payments", json={**body, "amount_vnd": 2000}).status_code == 409
    assert (
        client.get("/sandbox/payments/" + payment["payment_id"], headers={"X-User-Id": "other-user"}).status_code == 404
    )
    checked = client.get("/sandbox/payments/" + payment["payment_id"])
    assert checked.status_code == 200
    assert checked.json()["status"] in {"PENDING", "EXPIRED"}
    print("Sandbox payment created and queried; no payment was made.")


def test_moving_create_then_cancel(client):
    route = json.loads(live.env_test("MOVING_LIVE_QUOTE_INPUTS"))
    pins = {
        "pickup": {"address": route["from_address"], **route["pickup_coordinate"], "confirmed": True},
        "destination": {"address": route["to_address"], **route["destination_coordinate"], "confirmed": True},
    }
    result = client.post(
        "/chat",
        json={
            "message": f"Đặt xe chuyển đồ từ {route['from_address']} đến {route['to_address']} ngày mai lúc 10 giờ sáng. Tôi đã xác nhận tọa độ trên form.",
            "moving_locations": pins,
        },
    )
    assert result.status_code == 200, result.status_code
    proposal = result.json()
    assert proposal["status"] == "pending_confirmation", proposal
    confirmation, thread = proposal["confirmation"], proposal["thread_id"]
    decision = {
        "kind": "CONFIRM",
        "plan_version": confirmation["plan_version"],
        "payload_hash": confirmation["payload_hash"],
    }
    assert client.post(f"/chat/{thread}/decision", json={**decision, "payload_hash": "wrong"}).status_code == 409
    assert client.post(f"/chat/{thread}/decision", json=decision).status_code == 422
    contact = {
        "name": live.env_test("MOVING_QUOTE_CONTACT_NAME"),
        "mobile": live.env_test("MOVING_QUOTE_CONTACT_MOBILE"),
    }
    decision["pii_forms"] = {
        action: {"pickup_contact": contact, "destination_contact": contact} for action in confirmation["pii_required"]
    }
    created = client.post(f"/chat/{thread}/decision", json=decision)
    assert created.status_code == 200, created.status_code
    state = client.get(f"/chat/{thread}/state").json()
    receipts = [r for r in state["committed"].values() if r["kind"] == "moving_booking"]
    assert len(receipts) == 1, created.json()
    order_id = receipts[0]["receipt_id"]
    print("Created staging order", order_id, "thread", thread)
    # Duplicate confirmation must not create a second order.
    assert client.post(f"/chat/{thread}/decision", json=decision).status_code == 409
    cancel = client.post("/chat", json={"message": f"Hủy đơn chuyển đồ AhaMove {order_id}", "thread_id": thread}).json()
    assert cancel["status"] == "pending_confirmation", cancel
    confirm = cancel["confirmation"]
    cancelled = client.post(
        f"/chat/{thread}/decision",
        json={"kind": "CONFIRM", "plan_version": confirm["plan_version"], "payload_hash": confirm["payload_hash"]},
    )
    assert cancelled.status_code == 200, cancelled.status_code
    state = client.get(f"/chat/{thread}/state").json()
    cancellations = [
        r for r in state["committed"].values() if r["kind"] == "cancel_order" and r["receipt_id"] == order_id
    ]
    assert cancellations and cancellations[0]["status"] == "CANCELLED", cancelled.json()
    print("Cancelled staging order", order_id)
