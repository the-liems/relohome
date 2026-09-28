from typing import Any

import pytest
from mcp import ClientSession
from mcp.shared.memory import create_connected_server_and_client_session
from starlette.testclient import TestClient

from src.agents.tools import payment_mcp
from src.mcp_servers.payments.engine import PaymentEngine
from src.mcp_servers.payments.server import SERVER_NAME, create_server
from src.mcp_servers.payments.tools import PaymentServices

BASE_TOOLS = {"create_payment", "get_payment", "cancel_payment", "refund_payment"}


async def call(session: ClientSession, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    result = await session.call_tool(name, arguments)
    assert not result.isError, result.content
    assert result.structuredContent is not None
    return result.structuredContent


@pytest.mark.asyncio
async def test_mock_server_full_flow(engine: PaymentEngine) -> None:
    server = create_server(PaymentServices(engine=engine))
    async with create_connected_server_and_client_session(server) as session:
        names = {t.name for t in (await session.list_tools()).tools}
        assert names == BASE_TOOLS | {"simulate_payment_result"}

        created = await call(session, "create_payment", {"order_ref": "bk_1", "amount": 250_000})
        paid = await call(session, "simulate_payment_result", {"payment_ref": created["payment_id"], "outcome": "PAID"})
        assert paid["status"] == "PAID"
        refund = await call(session, "refund_payment", {"payment_ref": created["payment_id"], "confirm": True})
        assert refund["status"] == "REFUNDED"


@pytest.mark.asyncio
async def test_real_gateway_has_no_simulate_tool(zalopay_engine: PaymentEngine) -> None:
    server = create_server(PaymentServices(engine=zalopay_engine))
    async with create_connected_server_and_client_session(server) as session:
        assert {t.name for t in (await session.list_tools()).tools} == BASE_TOOLS


@pytest.mark.asyncio
async def test_pii_error_over_mcp_does_not_echo_value(engine: PaymentEngine) -> None:
    server = create_server(PaymentServices(engine=engine))
    async with create_connected_server_and_client_session(server) as session:
        result = await session.call_tool(
            "create_payment", {"order_ref": "an.nguyen@gmail.com", "amount": 100_000, "customer_ref": "0901234567"}
        )
    text = " ".join(getattr(c, "text", "") for c in result.content)
    assert result.isError
    assert "an.nguyen@gmail.com" not in text and "0901234567" not in text


def test_health_and_container_host(engine: PaymentEngine) -> None:
    server = create_server(PaymentServices(engine=engine), host="0.0.0.0", port=8766)
    assert server.settings.transport_security is None
    response = TestClient(server.streamable_http_app()).get("/health")
    assert response.json() == {"status": "ok", "server": SERVER_NAME, "provider": "mock"}


def test_agent_connection_selection(monkeypatch) -> None:
    monkeypatch.setenv("PAYMENT_MCP_URL", "http://payments-mcp:8766/mcp")
    assert payment_mcp.payment_server_connection() == {
        "transport": "streamable_http",
        "url": "http://payments-mcp:8766/mcp",
    }
    monkeypatch.delenv("PAYMENT_MCP_URL")
    assert payment_mcp.payment_server_connection()["transport"] == "stdio"
