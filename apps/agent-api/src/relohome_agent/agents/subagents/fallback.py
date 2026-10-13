"""`FallbackAgent`: thử lần lượt nhiều subagent cho cùng một `AgentName` (agent-graph.md §6.3.7, §7.2)."""

from __future__ import annotations

from relohome_agent.agents.contracts import AgentTaskRequest, AgentTaskResult
from relohome_agent.agents.subagents.base import AgentTransportError, DomainAgent


class FallbackAgent:
    """Chuyển sang subagent kế tiếp khi subagent trước không gọi được hoặc trả `failed` retryable.

    `source` của kết quả là của subagent đã thực sự trả kết quả.
    """

    def __init__(self, agents: list[DomainAgent]):
        if not agents:
            raise ValueError("FallbackAgent needs at least one agent")
        self.agents = agents
        self.capability = agents[0].capability

    async def run(self, req: AgentTaskRequest) -> AgentTaskResult:
        last: AgentTaskResult | None = None
        for index, agent in enumerate(self.agents):
            is_last = index == len(self.agents) - 1
            try:
                result = await agent.run(req)
            except AgentTransportError:
                if is_last:
                    raise
                continue
            if result.status != "failed" or not (result.error and result.error.retryable) or is_last:
                return result
            last = result
        assert last is not None
        return last
