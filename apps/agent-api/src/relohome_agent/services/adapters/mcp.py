"""Client MCP cho subagent và `transaction` (agent-graph.md §6.3.5, §6.3.7).

Mỗi service có hai endpoint trong registry: **read** (tool đọc, credential chỉ-đọc, dùng bởi subagent)
và **write** (tool ghi, credential ghi, chỉ `transaction` dùng). Client chặn mọi tool ngoài allowlist,
nên subagent không thể gọi tool ghi (R3). Model không bao giờ thấy URL hay token.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any

import httpx2
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from mcp.types import CallToolResult, TextContent
from relohome_privacy import redact_pii

logger = logging.getLogger(__name__)


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
    max_sse_event_size: int = 1024 * 1024

    @property
    def configured(self) -> bool:
        return bool(self.url)


def unwrap(result: CallToolResult) -> Any:
    """Lấy dữ liệu có cấu trúc từ kết quả tool; lỗi tool thành `ToolCallError`."""
    texts = [c.text for c in result.content if isinstance(c, TextContent)]
    if result.is_error:
        message = " ".join(texts).strip() or "tool returned an error"
        shape = _error_shape(message)
        if shape is not None:  # @relohome/mcp-core: {code, message, retryable}
            raise ToolCallError(shape["code"], str(shape.get("message", ""))[:500], retryable=shape["retryable"])
        # Unstructured text (e.g. the SDK's own schema errors) carries no code; treat it as non-retryable.
        raise ToolCallError("TOOL_ERROR", message[:500])
    data = result.structured_content
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


def _auth_failure(exc: BaseException) -> int | None:
    if isinstance(exc, httpx2.HTTPStatusError) and exc.response.status_code in (401, 403):
        return exc.response.status_code
    if isinstance(exc, BaseExceptionGroup):
        for child in exc.exceptions:
            if status := _auth_failure(child):
                return status
    return None


async def _check_auth_response(response: httpx2.Response) -> None:
    # SDK 2 otherwise converts HTTP auth failures into generic JSON-RPC errors.
    if response.status_code in (401, 403):
        response.raise_for_status()


class McpToolClient:
    def __init__(self, endpoint: McpEndpoint):
        self.endpoint = endpoint
        self._http: httpx2.AsyncClient | None = None

    def _http_client(self) -> httpx2.AsyncClient:
        # One pooled client per endpoint: calls reuse connections. The transport neither closes nor
        # changes a client it is given; each MCP session keeps its own session ID.
        if self._http is None:
            ep = self.endpoint
            headers = {"Authorization": f"Bearer {ep.token}"} if ep.token else {}
            self._http = httpx2.AsyncClient(
                headers=headers, timeout=ep.timeout_s, event_hooks={"response": [_check_auth_response]}
            )
        return self._http

    async def aclose(self) -> None:
        if self._http is not None:
            await self._http.aclose()
            self._http = None

    @asynccontextmanager
    async def _session(self) -> AsyncIterator[ClientSession]:
        ep = self.endpoint
        if ep.url:
            async with streamable_http_client(
                ep.url, http_client=self._http_client(), max_sse_event_size=ep.max_sse_event_size
            ) as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    yield session
        else:
            raise ToolCallError("not_configured", f"MCP endpoint for {ep.service} is not configured", transport=True)

    async def call(self, tool: str, arguments: dict[str, Any]) -> Any:
        if tool not in self.endpoint.allowed_tools:
            raise ToolCallError("tool_not_allowed", f"{self.endpoint.service}.{tool} is not in the allowlist")
        return await self._call(tool, arguments)

    async def _call(self, tool: str, arguments: dict[str, Any]) -> Any:
        sent = False
        try:
            async with asyncio.timeout(self.endpoint.timeout_s):
                async with self._session() as session:
                    sent = True
                    result = await session.call_tool(tool, arguments)
            return unwrap(result)
        except ToolCallError as exc:
            if sent:  # A tool-level error (isError) leaves the SDK's client span OK; record it here.
                logger.warning(
                    "mcp_tool_error service=%s tool=%s code=%s retryable=%s message=%s",
                    self.endpoint.service,
                    tool,
                    exc.code,
                    exc.retryable,
                    redact_pii(exc.message),
                )
            raise
        except TimeoutError as exc:
            logger.warning("mcp_tool_timeout service=%s tool=%s sent=%s", self.endpoint.service, tool, sent)
            raise ToolCallError(
                "timeout", f"{self.endpoint.service}.{tool} timed out", retryable=True, transport=not sent
            ) from exc
        except Exception as exc:  # lỗi kết nối nằm trong ExceptionGroup của anyio
            if status := _auth_failure(exc):
                logger.error(
                    "mcp_tool_rejected_access service=%s tool=%s status=%s", self.endpoint.service, tool, status
                )
                raise ToolCallError(
                    "UNAUTHORIZED" if status == 401 else "FORBIDDEN",
                    f"{self.endpoint.service} rejected MCP access",
                ) from exc
            logger.warning(
                "mcp_tool_unavailable service=%s tool=%s sent=%s", self.endpoint.service, tool, sent, exc_info=True
            )
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
