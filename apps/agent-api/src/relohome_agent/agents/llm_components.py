"""LLM component factory and lifecycle for the integrated graph runtime."""

from __future__ import annotations

from dataclasses import dataclass, field

from relohome_agent.agents.intake_llm import LlmIntake
from relohome_agent.agents.llm import LLMError, StructuredLLM
from relohome_agent.agents.planner_llm import LlmPlanner
from relohome_agent.agents.subagents.capabilities import BASELINE_CAPABILITIES
from relohome_agent.agents.subagents.services.moving import QuoteContact
from relohome_agent.agents.subagents.services.moving_llm import MovingLlmAgent
from relohome_agent.agents.subagents.services.read_llm import ReadLlmAgent
from relohome_agent.config import Settings
from relohome_agent.services.adapters.registry import ServiceRegistry


@dataclass
class LlmComponents:
    intake: LlmIntake
    planner: LlmPlanner
    moving: MovingLlmAgent | None
    domain_agents: list[ReadLlmAgent] = field(default_factory=list)

    async def close(self):
        await self.intake.llm.close()
        await self.planner.llm.close()
        if self.moving:
            await self.moving.close()
        for agent in self.domain_agents:
            await agent.close()


def build_llm_components(settings: Settings, registry: ServiceRegistry) -> LlmComponents:
    """The caller owns `registry` and closes its pooled MCP clients."""
    key = settings.openai_api_key.get_secret_value()
    if not key or key.startswith(("your-", "sk-your", "test-")):
        raise LLMError("LLM_NOT_CONFIGURED", "Cần cấu hình OPENAI_API_KEY để chạy agent thật.")
    intake_llm = StructuredLLM(key, settings.agent_intake_model)
    planner_llm = StructuredLLM(key, settings.agent_planner_model, tier="heavy")
    moving_client = registry.moving.read_client()
    contact = (
        QuoteContact(settings.moving_quote_contact_name, settings.moving_quote_contact_mobile)
        if (settings.moving_quote_contact_name and settings.moving_quote_contact_mobile)
        else None
    )
    moving = (
        MovingLlmAgent(
            key,
            settings.agent_moving_model,
            moving_client,
            registry.location.read_client(),
            contact,
            source_kind=registry.moving.source_kind,
        )
        if moving_client
        else None
    )
    capabilities = dict(BASELINE_CAPABILITIES)
    if moving:
        capabilities[moving.capability.agent] = moving.capability
    attempts = settings.agent_max_attempts
    return LlmComponents(
        LlmIntake(intake_llm, max_calls=attempts, enable_filter_fast_path=settings.agent_filter_fast_path_enabled),
        LlmPlanner(planner_llm, capabilities, max_calls=attempts),
        moving,
    )
