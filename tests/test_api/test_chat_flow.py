"""Chat API với graph (agent-graph.md §9): chat → xác nhận + form → thanh toán → xong."""

import pytest
import pytest_asyncio
from relohome_agent.agents.intake import ScriptedIntake
from relohome_agent.agents.models import AgentName, CommitActionKind, RequestKind
from relohome_agent.agents.planning import TemplatePlanner
from relohome_agent.agents.wiring import AgentService
from relohome_agent.config import Settings

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
async def api(api_client_factory):
    service = AgentService.create(
        ScriptedIntake([booking_intake()]),
        TemplatePlanner(),
        Settings(_env_file=None, agent_subagents="fake"),
    )
    async with api_client_factory(service) as client:
        yield client, service


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
    assert r.status_code == 200
    assert body["status"] == "pending_payment" and body["payment"]["pay_url"]

    r = await client.post("/api/v1/chat", json={"message": "sao lâu vậy", "thread_id": thread_id}, headers=HEADERS)
    assert r.json()["status"] == "pending_payment"  # chat không đổi luồng thanh toán

    r = await client.post(f"/api/v1/chat/{thread_id}/payment/check", headers=HEADERS)
    body = r.json()
    assert r.status_code == 200
    assert body["status"] == "done" and body["response"]["kind"] == "COMMITTED"

    state = (await client.get(f"/api/v1/chat/{thread_id}/state", headers=HEADERS)).json()
    assert "flight_booking:t1" in state["committed"]
    assert "0901234567" not in str(state)


@pytest.mark.asyncio
async def test_status_lists_domains(api):
    client, _ = api
    response = await client.get("/api/v1/status")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ready" and body["mode"] == "fake"
    assert set(body["domains"]) == {"property", "map", "flight", "relocation", "payment", "roommate"}
    assert set(body["domain_agents"]) == set(body["domains"])


@pytest.mark.asyncio
async def test_default_app_answers_unsupported(client):
    """The default PassThroughIntake fallback has no domain understanding."""
    r = await client.post("/api/v1/chat", json={"message": "Tìm phòng giúp mình"}, headers=HEADERS)
    body = r.json()
    assert r.status_code == 200
    assert body["status"] == "done" and body["response"]["kind"] == "UNSUPPORTED"
    assert body["thread_id"].startswith("th_")


async def _pending_payment(client) -> str:
    r = await client.post("/api/v1/chat", json={"message": "Đặt vé HN - SG ngày 15/11"}, headers=HEADERS)
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "pending_confirmation"
    thread_id, confirmation = body["thread_id"], body["confirmation"]
    r = await client.post(
        f"/api/v1/chat/{thread_id}/decision",
        headers=HEADERS,
        json={
            "kind": "CONFIRM",
            "plan_version": confirmation["plan_version"],
            "payload_hash": confirmation["payload_hash"],
            "pii_forms": {"flight_booking:t1": {"passengers": [{"first_name": "A"}], "contact": {"phone": "1"}}},
        },
    )
    assert r.status_code == 200
    assert r.json()["status"] == "pending_payment"
    payment = r.json()["payment"]
    assert payment["simulation_available"] is True
    return thread_id


@pytest.mark.asyncio
async def test_simulated_payment_completes_booking(api):
    client, service = api
    thread_id = await _pending_payment(client)
    r = await client.post(f"/api/v1/chat/{thread_id}/payment/simulate", json={"outcome": "PAID"}, headers=HEADERS)
    body = r.json()
    assert r.status_code == 200
    assert body["status"] == "done" and body["response"]["kind"] == "COMMITTED"
    assert ("complete_after_payment", "flight_booking:t1") in service.deps.transaction.calls
    state = (await client.get(f"/api/v1/chat/{thread_id}/state", headers=HEADERS)).json()
    assert state["committed"]["flight_booking:t1"]["status"] == "ticketed"
    assert state["pending"] is None
    again = await client.post(f"/api/v1/chat/{thread_id}/payment/simulate", json={}, headers=HEADERS)
    assert again.status_code == 409  # không còn thanh toán nào đang chờ


@pytest.mark.asyncio
async def test_simulated_expiry_releases_hold(api):
    client, service = api
    thread_id = await _pending_payment(client)
    r = await client.post(f"/api/v1/chat/{thread_id}/payment/simulate", json={"outcome": "EXPIRED"}, headers=HEADERS)
    assert r.status_code == 200
    assert r.json()["status"] == "done" and r.json()["response"]["kind"] == "CANCELLED"
    assert service.deps.transaction.aborted == ["flight_booking:t1"]
    assert ("complete_after_payment", "flight_booking:t1") not in service.deps.transaction.calls
    state = (await client.get(f"/api/v1/chat/{thread_id}/state", headers=HEADERS)).json()
    assert state["committed"] == {} and state["pending"] is None


@pytest.mark.asyncio
async def test_simulation_is_off_in_live_mode_by_default(api_client_factory, monkeypatch):
    monkeypatch.delenv("PAYMENT_SIMULATION_ENABLED", raising=False)
    settings = Settings(
        _env_file=None,
        agent_subagents="live",
        agent_api_token="test-gateway-token",
        location_mcp_url="",
        moving_mcp_url="",
        moving_approval_url="",
        flight_mcp_url="",
        payment_mcp_url="",
    )
    service = AgentService.create(services=settings)
    service.settings = settings  # Live authentication uses the trusted gateway token.
    assert service.mode == "live" and service.payment_simulation is False
    headers = {**HEADERS, "Authorization": "Bearer test-gateway-token"}
    async with api_client_factory(service) as client:
        status = await client.get("/api/v1/status", headers=headers)
        assert status.status_code == 200 and status.json()["mode"] == "live"
        r = await client.post(
            "/api/v1/chat/disabled-simulation/payment/simulate", json={"outcome": "PAID"}, headers=headers
        )
        assert r.status_code == 404
        assert r.json()["detail"] == "Giả lập thanh toán không được bật."
