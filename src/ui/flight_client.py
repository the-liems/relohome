"""Client MCP cho giao diện demo: mở flight MCP server qua stdio và gọi tool đúng như agent thật.

Mỗi lần gọi mở một process server mới với `FLIGHT_SEARCH_PROVIDER` tương ứng chế độ mock/thật.
Trạng thái (offer, booking) nằm trong SQLite nên vẫn liền mạch giữa các lần gọi.
"""

import asyncio
import json
import os
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Literal

import httpx
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.types import CallToolResult, TextContent

from src.mcp_servers.flights.settings import now_vn

Mode = Literal["mock", "serpapi"]

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SERPAPI_ACCOUNT_URL = "https://serpapi.com/account.json"
CALL_TIMEOUT_SECONDS = 60.0
# Chỉ giữ các trường không nhạy cảm của account.json (bỏ api_key, email)
SERPAPI_ACCOUNT_FIELDS = (
    "plan_name",
    "searches_per_month",
    "plan_searches_left",
    "total_searches_left",
    "this_month_usage",
    "account_rate_limit_per_hour",
)


@dataclass
class CallRecord:
    """Một lần gọi tool MCP, dùng cho nhật ký API trên giao diện."""

    tool: str
    mode: Mode
    arguments: dict[str, Any]
    ok: bool
    result: Any
    tool_ms: int
    total_ms: int
    at: datetime = field(default_factory=now_vn)


@dataclass
class ServerInfo:
    name: str
    version: str
    protocol_version: str
    instructions: str
    tools: list[dict[str, Any]]
    resources: list[str]
    total_ms: int


def server_params(mode: Mode, api_key: str) -> StdioServerParameters:
    """Chạy `python -m src.mcp_servers.flights` với provider được chọn (biến môi trường ưu tiên hơn .env)."""
    env = {**os.environ, "FLIGHT_SEARCH_PROVIDER": mode}
    if api_key:
        env["FLIGHT_SERPAPI_API_KEY"] = api_key
    return StdioServerParameters(
        command=sys.executable, args=["-m", "src.mcp_servers.flights"], cwd=str(PROJECT_ROOT), env=env
    )


def _unwrap(result: CallToolResult) -> tuple[bool, Any]:
    """Lấy dữ liệu có cấu trúc (hoặc message lỗi) từ kết quả tool."""
    texts = [c.text for c in result.content if isinstance(c, TextContent)]
    if result.isError:
        return False, " ".join(texts)
    data = result.structuredContent
    if data is None and texts:
        try:
            data = json.loads(texts[0])
        except ValueError:
            data = texts[0]
    # FastMCP bọc giá trị trả về không phải object (ví dụ list) trong {"result": ...}
    if isinstance(data, dict) and set(data) == {"result"}:
        data = data["result"]
    return True, data


async def _call_tool(params: StdioServerParameters, tool: str, arguments: dict[str, Any]) -> tuple[CallToolResult, int]:
    async with stdio_client(params) as (read, write), ClientSession(read, write) as session:
        await session.initialize()
        started = time.perf_counter()
        result = await session.call_tool(tool, arguments)
        return result, int((time.perf_counter() - started) * 1000)


def call_tool(mode: Mode, api_key: str, tool: str, arguments: dict[str, Any]) -> CallRecord:
    """Gọi một tool MCP; lỗi kết nối cũng được ghi lại thành CallRecord ok=False."""
    started = time.perf_counter()
    try:
        result, tool_ms = asyncio.run(
            asyncio.wait_for(_call_tool(server_params(mode, api_key), tool, arguments), CALL_TIMEOUT_SECONDS)
        )
        ok, data = _unwrap(result)
    except Exception as exc:  # hiển thị cho người dùng thay vì làm sập giao diện
        tool_ms, ok, data = 0, False, f"Không gọi được MCP server: {type(exc).__name__}: {exc}"
    total_ms = int((time.perf_counter() - started) * 1000)
    return CallRecord(tool=tool, mode=mode, arguments=arguments, ok=ok, result=data, tool_ms=tool_ms, total_ms=total_ms)


async def _inspect(params: StdioServerParameters) -> ServerInfo:
    started = time.perf_counter()
    async with stdio_client(params) as (read, write), ClientSession(read, write) as session:
        init = await session.initialize()
        tools = await session.list_tools()
        resources = await session.list_resources()
        templates = await session.list_resource_templates()
    return ServerInfo(
        name=init.serverInfo.name,
        version=init.serverInfo.version,
        protocol_version=str(init.protocolVersion),
        instructions=init.instructions or "",
        tools=[
            {
                "name": t.name,
                "title": t.title or "",
                "description": (t.description or "").strip().splitlines()[0],
                "read_only": bool(t.annotations and t.annotations.readOnlyHint),
            }
            for t in tools.tools
        ],
        resources=[str(r.uri) for r in resources.resources] + [t.uriTemplate for t in templates.resourceTemplates],
        total_ms=int((time.perf_counter() - started) * 1000),
    )


def inspect_server(mode: Mode, api_key: str) -> ServerInfo:
    """Handshake MCP (initialize) rồi liệt kê tool/resource mà server công bố."""
    return asyncio.run(asyncio.wait_for(_inspect(server_params(mode, api_key)), CALL_TIMEOUT_SECONDS))


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
