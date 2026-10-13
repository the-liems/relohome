"""`RemoteAgent`: subagent chạy trong service của chủ service, gọi qua MCP (agent-graph.md §6.3.5).

Service expose hai MCP tool: `get_manifest` (trả `AgentManifest`) và `run_task` (vào
`{"request": AgentTaskRequest}`, ra `AgentTaskResult`). Kênh truyền chốt ở Q15.
"""

from __future__ import annotations

from relohome_agent.agents.contracts import (
    CONTRACT_VERSION,
    AgentCapability,
    AgentManifest,
    AgentTaskRequest,
    AgentTaskResult,
    contract_major,
)
from relohome_agent.agents.models import AgentName
from relohome_agent.agents.subagents.base import AgentTransportError
from relohome_agent.services.adapters.mcp import McpToolClient, ToolCallError


class ManifestError(Exception):
    pass


async def fetch_manifest(client: McpToolClient) -> AgentManifest:
    manifest = AgentManifest.model_validate(await client.call("get_manifest", {}))
    if contract_major(manifest.contract_version) != contract_major(CONTRACT_VERSION):
        raise ManifestError(f"{manifest.name}: contract {manifest.contract_version} is not compatible")
    return manifest


class RemoteAgent:
    def __init__(self, client: McpToolClient, capability: AgentCapability):
        self.client = client
        self.capability = capability

    @classmethod
    async def from_service(cls, client: McpToolClient, agent: AgentName) -> RemoteAgent:
        manifest = await fetch_manifest(client)
        capability = next((c for c in manifest.capabilities if c.agent == agent), None)
        if capability is None:
            raise ManifestError(f"{manifest.name} does not serve {agent.value}")
        return cls(client, capability)

    async def run(self, req: AgentTaskRequest) -> AgentTaskResult:
        try:
            raw = await self.client.call("run_task", {"request": req.model_dump(mode="json")})
        except ToolCallError as exc:
            if exc.transport:
                raise AgentTransportError(exc.message) from exc
            raise
        return AgentTaskResult.model_validate(raw)
