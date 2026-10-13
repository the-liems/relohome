"""Client MCP cho subagent và `transaction` (agent-graph.md §6.3.5, §6.3.7).

Mỗi service có hai endpoint trong registry: **read** (tool đọc, credential chỉ-đọc, dùng bởi subagent)
và **write** (tool ghi, credential ghi, chỉ `transaction` dùng). Client chặn mọi tool ngoài allowlist,
nên subagent không thể gọi tool ghi (R3). Model không bao giờ thấy URL hay token.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from mcp.types import CallToolResult, TextContent


class ToolCallError(Exception):
    """Lỗi gọi tool. `transport=True`: chưa tới được server (retry được); ngược lại server đã trả lỗi."""

    def __init__(self, code: str, message: str, *, retryable: bool = False, transport: bool = False):
        super().__init__(message)
        self.code, self.message, self.retryable, self.transport = code, message, retryable, transport


@dataclass(frozen=True)
class McpEndpoint:
    """Dedicated service endpoint using MCP Streamable HTTP."""

    service: str
    allowed_tools: frozenset[str]
    url: str | None = None
    token: str | None = field(default=None, repr=False)
    timeout_s: float = 30.0

    @property
    def configured(self) -> bool:
        return bool(self.url)


def unwrap(result: CallToolResult) -> Any:
    """Lấy dữ liệu có cấu trúc từ kết quả tool; lỗi tool thành `ToolCallError`."""
    texts = [c.text for c in result.content if isinstance(c, TextContent)]
    if result.isError:
        message = " ".join(texts).strip() or "tool returned an error"
        shape = _error_shape(message)
        if shape is not None:  # @relohome/mcp-core: {code, message, retryable}
            raise ToolCallError(shape["code"], str(shape.get("message", ""))[:500], retryable=shape["retryable"])
        raise ToolCallError(_error_code(message), message[:500], retryable=_retryable(message))
    data = result.structuredContent
    if data is None and texts:
        try:
            data = json.loads(texts[0])
        except ValueError:
            data = texts[0]
    # FastMCP bọc giá trị trả về không phải object (ví dụ list) trong {"result": ...}
    if isinstance(data, dict) and set(data) == {"result"}:
        data = data["result"]
    return data


def _error_shape(message: str) -> dict | None:
    """Lỗi có cấu trúc `{code, message, retryable}`: dùng đúng `retryable` của server, không đoán."""
    try:
        payload = json.loads(message)
    except ValueError:
        return None
    err = payload.get("error", payload) if isinstance(payload, dict) else None
    if isinstance(err, dict) and isinstance(err.get("code"), str) and isinstance(err.get("retryable"), bool):
        return err
    return None


def _error_code(message: str) -> str:
    """Service trả mã lỗi dạng `CODE: message` hoặc JSON `{"code": ...}`; lấy mã nếu có."""
    try:
        payload = json.loads(message)
        if isinstance(payload, dict):
            err = payload.get("error", payload)
            if isinstance(err, dict) and isinstance(err.get("code"), str):
                return err["code"]
    except ValueError:
        pass
    head = message.split(":", 1)[0].strip()
    return head if head.replace("_", "").isalnum() and head.upper() == head and len(head) <= 40 else "TOOL_ERROR"


def _retryable(message: str) -> bool:
    """Chỉ dùng khi server trả lỗi dạng chữ (FastMCP của Flight / Payment)."""
    text = message.lower()
    return any(k in text for k in ("timeout", "timed out", "unavailable", "rate limit", "temporar", "503", "502"))


def _auth_failure(exc: BaseException) -> int | None:
    if isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code in (401, 403):
        return exc.response.status_code
    if isinstance(exc, BaseExceptionGroup):
        for child in exc.exceptions:
            if status := _auth_failure(child):
                return status
    return None


class McpToolClient:
    def __init__(self, endpoint: McpEndpoint):
        self.endpoint = endpoint

    @asynccontextmanager
    async def _session(self) -> AsyncIterator[ClientSession]:
        ep = self.endpoint
        if ep.url:
            headers = {"Authorization": f"Bearer {ep.token}"} if ep.token else {}
            async with httpx.AsyncClient(headers=headers, timeout=ep.timeout_s) as http:
                async with streamable_http_client(ep.url, http_client=http) as (read, write, _):
                    async with ClientSession(read, write) as session:
                        await session.initialize()
                        yield session
        else:
            raise ToolCallError("not_configured", f"MCP endpoint for {ep.service} is not configured", transport=True)

    async def call(self, tool: str, arguments: dict[str, Any]) -> Any:
        if tool not in self.endpoint.allowed_tools:
            raise ToolCallError("tool_not_allowed", f"{self.endpoint.service}.{tool} is not in the allowlist")
        sent = False
        try:
            async with asyncio.timeout(self.endpoint.timeout_s):
                async with self._session() as session:
                    sent = True
                    result = await session.call_tool(tool, arguments)
            return unwrap(result)
        except ToolCallError:
            raise
        except TimeoutError as exc:
            raise ToolCallError(
                "timeout", f"{self.endpoint.service}.{tool} timed out", retryable=True, transport=not sent
            ) from exc
        except Exception as exc:  # lỗi kết nối nằm trong ExceptionGroup của anyio
            if status := _auth_failure(exc):
                raise ToolCallError(
                    "UNAUTHORIZED" if status == 401 else "FORBIDDEN",
                    f"{self.endpoint.service} rejected MCP access",
                ) from exc
            raise ToolCallError(
                "unavailable",
                f"{self.endpoint.service} unreachable: {type(exc).__name__}",
                retryable=True,
                transport=not sent,
            ) from exc

    async def list_tools(self) -> list[str]:
        async with self._session() as session:
            tools = await session.list_tools()
        return [t.name for t in tools.tools]
