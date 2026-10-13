"""Phần dùng chung của subagent nền: đếm call, đổi lỗi tool thành kết quả `failed` theo contract."""

from __future__ import annotations

from typing import Any

from relohome_agent.agents.contracts import AgentTaskRequest, AgentTaskResult, failed_result
from relohome_agent.agents.models import AgentUsage, SourceKind
from relohome_agent.agents.subagents.base import AgentTransportError
from relohome_agent.services.adapters.mcp import McpToolClient, ToolCallError


class BudgetExceededError(Exception):
    pass


class CountingClient:
    """Bọc `McpToolClient`: đếm provider call và dừng khi vượt `budget.max_provider_calls` (R6, R11)."""

    def __init__(self, client: McpToolClient, limit: int):
        self.client, self.limit = client, limit
        self.calls = 0

    async def call(self, tool: str, arguments: dict[str, Any]) -> Any:
        if self.calls >= self.limit:
            raise BudgetExceededError(tool)
        self.calls += 1
        return await self.client.call(tool, arguments)


def tool_failure(
    req: AgentTaskRequest, exc: Exception, source: str, source_kind: SourceKind, calls: int
) -> AgentTaskResult:
    """Lỗi tool → `failed`. Lỗi đường truyền ở call đầu tiên → `AgentTransportError` (được retry một lần)."""
    usage = AgentUsage(provider_calls=calls)
    if isinstance(exc, BudgetExceededError):
        return failed_result(
            req, "budget_exceeded", f"vượt số call cho phép ({exc})", False, source, source_kind, usage
        )
    if isinstance(exc, ToolCallError):
        if exc.transport and calls <= 1:
            raise AgentTransportError(exc.message) from exc
        code = (
            "timeout" if exc.code == "timeout" else ("provider_unavailable" if exc.retryable else "provider_rejected")
        )
        return failed_result(req, code, exc.message, exc.retryable, source, source_kind, usage)
    raise exc


def first(items: Any) -> Any:
    return items[0] if isinstance(items, list) and items else None
