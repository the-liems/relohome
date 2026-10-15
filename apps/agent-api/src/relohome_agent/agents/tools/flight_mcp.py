"""Load tools from the dedicated flight MCP service."""

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastmcp.client.transports import StreamableHttpTransport
from langchain.mcp import MCPAdapter
from langchain_core.tools import BaseTool


def flight_server_connection() -> StreamableHttpTransport:
    url = os.environ.get("FLIGHT_MCP_URL")
    if not url:
        raise ValueError("Set FLIGHT_MCP_URL to the running flight service")
    headers = {}
    if token := os.environ.get("FLIGHT_MCP_AUTH_TOKEN"):
        headers["Authorization"] = f"Bearer {token}"
    return StreamableHttpTransport(url, headers=headers)


async def get_flight_tools() -> list[BaseTool]:
    """Discover tools; returned tools remain callable after discovery closes."""
    async with flight_tools_session() as tools:
        return tools


@asynccontextmanager
async def flight_tools_session() -> AsyncIterator[list[BaseTool]]:
    """Keep the connection open while the caller uses the tools."""
    async with MCPAdapter(flight_server_connection()) as adapter:
        yield await adapter.list_tools()
