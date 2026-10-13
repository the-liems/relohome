"""Client cho giao diện demo vé máy bay: flight MCP server over HTTP."""

import os
from typing import Any, Literal

from relohome_demos import mcp_client
from relohome_demos.mcp_client import CallRecord, ServerInfo

__all__ = ["CallRecord", "Mode", "ServerInfo", "call_tool", "inspect_server"]

Mode = Literal["mock", "serpapi"]


def server_params(mode: Mode) -> mcp_client.HttpServerParameters:
    """Provider mode belongs to the service; select its configured URL."""
    url = os.environ.get(f"FLIGHT_{mode.upper()}_MCP_URL") or os.environ.get("FLIGHT_MCP_URL")
    if not url:
        raise ValueError("Set FLIGHT_MCP_URL to the running service")
    return mcp_client.HttpServerParameters(url, os.environ.get("FLIGHT_MCP_AUTH_TOKEN", ""))


def call_tool(mode: Mode, tool: str, arguments: dict[str, Any]) -> CallRecord:
    return mcp_client.call_tool(server_params(mode), mode, tool, arguments)


def inspect_server(mode: Mode) -> ServerInfo:
    return mcp_client.inspect_server(server_params(mode))
