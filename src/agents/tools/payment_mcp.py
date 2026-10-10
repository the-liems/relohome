"""Nạp tool của payment MCP server để dùng trong LangGraph agent.

Ví dụ:
    tools = await get_payment_tools()
    agent = create_agent(get_llm(), tools)  # from langchain.agents import create_agent

Set `PAYMENT_MCP_URL` to the dedicated Streamable HTTP service.
"""

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from langchain_core.tools import BaseTool
from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_mcp_adapters.sessions import StreamableHttpConnection
from langchain_mcp_adapters.tools import load_mcp_tools

PAYMENT_SERVER_NAME = "payments"


def payment_server_connection() -> StreamableHttpConnection:
    """Connect to the configured dedicated HTTP service; never start a child."""
    url = os.environ.get("PAYMENT_MCP_URL")
    if not url:
        raise ValueError("Set PAYMENT_MCP_URL to the running payment service")
    connection: StreamableHttpConnection = {"transport": "streamable_http", "url": url}
    if token := os.environ.get("PAYMENT_MCP_AUTH_TOKEN"):
        connection["headers"] = {"Authorization": f"Bearer {token}"}
    return connection


def create_payment_client() -> MultiServerMCPClient:
    return MultiServerMCPClient({PAYMENT_SERVER_NAME: payment_server_connection()})


async def get_payment_tools() -> list[BaseTool]:
    """Load tools from the running HTTP service."""
    return await create_payment_client().get_tools(server_name=PAYMENT_SERVER_NAME)


@asynccontextmanager
async def payment_tools_session() -> AsyncIterator[list[BaseTool]]:
    """Keep one HTTP MCP session for the conversation."""
    async with create_payment_client().session(PAYMENT_SERVER_NAME) as session:
        yield await load_mcp_tools(session)
