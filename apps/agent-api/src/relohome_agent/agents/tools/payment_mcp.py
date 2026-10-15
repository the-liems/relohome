"""Load tools from the dedicated payment MCP service."""

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastmcp.client.transports import StreamableHttpTransport
from langchain.mcp import MCPAdapter
from langchain_core.tools import BaseTool


def payment_server_connection() -> StreamableHttpTransport:
    url = os.environ.get("PAYMENT_MCP_URL")
    if not url:
        raise ValueError("Set PAYMENT_MCP_URL to the running payment service")
    headers = {}
    if token := os.environ.get("PAYMENT_MCP_AUTH_TOKEN"):
        headers["Authorization"] = f"Bearer {token}"
    return StreamableHttpTransport(url, headers=headers)


async def get_payment_tools() -> list[BaseTool]:
    """Discover tools; returned tools remain callable after discovery closes."""
    async with payment_tools_session() as tools:
        return tools


@asynccontextmanager
async def payment_tools_session() -> AsyncIterator[list[BaseTool]]:
    """Keep the connection open while the caller uses the tools."""
    async with MCPAdapter(payment_server_connection()) as adapter:
        yield await adapter.list_tools()
