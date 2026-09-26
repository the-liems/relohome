"""Nạp tool của flight MCP server để dùng trong LangGraph agent.

Ví dụ:
    tools = await get_flight_tools()
    agent = create_agent(get_llm(), tools)  # from langchain.agents import create_agent

Mặc định tự mở server qua stdio. Đặt `FLIGHT_MCP_URL` (ví dụ `http://flights-mcp:8765/mcp`
trong docker compose) để gọi server đang chạy trong container qua Streamable HTTP.
"""

import os
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from langchain_core.tools import BaseTool
from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_mcp_adapters.sessions import StdioConnection, StreamableHttpConnection
from langchain_mcp_adapters.tools import load_mcp_tools

FLIGHT_SERVER_NAME = "flights"
PROJECT_ROOT = Path(__file__).resolve().parents[3]


def flight_server_connection() -> StdioConnection | StreamableHttpConnection:
    """HTTP nếu có `FLIGHT_MCP_URL`; nếu không thì chạy server qua stdio bằng chính Python đang dùng,
    tại thư mục gốc dự án (để đọc .env)."""
    url = os.environ.get("FLIGHT_MCP_URL")
    if url:
        return {"transport": "streamable_http", "url": url}
    return {
        "transport": "stdio",
        "command": sys.executable,
        "args": ["-m", "src.mcp_servers.flights"],
        "cwd": str(PROJECT_ROOT),
        "env": dict(os.environ),
    }


def create_flight_client() -> MultiServerMCPClient:
    return MultiServerMCPClient({FLIGHT_SERVER_NAME: flight_server_connection()})


async def get_flight_tools() -> list[BaseTool]:
    """Tool dạng stateless: mỗi lần gọi tool sẽ mở một process server mới.

    Trạng thái (offer, booking) nằm trong SQLite nên vẫn liền mạch giữa các lần gọi.
    """
    return await create_flight_client().get_tools(server_name=FLIGHT_SERVER_NAME)


@asynccontextmanager
async def flight_tools_session() -> AsyncIterator[list[BaseTool]]:
    """Giữ một process server cho cả phiên hội thoại (nhanh hơn khi gọi nhiều tool liên tiếp)."""
    async with create_flight_client().session(FLIGHT_SERVER_NAME) as session:
        yield await load_mcp_tools(session)
