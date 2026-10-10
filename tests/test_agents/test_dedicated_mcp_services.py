"""Dedicated services own provider state; agent clients only use HTTP."""

import asyncio

import httpx
import pytest

from src.agents.wiring import verify_sandbox_payment_service
from src.mcp_servers.payments.server import create_server
from src.mcp_servers.payments.settings import PaymentSettings
from src.mcp_servers.payments.tools import build_services
from src.services.adapters.mcp import McpEndpoint, McpToolClient, ToolCallError
from src.services.adapters.registry import ServiceRegistry, ServiceSettings
from tests.mcp_http import running_mcp


@pytest.mark.asyncio
async def test_payment_http_auth_state_and_no_application_subprocess(tmp_path, monkeypatch):
    server = create_server(build_services(PaymentSettings(
        _env_file=None, provider="mock", db_path=str(tmp_path / "payment.db")
    )), token="service-token")

    async def forbidden_spawn(*args, **kwargs):
        raise AssertionError("Application attempted to launch a provider process")

    monkeypatch.setattr(asyncio, "create_subprocess_exec", forbidden_spawn)
    async with running_mcp(server) as url:
        async with httpx.AsyncClient() as http:
            assert (await http.post(url)).status_code == 401
            assert (await http.post(url, headers={"Authorization": "Bearer wrong"})).status_code == 401
        registry = ServiceRegistry.from_settings(ServiceSettings(
            _env_file=None, payment_mcp_url=url, payment_mcp_token="service-token", payment_simulation_enabled=True
        ))
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
    registry = ServiceRegistry.from_settings(ServiceSettings(_env_file=None, flight_mcp_url="", payment_mcp_url=""))
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
        assert request.headers["Authorization"] == "Bearer service-token"
        return httpx.Response(200, json={"provider": provider, "environment": environment})

    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: original(transport=httpx.MockTransport(respond), **kwargs))
    settings = ServiceSettings(_env_file=None, payment_mcp_url="http://payments:8766/mcp", payment_mcp_token="service-token")
    if accepted:
        await verify_sandbox_payment_service(settings)
    else:
        with pytest.raises(ValueError, match="official ZaloPay sandbox"):
            await verify_sandbox_payment_service(settings)
