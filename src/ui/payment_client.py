"""Client cho giao diện demo thanh toán: payment MCP server qua stdio.

Key ZaloPay KHÔNG đi qua giao diện: server tự đọc từ .env (xem ADR-007).
"""

from typing import Any, Literal

from mcp import StdioServerParameters

from src.ui import mcp_client
from src.ui.mcp_client import CallRecord, ServerInfo

__all__ = ["CallRecord", "Mode", "ServerInfo", "call_tool", "inspect_server"]

Mode = Literal["mock", "zalopay"]


def server_params(mode: Mode) -> StdioServerParameters:
    return mcp_client.stdio_params("src.mcp_servers.payments", {"PAYMENT_PROVIDER": mode})


def call_tool(mode: Mode, tool: str, arguments: dict[str, Any]) -> CallRecord:
    return mcp_client.call_tool(server_params(mode), mode, tool, arguments)


def inspect_server(mode: Mode) -> ServerInfo:
    return mcp_client.inspect_server(server_params(mode))
