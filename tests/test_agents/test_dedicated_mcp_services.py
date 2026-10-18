"""Dedicated services own provider state; agent clients only use HTTP."""

import asyncio
from contextlib import aclosing

import httpx
import pytest
from relohome_agent.agents.wiring import verify_sandbox_payment_service
from relohome_agent.config import Settings
from relohome_agent.services.adapters.mcp import McpEndpoint, McpToolClient, ToolCallError
from relohome_agent.services.adapters.registry import ServiceRegistry
from relohome_payment.settings import PaymentSettings
from relohome_payments_mcp.server import create_server
from relohome_payments_mcp.tools import build_services

from tests.mcp_http import running_mcp


@pytest.mark.asyncio
async def test_payment_http_auth_state_and_no_application_subprocess(tmp_path, monkeypatch):
    server = create_server(build_services(PaymentSettings(
        _env_file=None, provider="mock", db_path=str(tmp_path / "payment.db")
    )))

    async def forbidden_spawn(*args, **kwargs):
        raise AssertionError("Application attempted to launch a provider process")

    monkeypatch.setattr(asyncio, "create_subprocess_exec", forbidden_spawn)
    async with running_mcp(server, token="service-token-01234567890123456789") as url:
        async with httpx.AsyncClient() as http:
            assert (await http.post(url)).status_code == 401
            assert (await http.post(url, headers={"Authorization": "Bearer wrong"})).status_code == 401
            assert (await http.post(url, headers={
                "Authorization": "Bearer service-token-01234567890123456789", "Origin": "https://untrusted.example"
            })).status_code == 403
        registry = ServiceRegistry.from_settings(Settings(
            _env_file=None, payment_mcp_url=url, payment_mcp_auth_token="service-token-01234567890123456789", payment_simulation_enabled=True
        ))
        denied = McpToolClient(McpEndpoint("payment", frozenset({"get_payment"}), url=url, token="wrong"))
        with pytest.raises(ToolCallError) as error:
            async with aclosing(denied):
                await denied.call("get_payment", {"payment_ref": "missing"})
        assert error.value.code == "UNAUTHORIZED"
        assert not error.value.retryable
        async with aclosing(registry):
            writer, reader = registry.payment.write_client(), registry.payment.read_client()
            created = await writer.call("create_payment", {"order_ref": "order_1", "amount": 100_000})
            # A different HTTP session still reads the state owned by the service.
            read = await reader.call("get_payment", {"payment_ref": created["payment_id"]})
            assert read["payment_id"] == created["payment_id"]
            await writer.call("simulate_payment_result", {"payment_ref": created["payment_id"], "outcome": "PAID"})
            assert (await reader.call("get_payment", {"payment_ref": created["payment_id"]}))["status"] == "PAID"
            with pytest.raises(ToolCallError, match="allowlist"):
                await reader.call("create_payment", {})


@pytest.mark.asyncio
async def test_missing_url_leaves_service_unconfigured_even_with_legacy_stdio_flags(monkeypatch):
    monkeypatch.setenv("FLIGHT_MCP_STDIO", "true")
    monkeypatch.setenv("PAYMENT_MCP_STDIO", "true")
    registry = ServiceRegistry.from_settings(Settings(_env_file=None, flight_mcp_url="", payment_mcp_url=""))
    assert registry.flight.read_client() is None
    assert registry.payment.write_client() is None
    with pytest.raises(ToolCallError, match="not configured"):
        async with McpToolClient(McpEndpoint("flight", frozenset()))._session():
            pass


@pytest.mark.asyncio
@pytest.mark.parametrize("provider,environment,accepted", [
    ("zalopay", "sandbox", True), ("zalopay", "unknown", False), ("mock", "mock", False),
])
async def test_sandbox_service_contract_without_local_merchant_keys(monkeypatch, provider, environment, accepted):
    original = httpx.AsyncClient

    def respond(request):
        assert str(request.url) == "http://payments:8766/health"
        assert request.headers["Authorization"] == "Bearer service-token-01234567890123456789"
        return httpx.Response(200, json={"provider": provider, "environment": environment})

    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: original(transport=httpx.MockTransport(respond), **kwargs))
    settings = Settings(_env_file=None, payment_mcp_url="http://payments:8766/mcp", payment_mcp_auth_token="service-token-01234567890123456789")
    if accepted:
        await verify_sandbox_payment_service(settings)
    else:
        with pytest.raises(ValueError, match="official ZaloPay sandbox"):
            await verify_sandbox_payment_service(settings)
