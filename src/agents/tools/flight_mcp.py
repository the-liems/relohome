"""Nạp tool của flight MCP server để dùng trong LangGraph agent.

Ví dụ:
    tools = await get_flight_tools()
    agent = create_agent(get_llm(), tools)  # from langchain.agents import create_agent

Set `FLIGHT_MCP_URL` to the dedicated Streamable HTTP service.
"""

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from langchain_core.tools import BaseTool
from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_mcp_adapters.sessions import StreamableHttpConnection
from langchain_mcp_adapters.tools import load_mcp_tools

FLIGHT_SERVER_NAME = "flights"


def flight_server_connection() -> StreamableHttpConnection:
    """Connect to the configured dedicated HTTP service; never start a child."""
    url = os.environ.get("FLIGHT_MCP_URL")
    if not url:
        raise ValueError("Set FLIGHT_MCP_URL to the running flight service")
    connection: StreamableHttpConnection = {"transport": "streamable_http", "url": url}
    if token := os.environ.get("FLIGHT_MCP_TOKEN"):
        connection["headers"] = {"Authorization": f"Bearer {token}"}
    return connection


def create_flight_client() -> MultiServerMCPClient:
    return MultiServerMCPClient({FLIGHT_SERVER_NAME: flight_server_connection()})


async def get_flight_tools() -> list[BaseTool]:
    """Load tools from the running HTTP service."""
    return await create_flight_client().get_tools(server_name=FLIGHT_SERVER_NAME)


@asynccontextmanager
async def flight_tools_session() -> AsyncIterator[list[BaseTool]]:
    """Keep one HTTP MCP session for the conversation."""
    async with create_flight_client().session(FLIGHT_SERVER_NAME) as session:
        yield await load_mcp_tools(session)
