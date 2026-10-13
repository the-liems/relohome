"""`LocalAgent`: bọc subagent Python chạy trong process (agent-graph.md §6.3.5).

Subagent có thể là hàm async hoặc một subgraph LangGraph; chỉ cần nhận `AgentTaskRequest` và trả
`AgentTaskResult` theo contract.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from relohome_agent.agents.contracts import AgentCapability, AgentTaskRequest, AgentTaskResult

RunFn = Callable[[AgentTaskRequest], Awaitable[AgentTaskResult]]


class LocalAgent:
    def __init__(self, capability: AgentCapability, run: RunFn, name: str = ""):
        self.capability = capability
        self._run = run
        self.name = name or capability.agent.value

    async def run(self, req: AgentTaskRequest) -> AgentTaskResult:
        return await self._run(req)
