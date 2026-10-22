"""Local integration: real Flight/Payment HTTP MCP services, mock providers and temporary DBs.

This is default-suite coverage: it starts test-owned HTTP services on loopback and needs no provider credentials.

Đi đủ luồng §10.2 dòng 3: tìm chuyến → xác nhận + form hành khách → giữ chỗ → tạo thanh toán →
chờ PAID → xuất vé.
"""

from contextlib import aclosing
from datetime import date, timedelta

import pytest
from relohome_agent.agents.intake import ScriptedIntake
from relohome_agent.agents.models import AgentName, CommitActionKind, RequestKind
from relohome_agent.agents.planning import TemplatePlanner
from relohome_agent.agents.wiring import live_deps
from relohome_agent.config import Settings
from relohome_agent.services.adapters.registry import ServiceRegistry
from relohome_flight.settings import FlightSettings
from relohome_flights_mcp.server import create_server as flight_server
from relohome_payment.settings import PaymentSettings
from relohome_payments_mcp.server import create_server as payment_server
from relohome_payments_mcp.tools import build_services as payment_services

from tests.mcp_http import TEST_MCP_TOKEN, running_mcp
from tests.test_agents.helpers import Session, commit_fact, intake_result


@pytest.mark.asyncio
async def test_book_flight_through_real_flight_and_payment_servers(tmp_path, monkeypatch):
    flights = flight_server(settings=FlightSettings(
        _env_file=None, search_provider="mock", simulation_enabled=True, db_path=str(tmp_path / "flights.db")
    ))
    payments = payment_server(payment_services(PaymentSettings(
        _env_file=None, provider="mock", db_path=str(tmp_path / "payments.db")
    )))
    async with running_mcp(flights) as flight_url, running_mcp(payments) as payment_url:
        services = Settings(
            _env_file=None,
            agent_subagents="live",
            agent_allow_simulated_transactions=True,
            location_mcp_url="",
            moving_mcp_url="",
            flight_mcp_url=flight_url,
            flight_mcp_auth_token=TEST_MCP_TOKEN,
            payment_mcp_url=payment_url,
            payment_mcp_auth_token=TEST_MCP_TOKEN,
            payment_source_kind="demo",
            payment_simulation_enabled=True,
        )
        async with aclosing(ServiceRegistry.from_settings(services)) as registry:
            await booking_flow(monkeypatch, registry)


async def booking_flow(monkeypatch, registry):
    day = (date.today() + timedelta(days=30)).isoformat()
    intake = intake_result(
        RequestKind.NEW_GOAL,
        [AgentName.FLIGHT],
        values={"origin": "Hà Nội", "destination": "Đà Nẵng", "flight_date": day},
        facts=dict([commit_fact(CommitActionKind.FLIGHT_BOOKING, "Đặt vé")]),
    )
    deps, _, _ = live_deps(ScriptedIntake([intake]), TemplatePlanner(), registry)
    assert deps.agents.names() == [AgentName.FLIGHT]  # Location / Moving chưa cấu hình: không đăng ký
    assert "hold_booking" not in deps.agents.get(AgentName.FLIGHT).client.endpoint.allowed_tools
    assert "hold_booking" in deps.transaction.flight.endpoint.allowed_tools
    assert "simulate_payment_result" in deps.transaction.payment.endpoint.allowed_tools
    # Observe transaction MCP dispatch while forwarding every call to the local servers.
    # This verifies approval ordering without relying on DB initialization timing or private stores.
    flight_calls, payment_calls = [], []
    flight_call, payment_call = deps.transaction.flight.call, deps.transaction.payment.call

    async def observe_flight_call(tool, arguments):
        flight_calls.append(tool)
        return await flight_call(tool, arguments)

    async def observe_payment_call(tool, arguments):
        payment_calls.append(tool)
        return await payment_call(tool, arguments)

    monkeypatch.setattr(deps.transaction.flight, "call", observe_flight_call)
    monkeypatch.setattr(deps.transaction.payment, "call", observe_payment_call)
    s = Session(deps)

    out = await s.say("Đặt vé Hà Nội đi Đà Nẵng")
    confirmation = out["__interrupt__"][0].value
    assert confirmation["type"] == "confirmation_required"
    line = confirmation["cost_summary"]["lines"][0]
    assert line["option_id"].startswith("off_") and line["amount_vnd"] > 0
    # Searching must not create a booking or payment before approval.
    assert flight_calls == []
    assert payment_calls == []

    pii = {
        "flight_booking:t1": {
            "passengers": [
                {
                    "type": "adult",
                    "title": "MR",
                    "first_name": "VAN A",
                    "last_name": "NGUYEN",
                    "date_of_birth": "1995-05-05",
                }
            ],
            "contact": {"email": "a@example.com", "phone": "0901234567"},
        }
    }
    out = await s.confirm(out, pii)
    payment = out["__interrupt__"][0].value
    assert payment["type"] == "payment_required" and payment["amount_vnd"] == line["amount_vnd"]
    assert flight_calls == ["get_offer", "hold_booking"]
    assert payment_calls == ["create_payment"]

    state = await s.state()
    assert state["pending_payment"].source_kind == "demo"
    assert state["pending_payment"].pre_payment_receipt.status == "HELD"
    payment_ref = state["pending_payment"].payment_ref
    # Nút "giả lập đã thanh toán": transaction gọi simulate_payment_result của Payment mock
    assert await deps.transaction.simulate_payment(payment_ref, "PAID") == "PAID"

    out = await s.resume({"action": "check"})
    assert out["response"].kind == "COMMITTED"
    receipt = out["committed"]["flight_booking:t1"]
    assert receipt.status == "TICKETED" and receipt.source_kind == "demo"
    assert "0901234567" not in str(await s.state())
