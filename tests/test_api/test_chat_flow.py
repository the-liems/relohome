"""Chat API với graph (agent-graph.md §9): chat → xác nhận + form → thanh toán → xong."""

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from src.agents.intake import ScriptedIntake
from src.agents.models import AgentName, CommitActionKind, RequestKind
from src.agents.planning import TemplatePlanner
from src.agents.wiring import AgentService
from src.main import app
from src.services.adapters.registry import ServiceSettings
from tests.test_agents.helpers import commit_fact, intake_result

HEADERS = {"X-User-Id": "u1"}


def booking_intake():
    return intake_result(
        RequestKind.NEW_GOAL,
        [AgentName.FLIGHT],
        values={"origin": "HAN", "destination": "SGN", "flight_date": "2026-11-15"},
        facts=dict([commit_fact(CommitActionKind.FLIGHT_BOOKING, "Đặt vé")]),
    )


@pytest_asyncio.fixture
async def api():
    service = AgentService.create(
        ScriptedIntake([booking_intake()]), TemplatePlanner(), ServiceSettings(_env_file=None)
    )
    app.state.agent_service = service
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client, service
    del app.state.agent_service


@pytest.mark.asyncio
async def test_booking_flow_over_http(api):
    client, service = api
    r = await client.post("/api/v1/chat", json={"message": "Đặt vé HN - SG ngày 15/11"}, headers=HEADERS)
    body = r.json()
    assert r.status_code == 200 and body["status"] == "pending_confirmation"
    thread_id, confirmation = body["thread_id"], body["confirmation"]

    other = await client.get(f"/api/v1/chat/{thread_id}/state", headers={"X-User-Id": "u2"})
    assert other.status_code == 404  # thread của người khác

    stale = await client.post(
        f"/api/v1/chat/{thread_id}/decision",
        headers=HEADERS,
        json={"kind": "CONFIRM", "plan_version": confirmation["plan_version"], "payload_hash": "0" * 64},
    )
    assert stale.status_code == 409

    r = await client.post(
        f"/api/v1/chat/{thread_id}/decision",
        headers=HEADERS,
        json={
            "kind": "CONFIRM",
            "plan_version": confirmation["plan_version"],
            "payload_hash": confirmation["payload_hash"],
            "pii_forms": {
                "flight_booking:t1": {
                    "passengers": [{"first_name": "A"}],
                    "contact": {"email": "a@b.c", "phone": "0901234567"},
                }
            },
        },
    )
    body = r.json()
    assert body["status"] == "pending_payment" and body["payment"]["pay_url"]

    r = await client.post("/api/v1/chat", json={"message": "sao lâu vậy", "thread_id": thread_id}, headers=HEADERS)
    assert r.json()["status"] == "pending_payment"  # chat không đổi luồng thanh toán

    r = await client.post(f"/api/v1/chat/{thread_id}/payment/check", headers=HEADERS)
    body = r.json()
    assert body["status"] == "done" and body["response"]["kind"] == "COMMITTED"

    state = (await client.get(f"/api/v1/chat/{thread_id}/state", headers=HEADERS)).json()
    assert "flight_booking:t1" in state["committed"]
    assert "0901234567" not in str(state)


@pytest.mark.asyncio
async def test_status_lists_domains(api):
    client, _ = api
    body = (await client.get("/api/v1/status")).json()
    assert body["mode"] == "fake" and set(body["domains"]) == {"property", "map", "flight", "relocation"}


@pytest.mark.asyncio
async def test_default_app_answers_unsupported(client):
    r = await client.post("/api/v1/chat", json={"message": "Tìm phòng giúp mình"}, headers=HEADERS)
    body = r.json()
    assert body["status"] == "done" and body["response"]["kind"] == "UNSUPPORTED"
