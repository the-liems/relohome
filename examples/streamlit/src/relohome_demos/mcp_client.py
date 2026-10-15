"""Demo clients connect to dedicated HTTP MCP services; they never launch servers."""

import asyncio
import json
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx2
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from mcp.types import CallToolResult, TextContent

CALL_TIMEOUT_SECONDS = 60.0
VN_TZ = timezone(timedelta(hours=7))


@dataclass
class CallRecord:
    """Một lần gọi tool MCP, dùng cho nhật ký API trên giao diện."""

    tool: str
    mode: str
    arguments: dict[str, Any]
    ok: bool
    result: Any
    tool_ms: int
    total_ms: int
    at: datetime = field(default_factory=lambda: datetime.now(VN_TZ))


@dataclass
class ServerInfo:
    name: str
    version: str
    protocol_version: str
    instructions: str
    tools: list[dict[str, Any]]
    resources: list[str]
    total_ms: int


@dataclass(frozen=True)
class HttpServerParameters:
    url: str
    token: str = field(default="", repr=False)


@asynccontextmanager
async def http_session(params: HttpServerParameters):
    headers = {"Authorization": f"Bearer {params.token}"} if params.token else {}
    async with httpx2.AsyncClient(headers=headers, timeout=CALL_TIMEOUT_SECONDS) as http:
        async with streamable_http_client(params.url, http_client=http) as (read, write):
            async with ClientSession(read, write) as session:
                yield session


def _unwrap(result: CallToolResult) -> tuple[bool, Any]:
    """Lấy dữ liệu có cấu trúc (hoặc message lỗi) từ kết quả tool."""
    texts = [c.text for c in result.content if isinstance(c, TextContent)]
    if result.is_error:
        return False, " ".join(texts)
    data = result.structured_content
    if data is None and texts:
        try:
            data = json.loads(texts[0])
        except ValueError:
            data = texts[0]
    # FastMCP bọc giá trị trả về không phải object (ví dụ list) trong {"result": ...}
    if isinstance(data, dict) and set(data) == {"result"}:
        data = data["result"]
    return True, data


async def _call_tool(params: HttpServerParameters, tool: str, arguments: dict[str, Any]) -> tuple[CallToolResult, int]:
    async with http_session(params) as session:
        await session.initialize()
        started = time.perf_counter()
        result = await session.call_tool(tool, arguments)
        return result, int((time.perf_counter() - started) * 1000)


def call_tool(params: HttpServerParameters, mode: str, tool: str, arguments: dict[str, Any]) -> CallRecord:
    """Gọi một tool MCP; lỗi kết nối cũng được ghi lại thành CallRecord ok=False."""
    started = time.perf_counter()
    try:
        result, tool_ms = asyncio.run(asyncio.wait_for(_call_tool(params, tool, arguments), CALL_TIMEOUT_SECONDS))
        ok, data = _unwrap(result)
    except Exception as exc:  # hiển thị cho người dùng thay vì làm sập giao diện
        tool_ms, ok, data = 0, False, f"Không gọi được MCP server: {type(exc).__name__}: {exc}"
    total_ms = int((time.perf_counter() - started) * 1000)
    return CallRecord(tool=tool, mode=mode, arguments=arguments, ok=ok, result=data, tool_ms=tool_ms, total_ms=total_ms)


async def _inspect(params: HttpServerParameters) -> ServerInfo:
    started = time.perf_counter()
    async with http_session(params) as session:
        init = await session.initialize()
        tools = await session.list_tools()
        resources = await session.list_resources()
        templates = await session.list_resource_templates()
    return ServerInfo(
        name=init.server_info.name,
        version=init.server_info.version,
        protocol_version=str(init.protocol_version),
        instructions=init.instructions or "",
        tools=[
            {
                "name": t.name,
                "title": t.title or "",
                "description": (t.description or "").strip().splitlines()[0],
                "read_only": bool(t.annotations and t.annotations.read_only_hint),
            }
            for t in tools.tools
        ],
        resources=[str(r.uri) for r in resources.resources] + [t.uri_template for t in templates.resource_templates],
        total_ms=int((time.perf_counter() - started) * 1000),
    )


def inspect_server(params: HttpServerParameters) -> ServerInfo:
    """Handshake MCP (initialize) rồi liệt kê tool/resource mà server công bố."""
    return asyncio.run(asyncio.wait_for(_inspect(params), CALL_TIMEOUT_SECONDS))
