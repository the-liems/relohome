"""Client cho giao diện demo thanh toán: payment MCP server over HTTP.

Key ZaloPay KHÔNG đi qua giao diện: server tự đọc từ .env (xem ADR-015).
"""

import os
from typing import Any, Literal

from relohome_demos import mcp_client
from relohome_demos.mcp_client import CallRecord, ServerInfo

__all__ = ["CallRecord", "Mode", "ServerInfo", "call_tool", "inspect_server"]

Mode = Literal["mock", "zalopay"]


def server_params(mode: Mode) -> mcp_client.HttpServerParameters:
    """Provider mode belongs to the service; select its configured URL."""
    url = os.environ.get(f"PAYMENT_{mode.upper()}_MCP_URL") or os.environ.get("PAYMENT_MCP_URL")
    if not url:
        raise ValueError("Set PAYMENT_MCP_URL to the running service")
    return mcp_client.HttpServerParameters(url, os.environ.get("PAYMENT_MCP_AUTH_TOKEN", ""))


def call_tool(mode: Mode, tool: str, arguments: dict[str, Any]) -> CallRecord:
    return mcp_client.call_tool(server_params(mode), mode, tool, arguments)


def inspect_server(mode: Mode) -> ServerInfo:
    return mcp_client.inspect_server(server_params(mode))
