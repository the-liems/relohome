"""Client cho giao diện demo vé máy bay: flight MCP server over HTTP + kiểm tra tài khoản SerpApi."""

import os
import time
from typing import Any, Literal

import httpx

from src.ui import mcp_client
from src.ui.mcp_client import CallRecord, ServerInfo

__all__ = ["CallRecord", "Mode", "ServerInfo", "call_tool", "check_serpapi_account", "inspect_server"]

Mode = Literal["mock", "serpapi"]

SERPAPI_ACCOUNT_URL = "https://serpapi.com/account.json"
# Chỉ giữ các trường không nhạy cảm của account.json (bỏ api_key, email)
SERPAPI_ACCOUNT_FIELDS = (
    "plan_name",
    "searches_per_month",
    "plan_searches_left",
    "total_searches_left",
    "this_month_usage",
    "account_rate_limit_per_hour",
)


def server_params(mode: Mode, api_key: str) -> mcp_client.HttpServerParameters:
    """Provider mode belongs to the service; select its configured URL."""
    url = os.environ.get(f"FLIGHT_{mode.upper()}_MCP_URL") or os.environ.get("FLIGHT_MCP_URL")
    if not url:
        raise ValueError("Set FLIGHT_MCP_URL to the running service")
    return mcp_client.HttpServerParameters(url, os.environ.get("FLIGHT_MCP_TOKEN", ""))


def call_tool(mode: Mode, api_key: str, tool: str, arguments: dict[str, Any]) -> CallRecord:
    return mcp_client.call_tool(server_params(mode, api_key), mode, tool, arguments)


def inspect_server(mode: Mode, api_key: str) -> ServerInfo:
    return mcp_client.inspect_server(server_params(mode, api_key))


def check_serpapi_account(api_key: str) -> dict[str, Any]:
    """Kiểm tra API key SerpApi qua endpoint account (không tốn lượt tìm kiếm)."""
    started = time.perf_counter()
    try:
        response = httpx.get(SERPAPI_ACCOUNT_URL, params={"api_key": api_key}, timeout=15)
    except httpx.HTTPError as exc:  # không đưa str(exc) ra ngoài vì URL có api_key
        raise RuntimeError(f"Không kết nối được SerpApi ({type(exc).__name__}).") from exc
    latency_ms = int((time.perf_counter() - started) * 1000)
    if response.status_code == 401:
        raise RuntimeError("API key SerpApi không hợp lệ (HTTP 401).")
    if response.status_code >= 400:
        raise RuntimeError(f"SerpApi trả về HTTP {response.status_code}.")
    data = response.json()
    return {"http_status": response.status_code, "latency_ms": latency_ms} | {
        k: data.get(k) for k in SERPAPI_ACCOUNT_FIELDS
    }
