"""Explicit component factory for module tests and the later graph integration step."""

from __future__ import annotations

from dataclasses import dataclass

from src.agents.intake_llm import LlmIntake
from src.agents.llm import LLMError, StructuredLLM
from src.agents.planner_llm import LlmPlanner
from src.agents.subagents.capabilities import BASELINE_CAPABILITIES
from src.agents.subagents.services.moving import QuoteContact
from src.agents.subagents.services.moving_llm import MovingLlmAgent
from src.services.adapters.registry import ServiceRegistry, ServiceSettings


@dataclass
class LlmComponents:
    intake: LlmIntake
    planner: LlmPlanner
    moving: MovingLlmAgent | None

    async def close(self):
        await self.intake.llm.close()
        await self.planner.llm.close()
        if self.moving:
            await self.moving.close()


def build_llm_components(settings: ServiceSettings | None = None) -> LlmComponents:
    settings = settings or ServiceSettings()
    key = settings.openai_api_key.get_secret_value()
    if not key or key.startswith(("your-", "sk-your", "test-")):
        raise LLMError("LLM_NOT_CONFIGURED", "Cần cấu hình OPENAI_API_KEY để chạy agent thật.")
    registry = ServiceRegistry.from_settings(settings)
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
    return LlmComponents(LlmIntake(intake_llm), LlmPlanner(planner_llm, capabilities), moving)
