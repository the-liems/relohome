"""Client cho giao diện demo vé máy bay: flight MCP server qua stdio + kiểm tra tài khoản SerpApi."""

import time
from typing import Any, Literal

import httpx
from mcp import StdioServerParameters

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


def server_params(mode: Mode, api_key: str) -> StdioServerParameters:
    """Chạy `python -m src.mcp_servers.flights` với provider được chọn."""
    env = {"FLIGHT_SEARCH_PROVIDER": mode}
    if api_key:
        env["FLIGHT_SERPAPI_API_KEY"] = api_key
    return mcp_client.stdio_params("src.mcp_servers.flights", env)


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
