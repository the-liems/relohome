"""Invocation-local budgets and safe data projections for the optional LLM agents."""

from __future__ import annotations

import asyncio
import json
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from src.agents.common import utcnow
from src.agents.intake import PII_FACT_KEYS, redact_pii
from src.agents.llm import LLMError, StructuredLLM
from src.agents.models import AgentUsage

PRIVATE_KEYS = PII_FACT_KEYS | {
    "api_key",
    "token",
    "authorization",
    "secret",
    "password",
    "pii_refs",
    "pickup_contact",
    "destination_contact",
    "provider_data",
    "path",
}
CALL_LIMIT: ContextVar[int | None] = ContextVar("graph_llm_call_limit", default=None)


def public_data(value: Any) -> Any:
    """Do not serialize contacts, credentials, raw provider payloads or session memory to LLMs."""
    if isinstance(value, dict):
        return {k: public_data(v) for k, v in value.items() if k.lower() not in PRIVATE_KEYS}
    if isinstance(value, (tuple, list)):
        return [public_data(v) for v in value]
    if isinstance(value, str):
        return redact_pii(value)
    return value


def json_object(raw: str) -> dict:
    value = json.loads(raw, parse_constant=lambda _: (_ for _ in ()).throw(ValueError("non-finite JSON")))
    if not isinstance(value, dict):
        raise ValueError("Expected JSON object")
    return value


class UsageOwner:
    """Compatible with graph last_usage, with no shared mutable state across concurrent threads."""

    uses_llm = True

    def __init__(self) -> None:
        self._usage: ContextVar[AgentUsage | None] = ContextVar(f"usage_{id(self)}", default=None)

    @property
    def usage(self) -> AgentUsage:
        return (self._usage.get() or AgentUsage()).model_copy()

    @property
    def last_usage(self) -> tuple[int, int]:
        usage = self.usage
        return usage.tokens_in, usage.tokens_out

    @property
    def last_call_count(self) -> int:
        return self.usage.llm_calls


@dataclass
class Invocation:
    max_calls: int = 2
    deadline: datetime = field(default_factory=lambda: utcnow() + timedelta(seconds=90))
    usage: AgentUsage = field(default_factory=AgentUsage)

    def __post_init__(self):
        limit = CALL_LIMIT.get()
        if limit is not None:
            self.max_calls = min(self.max_calls, max(0, limit))

    def remaining(self) -> float:
        seconds = (self.deadline - utcnow()).total_seconds()
        if seconds <= 0:
            raise LLMError("LLM_DEADLINE", "Đã hết thời gian xử lý.")
        return seconds

    def reserve(self) -> None:
        self.remaining()
        if self.usage.llm_calls >= self.max_calls:
            raise LLMError("LLM_BUDGET", "Đã hết lượt gọi LLM cho yêu cầu.")
        self.usage.llm_calls += 1

    async def parse(self, llm: StructuredLLM, prompt: str, data: dict, schema):
        self.reserve()
        async with asyncio.timeout(self.remaining()):
            try:
                return await llm.parse(prompt, public_data(data), schema)
            finally:
                self.usage.tokens_in += llm.last_usage[0]
                self.usage.tokens_out += llm.last_usage[1]
