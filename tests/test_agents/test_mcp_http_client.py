"""McpToolClient qua Streamable HTTP + Bearer (đường nối dùng cho Location và Moving), thử với Flight MCP thật."""

import asyncio
import logging
import os
import socket
import sys
from contextlib import aclosing

import httpx
import pytest
from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from relohome_agent.config import Settings
from relohome_agent.services.adapters.mcp import McpEndpoint, McpToolClient, ToolCallError
from relohome_agent.services.adapters.registry import ServiceRegistry

from tests.mcp_http import TEST_MCP_TOKEN, running_mcp


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.mark.asyncio
async def test_http_client_calls_tool_and_enforces_allowlist(tmp_path):
    port = free_port()
    env = {
        **os.environ,
        "FLIGHT_SEARCH_PROVIDER": "mock",
        "MCP_AUTH_TOKEN": TEST_MCP_TOKEN,
        "FLIGHT_DB_PATH": str(tmp_path / "f.db"),
        "FLIGHT_MCP_HOST": "127.0.0.1",
        "FLIGHT_MCP_PORT": str(port),
    }
    process = await asyncio.create_subprocess_exec(
        sys.executable,
        "-m",
        "relohome_flights_mcp",
        "--transport",
        "streamable-http",
        cwd=tmp_path,
        env=env,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )
    endpoint = McpEndpoint(
        "flight", frozenset({"search_airports"}), url=f"http://127.0.0.1:{port}/mcp", token=TEST_MCP_TOKEN
    )
    async with aclosing(McpToolClient(endpoint)) as client:
        try:
            async with httpx.AsyncClient() as http:
                for _ in range(100):
                    try:
                        if (await http.get(f"http://127.0.0.1:{port}/health")).status_code == 200:
                            break
                    except httpx.HTTPError:
                        await asyncio.sleep(0.1)
            airports = await client.call("search_airports", {"query": "Đà Nẵng", "limit": 1})
            assert airports[0]["code"] == "DAD"
            with pytest.raises(ToolCallError) as denied:
                await client.call("hold_booking", {"request": {}})
            assert denied.value.code == "tool_not_allowed"
        finally:
            process.terminate()
            await process.wait()

        with pytest.raises(ToolCallError) as down:
            await client.call("search_airports", {"query": "Huế"})
    assert down.value.transport and down.value.retryable


@pytest.mark.asyncio
async def test_location_accepts_large_boundary_events_without_relaxing_other_services():
    server = MCPServer("large-location-fixture")
    boundary = "x" * (1024 * 1024 + 1024)

    @server.tool()
    def search_areas() -> dict:
        return {"results": [{"area_id": "fixture-city", "geometry": boundary}]}

    async with running_mcp(server) as url:
        settings = Settings(_env_file=None, location_mcp_url=url, location_mcp_auth_token=TEST_MCP_TOKEN)
        async with aclosing(ServiceRegistry.from_settings(settings)) as registry:
            result = await registry.location.read_client().call("search_areas", {})
        assert result["results"][0]["geometry"] == boundary

        # Other endpoints retain the SDK's bounded 1 MiB default.
        ordinary = McpToolClient(McpEndpoint("flight", frozenset({"search_areas"}), url=url, token=TEST_MCP_TOKEN))
        with pytest.raises(ToolCallError) as limited:
            async with aclosing(ordinary):
                await ordinary.call("search_areas", {})
        assert limited.value.code == "unavailable"
        assert "1048576 byte limit" in repr(limited.value.__cause__)


@pytest.mark.asyncio
async def test_tool_errors_and_unreachable_servers_are_logged_without_contacts(caplog):
    server = MCPServer("failing-fixture")

    @server.tool()
    def estimate_move() -> dict:
        raise ToolError("Input validation error: contact rider@example.com is not allowed")

    caplog.set_level(logging.WARNING, logger="relohome_agent.services.adapters.mcp")
    async with running_mcp(server) as url:
        client = McpToolClient(McpEndpoint("moving", frozenset({"estimate_move"}), url=url, token=TEST_MCP_TOKEN))
        with pytest.raises(ToolCallError) as rejected:
            async with aclosing(client):
                await client.call("estimate_move", {})
    assert rejected.value.code == "TOOL_ERROR" and not rejected.value.transport
    logged = next(r for r in caplog.records if r.getMessage().startswith("mcp_tool_error"))
    assert logged.levelno == logging.WARNING
    assert "service=moving tool=estimate_move code=TOOL_ERROR retryable=False" in logged.getMessage()
    assert "[email]" in logged.getMessage() and "rider@example.com" not in logged.getMessage()

    caplog.clear()
    down = McpToolClient(McpEndpoint("moving", frozenset({"estimate_move"}), url=url, token=TEST_MCP_TOKEN))
    with pytest.raises(ToolCallError) as unreachable:
        async with aclosing(down):
            await down.call("estimate_move", {})
    assert unreachable.value.code == "unavailable"
    logged = next(r for r in caplog.records if r.getMessage().startswith("mcp_tool_unavailable"))
    assert "service=moving tool=estimate_move sent=False" in logged.getMessage()
    assert logged.exc_info is not None  # The connection cause is kept for root-cause analysis.


@pytest.mark.asyncio
async def test_registry_shares_one_http_client_per_endpoint_until_closed():
    server = MCPServer("pooled-fixture")

    @server.tool()
    def search_areas() -> dict:
        return {"results": []}

    async with running_mcp(server) as url:
        registry = ServiceRegistry.from_settings(
            Settings(_env_file=None, location_mcp_url=url, location_mcp_auth_token=TEST_MCP_TOKEN)
        )
        client = registry.location.read_client()
        assert registry.location.read_client() is client
        await client.call("search_areas", {})
        http = client._http
        await registry.location.read_client().call("search_areas", {})
        assert client._http is http and not http.is_closed
        await registry.aclose()
        assert http.is_closed
