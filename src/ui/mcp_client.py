"""Client MCP dùng chung cho các giao diện demo: mở một MCP server qua stdio và gọi tool như agent thật.

Mỗi lần gọi mở một process server mới (biến môi trường quyết định chế độ mock/thật). Trạng thái của
server nằm trong SQLite nên vẫn liền mạch giữa các lần gọi.
"""

import asyncio
import json
import os
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.types import CallToolResult, TextContent

PROJECT_ROOT = Path(__file__).resolve().parents[2]
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


def stdio_params(module: str, env_overrides: dict[str, str]) -> StdioServerParameters:
    """Chạy `python -m <module>` tại gốc dự án (để đọc .env); biến truyền vào ưu tiên hơn .env."""
    return StdioServerParameters(
        command=sys.executable,
        args=["-m", module],
        cwd=str(PROJECT_ROOT),
        env={**os.environ, **env_overrides},
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


def call_tool(params: StdioServerParameters, mode: str, tool: str, arguments: dict[str, Any]) -> CallRecord:
    """Gọi một tool MCP; lỗi kết nối cũng được ghi lại thành CallRecord ok=False."""
    started = time.perf_counter()
    try:
        result, tool_ms = asyncio.run(asyncio.wait_for(_call_tool(params, tool, arguments), CALL_TIMEOUT_SECONDS))
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


def inspect_server(params: StdioServerParameters) -> ServerInfo:
    """Handshake MCP (initialize) rồi liệt kê tool/resource mà server công bố."""
    return asyncio.run(asyncio.wait_for(_inspect(params), CALL_TIMEOUT_SECONDS))
