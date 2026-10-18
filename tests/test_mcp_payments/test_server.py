from typing import Any

import pytest
from mcp.client import Client
from relohome_mcp_http import create_http_app
from relohome_payment.engine import PaymentEngine
from relohome_payments_mcp.server import SERVER_NAME, create_server
from relohome_payments_mcp.tools import PaymentServices
from starlette.testclient import TestClient

from tests.mcp_http import TEST_MCP_TOKEN

BASE_TOOLS = {"create_payment", "get_payment", "cancel_payment", "refund_payment"}


async def call(session: Client, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    result = await session.call_tool(name, arguments)
    assert not result.is_error, result.content
    assert result.structured_content is not None
    return result.structured_content


@pytest.mark.asyncio
async def test_mock_server_full_flow(engine: PaymentEngine) -> None:
    server = create_server(PaymentServices(engine=engine))
    async with Client(server) as session:
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
    async with Client(server) as session:
        assert {t.name for t in (await session.list_tools()).tools} == BASE_TOOLS


@pytest.mark.asyncio
async def test_pii_error_over_mcp_does_not_echo_value(engine: PaymentEngine) -> None:
    server = create_server(PaymentServices(engine=engine))
    async with Client(server) as session:
        result = await session.call_tool(
            "create_payment", {"order_ref": "an.nguyen@gmail.com", "amount": 100_000, "customer_ref": "0901234567"}
        )
    text = " ".join(getattr(c, "text", "") for c in result.content)
    assert result.is_error
    assert "an.nguyen@gmail.com" not in text and "0901234567" not in text


def test_health_and_container_host(engine: PaymentEngine) -> None:
    server = create_server(PaymentServices(engine=engine))
    response = TestClient(create_http_app(server, TEST_MCP_TOKEN, host="0.0.0.0")).get("/health")
    assert response.json() == {"status": "ok", "server": SERVER_NAME, "provider": "mock", "simulation": True, "environment": "mock"}

