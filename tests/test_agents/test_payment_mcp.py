import pytest
from langchain.mcp import MCPToolArtifact
from langchain_core.messages import ToolMessage
from relohome_agent.agents.tools import payment_mcp
from relohome_payment.settings import PaymentSettings
from relohome_payments_mcp.server import create_server
from relohome_payments_mcp.tools import build_services

from tests.mcp_http import TEST_MCP_TOKEN, running_mcp


@pytest.mark.asyncio
async def test_payment_tools_remain_callable_after_discovery(tmp_path, monkeypatch):
    services = build_services(PaymentSettings(_env_file=None, provider="mock", db_path=str(tmp_path / "payments.db")))
    async with running_mcp(create_server(services)) as url:
        monkeypatch.setenv("PAYMENT_MCP_URL", url)
        monkeypatch.setenv("PAYMENT_MCP_AUTH_TOKEN", TEST_MCP_TOKEN)
        tools = await payment_mcp.get_payment_tools()
        assert {tool.name for tool in tools} == {
            "create_payment", "get_payment", "cancel_payment", "refund_payment", "simulate_payment_result",
        }
        result = await next(t for t in tools if t.name == "create_payment").ainvoke({
            "type": "tool_call", "id": "payment-test", "name": "create_payment",
            "args": {"order_ref": "booking-test", "amount": 100_000, "customer_ref": "guest-test"},
        })
    assert isinstance(result, ToolMessage)
    assert result.status == "success"
    artifact: MCPToolArtifact = result.artifact
    assert artifact["structured_content"]["order_ref"] == "booking-test"
    assert artifact["structured_content"]["amount"] == 100_000
