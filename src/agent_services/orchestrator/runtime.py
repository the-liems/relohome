from __future__ import annotations

from typing import Protocol

from src.agent_services.common import ServiceError
from src.agent_services.orchestrator.models import ToolResult
from src.agent_services.orchestrator.registry import ToolSpec


class ToolGateway(Protocol):
    """Internal port of Routing Orchestrator, NOT a third agent or worker service.

    Future MCP client adapters implement this port. Only adapter-produced factual
    results may pass through it. The standalone release deliberately has no adapter.
    """

    def available(self, service: str) -> bool: ...

    async def call(self, tool: ToolSpec, arguments: dict, idempotency_key: str) -> ToolResult: ...


class DisconnectedGateway:
    def available(self, service: str) -> bool:
        return False

    async def call(self, tool: ToolSpec, arguments: dict, idempotency_key: str) -> ToolResult:
        raise ServiceError("INTEGRATION_NOT_CONNECTED", "Domain MCP adapter is not connected.", 503)
