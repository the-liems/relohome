"""McpToolClient qua Streamable HTTP + Bearer (đường nối dùng cho Location và Moving), thử với Flight MCP thật."""

import asyncio
import os
import socket
import sys

import httpx
import pytest
from relohome_agent.services.adapters.mcp import McpEndpoint, McpToolClient, ToolCallError

from tests.mcp_http import TEST_MCP_TOKEN


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
    try:
        async with httpx.AsyncClient() as http:
            for _ in range(100):
                try:
                    if (await http.get(f"http://127.0.0.1:{port}/health")).status_code == 200:
                        break
                except httpx.HTTPError:
                    await asyncio.sleep(0.1)
        endpoint = McpEndpoint(
            "flight", frozenset({"search_airports"}), url=f"http://127.0.0.1:{port}/mcp", token=TEST_MCP_TOKEN
        )
        client = McpToolClient(endpoint)
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
