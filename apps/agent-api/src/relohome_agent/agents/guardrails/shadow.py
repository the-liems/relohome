"""Bounded lifecycle-managed observer. Never awaits Jev on the user-facing path."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import secrets
from collections import Counter
from contextvars import Context
from time import monotonic

from relohome_agent.agents.guardrails.jev import MODEL, JevClient, JevError
from relohome_agent.agents.guardrails.policy import ASSESSMENT_QUESTIONS, PLAN_QUESTIONS, POLICY_VERSION
from relohome_agent.agents.guardrails.projection import ProjectionLimitError, assessment_projection, plan_projection

logger = logging.getLogger(__name__)
TURN_RETENTION_S = 900
MAX_TRACKED_TURNS = 1024


class ShadowGuardrail:
    """At most one plan + one sampled Housing/Flight assessment per request.

    No decision cache across users/versions; only a bounded privacy-safe turn ledger.
    Overload skips observation (not authorizes an action). Shutdown cancels pending work.
    """

    def __init__(self, client: JevClient, *, max_pending: int = 4):
        self.client = client
        self.max_pending = max_pending
        self._tasks: set[asyncio.Task] = set()
        self._turns: dict[str, tuple[float, set[str]]] = {}
        self._salt = secrets.token_bytes(32)
        self._closed = False
        self.counts = Counter()

    def observe_plan(self, state, plan):
        self._observe("plan", state, lambda: plan_projection(state, plan), PLAN_QUESTIONS)

    def observe_assessment(self, inp, result):
        if result.usage.llm_calls <= 0:
            return  # Deterministic completion, including typed form quote: ZERO Jev calls.
        self._observe("assessment", inp, lambda: assessment_projection(inp, result), ASSESSMENT_QUESTIONS)

    def _observe(self, point, context, projection, questions):
        # No awaits: admission/ledger update is atomic within the application's event loop.
        if self._closed:
            return
        thread, request = context.get("thread_id"), context.get("request_id")
        if not thread or not request:
            self.counts["missing_scope"] += 1
            return
        key = hmac.new(self._salt, f"{thread}\0{request}".encode(), hashlib.sha256).hexdigest()
        now = monotonic()
        self._turns = {k: value for k, value in self._turns.items() if now - value[0] < TURN_RETENTION_S}
        if key in self._turns and point in self._turns[key][1]:
            self.counts["turn_limit"] += 1
            return
        if key not in self._turns and len(self._turns) >= MAX_TRACKED_TURNS:
            self.counts["ledger_full"] += 1
            return
        if len(self._tasks) >= self.max_pending:
            self.counts["overload"] += 1
            return
        try:
            projected = projection()
            if projected is None:
                return
        except (ProjectionLimitError, ValueError, TypeError, AttributeError, KeyError):
            self.counts["projection_skipped"] += 1
            return
        _, points = self._turns.setdefault(key, (now, set()))
        points.add(point)
        self.counts["submitted"] += 1
        # Do not inherit authenticated actor, LLM tracing or private request contextvars.
        task = asyncio.create_task(self._check(point, key, projected, questions), name="jev-shadow", context=Context())
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _check(self, point, key, state, questions):
        started = monotonic()
        try:
            result = await self.client.decide(state, questions)
            self.counts["completed"] += 1
            self.counts["input_tokens"] += result.input_tokens
            self.counts["output_tokens"] += result.output_tokens
            # Fixed choices/numbers only. Never log input, IDs, exceptions, provider bodies or keys.
            logger.info(
                "jev_shadow policy=%s model=%s served=%s point=%s scope=%s elapsed_ms=%d answers=%s tokens_in=%d tokens_out=%d cost=%s",
                POLICY_VERSION,
                MODEL,
                result.served_model,
                point,
                key[:16],
                round((monotonic() - started) * 1000),
                result.answers,
                result.input_tokens,
                result.output_tokens,
                result.cost,
            )
        except JevError as exc:
            self.counts["unavailable"] += 1
            logger.info(
                "jev_shadow point=%s status=unavailable code=%s elapsed_ms=%d",
                point,
                str(exc),
                round((monotonic() - started) * 1000),
            )
        except asyncio.CancelledError:
            self.counts["cancelled"] += 1
            raise
        except Exception:
            self.counts["internal_error"] += 1
            logger.warning("jev_shadow point=%s status=internal_error", point)

    async def close(self):
        self._closed = True
        pending = list(self._tasks)
        for task in pending:
            task.cancel()
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)
        self._tasks.clear()
        self._turns.clear()
        await self.client.close()


def build_guardrail(settings) -> ShadowGuardrail | None:
    if settings.agent_guardrail_mode == "off":
        return None
    key = settings.openrouter_api_key.get_secret_value()
    if not key:
        candidate = settings.openai_api_key.get_secret_value()
        key = candidate if candidate.startswith("sk-or-v1-") else ""
    if not key:
        logger.warning("jev_shadow status=unconfigured")
        return None
    # Uvicorn normally configures its own logger, not the application's root logger.
    # Ensure opt-in observations reach stderr even without a custom logging config.
    if not logger.hasHandlers():
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(message)s"))
        logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    return ShadowGuardrail(JevClient(key, timeout_s=settings.agent_guardrail_timeout_s))
