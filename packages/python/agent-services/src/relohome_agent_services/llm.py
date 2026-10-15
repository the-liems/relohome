from __future__ import annotations

from typing import TypeVar

from langfuse.openai import AsyncOpenAI
from openai import APIConnectionError, APIStatusError, APITimeoutError, RateLimitError
from pydantic import BaseModel, ValidationError

from relohome_agent_services.common import ServiceError, ServiceSettings, canonical

T = TypeVar("T", bound=BaseModel)


class StructuredLLM:
    """One bounded call; no tool credentials, external URLs or fabricated fallback."""

    def __init__(self, settings: ServiceSettings, model: str):
        self.settings, self.model = settings, model
        self.client: AsyncOpenAI | None = None

    def ready(self) -> bool:
        key = self.settings.openai_api_key.get_secret_value()
        return bool(key) and not key.startswith(("sk-your", "your-", "test-"))

    async def parse(self, instructions: str, data: dict, schema: type[T]) -> T:
        if not self.ready():
            raise ServiceError("LLM_NOT_CONFIGURED", "Configure OPENAI_API_KEY before using the agent.", 503)
        if self.client is None:
            self.client = AsyncOpenAI(
                api_key=self.settings.openai_api_key.get_secret_value(),
                timeout=self.settings.agent_llm_timeout_seconds,
                max_retries=0,
            )
        try:
            result = await self.client.responses.parse(
                model=self.model,
                instructions=instructions,
                input=canonical(data),
                text_format=schema,
                max_output_tokens=self.settings.agent_llm_max_output_tokens,
                store=False,
            )
        except (APITimeoutError, APIConnectionError, RateLimitError) as exc:
            raise ServiceError("LLM_UNAVAILABLE", "LLM unavailable or timed out.", 503, True) from exc
        except APIStatusError as exc:
            raise ServiceError(
                "LLM_PROVIDER_ERROR", "LLM rejected the request; check model and account configuration.", 502
            ) from exc
        except (ValidationError, ValueError) as exc:
            raise ServiceError("LLM_INVALID_OUTPUT", "LLM output did not match the contract.", 502) from exc
        if result.status != "completed" or result.output_parsed is None:
            raise ServiceError("LLM_NO_RESULT", "LLM refused or did not complete a structured response.", 502)
        return result.output_parsed

    async def close(self):
        if self.client is not None:
            await self.client.close()
