"""TypeSafe Decisions API through OpenRouter (not Chat Completions)."""

from __future__ import annotations

import asyncio
import json
import math
import re
from dataclasses import dataclass

import httpx

ENDPOINT = "https://openrouter.ai/api/alpha/decisions"
MODEL = "typesafe/jev-1.13"
MAX_REPLY_BYTES = 64_000
OPENROUTER_KEY = re.compile(r"sk-or-v1-[A-Za-z0-9_-]+")


class JevError(Exception):
    """Only a fixed safe code: never include response bodies, URLs or credentials."""


def openrouter_key(explicit: str, compatibility: str = "") -> str:
    """An invalid explicit override must not silently fall back or leave this process."""
    if explicit:
        if not OPENROUTER_KEY.fullmatch(explicit):
            raise JevError("invalid_credential")
        return explicit
    return compatibility if OPENROUTER_KEY.fullmatch(compatibility) else ""


@dataclass(frozen=True)
class Decision:
    served_model: str
    answers: dict
    input_tokens: int
    output_tokens: int
    cost: float


def probability(value):
    if type(value) not in {int, float} or not math.isfinite(value) or not 0 <= value <= 1:
        raise JevError("invalid_response")
    return float(value)


def parse_decision(raw: dict, questions: dict) -> Decision:
    if not isinstance(raw, dict) or not isinstance(raw.get("answers"), dict):
        raise JevError("invalid_response")
    if set(raw["answers"]) != set(questions):
        raise JevError("invalid_response")
    served = raw.get("model")
    if not isinstance(served, str) or not re.fullmatch(r"typesafe/jev-1\.13(?:-\d{8})?", served):
        raise JevError("invalid_response")
    answers = {}
    for name, question in questions.items():
        answer = raw["answers"][name]
        criteria = question["criteria"]
        if not isinstance(answer, dict) or answer.get("type") != "choice" or answer.get("choice") not in criteria:
            raise JevError("invalid_response")
        probabilities = answer.get("probabilities")
        if not isinstance(probabilities, dict) or set(probabilities) != set(criteria):
            raise JevError("invalid_response")
        probabilities = {key: probability(value) for key, value in probabilities.items()}
        if abs(sum(probabilities.values()) - 1) > 0.02:
            raise JevError("invalid_response")
        answers[name] = {
            "choice": answer["choice"],
            "confidence": probability(answer.get("confidence")),
            "probabilities": probabilities,
        }
    usage = raw.get("usage")
    if not isinstance(usage, dict):
        raise JevError("invalid_response")
    for field in ("input_tokens", "output_tokens"):
        if type(usage.get(field)) is not int or not 0 <= usage[field] <= 1_000_000:
            raise JevError("invalid_response")
    cost = usage.get("cost")
    if type(cost) not in {int, float} or not math.isfinite(cost) or not 0 <= cost <= 100:
        raise JevError("invalid_response")
    return Decision(served, answers, usage["input_tokens"], usage["output_tokens"], float(cost))


class JevClient:
    def __init__(self, key: str, *, timeout_s: float = 1.5, transport=None):
        if not openrouter_key(key):
            raise JevError("invalid_credential")
        self.timeout_s = timeout_s
        self.http = httpx.AsyncClient(
            headers={"Authorization": f"Bearer {key}"},
            timeout=timeout_s,
            follow_redirects=False,
            trust_env=False,
            transport=transport,
            limits=httpx.Limits(max_connections=4, max_keepalive_connections=4),
        )

    async def decide(self, state: dict, questions: dict) -> Decision:
        try:
            async with asyncio.timeout(self.timeout_s):
                async with self.http.stream(
                    "POST", ENDPOINT, json={"model": MODEL, "state": state, "questions": questions}
                ) as response:
                    if response.status_code != 200:
                        raise JevError("provider_error")
                    chunks = bytearray()
                    async for chunk in response.aiter_bytes(chunk_size=8192):
                        if len(chunks) + len(chunk) > MAX_REPLY_BYTES:
                            raise JevError("response_limit")
                        chunks.extend(chunk)
                raw = json.loads(chunks, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
                return parse_decision(raw, questions)
        except (TimeoutError, httpx.TimeoutException):
            raise JevError("timeout") from None
        except httpx.HTTPError:
            raise JevError("connection_error") from None
        except (ValueError, TypeError, KeyError):
            raise JevError("invalid_response") from None

    async def close(self):
        await self.http.aclose()
