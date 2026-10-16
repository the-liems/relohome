"""Invocation-local budgets and safe data projections for the optional LLM agents."""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from relohome_agent.agents.common import utcnow
from relohome_agent.agents.intake import PII_FACT_KEYS, redact_pii
from relohome_agent.agents.llm import LLMError, StructuredLLM
from relohome_agent.agents.models import AgentUsage

logger = logging.getLogger(__name__)

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


@dataclass
class InvocationUsageCapture:
    """References shared with child tasks; snapshots survive an agent exception.

    A ContextVar assignment inside asyncio.wait_for's task would not reach its
    caller. The caller owns this container instead; invocations register their
    live counters without publishing mutable state on the shared agent.
    """

    counters: list[AgentUsage] = field(default_factory=list)

    def snapshot(self) -> AgentUsage:
        return AgentUsage(
            **{name: sum(getattr(usage, name) for usage in self.counters) for name in AgentUsage.model_fields}
        )


_INVOCATION_USAGE: ContextVar[InvocationUsageCapture | None] = ContextVar("agent_invocation_usage", default=None)


@contextmanager
def capture_invocation_usage() -> Iterator[InvocationUsageCapture]:
    capture = InvocationUsageCapture()
    token = _INVOCATION_USAGE.set(capture)
    try:
        yield capture
    finally:
        _INVOCATION_USAGE.reset(token)


# Upper bound for repair calls of one Intake/Planner invocation (AGENT_MAX_ATTEMPTS may lower it).
MAX_REPAIR_CALLS = 5
# Provider-side failures worth another attempt; a schema/validation problem is repaired by the caller.
TRANSIENT_LLM_ERRORS = frozenset({"LLM_NO_RESULT", "LLM_TIMEOUT", "LLM_CONNECTION_ERROR"})


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
    deadline: datetime = field(default_factory=lambda: utcnow() + timedelta(seconds=150))
    usage: AgentUsage = field(default_factory=AgentUsage)

    def __post_init__(self):
        capture = _INVOCATION_USAGE.get()
        if capture is not None:
            capture.counters.append(self.usage)
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
        """One structured call; a transient provider failure is retried within this invocation's
        call budget and deadline (each retry counts as a call)."""
        while True:
            self.reserve()
            try:
                async with asyncio.timeout(self.remaining()):
                    try:
                        return await llm.parse(prompt, public_data(data), schema)
                    finally:
                        self.usage.tokens_in += llm.last_usage[0]
                        self.usage.tokens_out += llm.last_usage[1]
            except LLMError as exc:
                if exc.code not in TRANSIENT_LLM_ERRORS or self.usage.llm_calls >= self.max_calls:
                    raise
                logger.warning(
                    "transient LLM error %s, retrying (%s/%s)", exc.code, self.usage.llm_calls, self.max_calls
                )
