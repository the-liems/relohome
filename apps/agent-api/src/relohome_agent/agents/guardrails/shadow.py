"""Bounded lifecycle-managed observer. Never awaits Jev on the user-facing path."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import secrets
from collections import Counter
from contextvars import Context
from time import monotonic

from relohome_agent.agents.guardrails.jev import MODEL, JevClient, JevError, openrouter_key
from relohome_agent.agents.guardrails.policy import ASSESSMENT_QUESTIONS, PLAN_QUESTIONS, POLICY_VERSION
from relohome_agent.agents.guardrails.projection import (
    ProjectionLimitError,
    ProjectionPrivacyError,
    assessment_projection,
    plan_projection,
)

logger = logging.getLogger(__name__)
TURN_RETENTION_S = 900
MAX_TRACKED_TURNS = 1024
METRICS_INTERVAL_S = 60
ERROR_CODES = frozenset({"timeout", "provider_error", "connection_error", "invalid_response", "response_limit"})


class ShadowGuardrail:
    """At most one plan + one assessment admission per request.

    No decision cache across users/versions; only a bounded privacy-safe turn ledger.
    Overload skips observation (not authorizes an action). Shutdown cancels pending work.
    Current narrative assessments are privacy skips, not grounding/injection verdicts.
    """

    def __init__(self, client: JevClient, *, max_pending: int = 4):
        self.client = client
        self.max_pending = max_pending
        self._tasks: set[asyncio.Task] = set()
        self._turns: dict[str, tuple[float, set[str]]] = {}
        self._salt = secrets.token_bytes(32)
        self._closed = False
        self.counts = Counter()
        self._point_counts = {point: Counter() for point in ("plan", "assessment")}
        self._skip_counts = {point: Counter() for point in ("plan", "assessment")}
        self._task_points: dict[asyncio.Task, str] = {}
        self._settled: set[asyncio.Task] = set()
        self._metrics_task: asyncio.Task | None = None

    def _count(self, point, event):
        self.counts[event] += 1
        self._point_counts[point][event] += 1

    def _skip(self, point, reason):
        self.counts[reason] += 1
        self._point_counts[point]["skipped"] += 1
        self._skip_counts[point][reason] += 1

    def _seen(self, point):
        self._count(point, "seen")
        if self._metrics_task is None and not self._closed:
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                return
            self._metrics_task = loop.create_task(self._report_metrics(), name="jev-metrics", context=Context())

    def metrics_snapshot(self):
        """Fixed cardinality, process-local cumulative counters; no scope or input data."""
        events = (
            "seen",
            "eligible",
            "submitted",
            "completed",
            "skipped",
            "timeout",
            "provider_error",
            "connection_error",
            "invalid_response",
            "response_limit",
            "unavailable",
            "internal_error",
            "cancelled",
        )
        return {
            "policy": POLICY_VERSION,
            "mode": "shadow",
            "coverage_basis": "eligible_attempts_excluding_already_submitted_duplicates_not_all_chat_turns",
            "points": {
                point: {
                    "counters": {event: counts[event] for event in events},
                    "skip_reasons": dict(self._skip_counts[point]),
                    "in_flight": sum(value == point for value in self._task_points.values()),
                    "coverage_ratio": counts["completed"] / counts["eligible"] if counts["eligible"] else None,
                }
                for point, counts in self._point_counts.items()
            },
        }

    def _emit_metrics(self):
        logger.info("jev_metrics %s", json.dumps(self.metrics_snapshot(), separators=(",", ":")))

    async def _report_metrics(self):
        while True:
            await asyncio.sleep(METRICS_INTERVAL_S)
            self._emit_metrics()

    def _terminal(self, point, event):
        if asyncio.current_task() in self._settled:
            return
        self._count(point, event)
        self._settled.add(asyncio.current_task())

    def _task_done(self, task):
        point = self._task_points.pop(task)
        if task.cancelled() and task not in self._settled:
            # Shutdown can cancel admission before the coroutine gets its first turn.
            self._count(point, "cancelled")
        self._settled.discard(task)
        self._tasks.discard(task)

    def observe_plan(self, state, plan):
        self._observe("plan", state, lambda: plan_projection(state, plan), PLAN_QUESTIONS)

    def observe_assessment(self, inp, result):
        point = "assessment"
        if result.usage.llm_calls <= 0:
            self._seen(point)
            self._skip(point, "deterministic")
            return  # Deterministic completion, including typed form quote: ZERO Jev calls.
        if result.agent.value not in {"property", "flight"}:
            self._seen(point)
            self._skip(point, "unsupported_domain")
            return
        if result.status != "done" or not isinstance(result.data.get("agent_assessment"), dict):
            self._seen(point)
            self._skip(point, "no_assessment")
            return
        self._observe("assessment", inp, lambda: assessment_projection(inp, result), ASSESSMENT_QUESTIONS)

    def _observe(self, point, context, projection, questions):
        # No awaits: admission/ledger update is atomic within the application's event loop.
        self._seen(point)
        if self._closed:
            self._skip(point, "closed")
            return
        thread, request = context.get("thread_id"), context.get("request_id")
        if not thread or not request:
            self._count(point, "eligible")
            self._skip(point, "missing_scope")
            return
        key = hmac.new(self._salt, f"{thread}\0{request}".encode(), hashlib.sha256).hexdigest()
        now = monotonic()
        self._turns = {k: value for k, value in self._turns.items() if now - value[0] < TURN_RETENTION_S}
        if key in self._turns and point in self._turns[key][1]:
            self._skip(point, "turn_limit")
            return
        self._count(point, "eligible")
        if key not in self._turns and len(self._turns) >= MAX_TRACKED_TURNS:
            self._skip(point, "ledger_full")
            return
        if len(self._tasks) >= self.max_pending:
            self._skip(point, "overload")
            return
        try:
            projected = projection()
            if projected is None:
                self._skip(point, "not_applicable")
                return
        except ProjectionPrivacyError:
            self._skip(point, "privacy_insufficient_evidence")
            return
        except (ProjectionLimitError, ValueError, TypeError, AttributeError, KeyError):
            self._skip(point, "projection_skipped")
            return
        _, points = self._turns.setdefault(key, (now, set()))
        points.add(point)
        self._count(point, "submitted")
        # Do not inherit authenticated actor, LLM tracing or private request contextvars.
        task = asyncio.create_task(self._check(point, key, projected, questions), name="jev-shadow", context=Context())
        self._tasks.add(task)
        self._task_points[task] = point
        task.add_done_callback(self._task_done)

    async def _check(self, point, key, state, questions):
        started = monotonic()
        try:
            result = await self.client.decide(state, questions)
            self._terminal(point, "completed")
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
            code = str(exc) if str(exc) in ERROR_CODES else "unavailable"
            if code != "unavailable":
                self.counts["unavailable"] += 1
            self._terminal(point, code)
            logger.info(
                "jev_shadow point=%s status=unavailable code=%s elapsed_ms=%d",
                point,
                code,
                round((monotonic() - started) * 1000),
            )
        except asyncio.CancelledError:
            self._terminal(point, "cancelled")
            raise
        except Exception:
            self._terminal(point, "internal_error")
            logger.warning("jev_shadow point=%s status=internal_error", point, exc_info=True)

    async def close(self):
        self._closed = True
        pending = list(self._tasks)
        if self._metrics_task is not None:
            self._metrics_task.cancel()
        for task in pending:
            task.cancel()
        # Cancel everything before the first yield: shutdown must not start admitted HTTP work.
        if pending or self._metrics_task is not None:
            await asyncio.gather(
                *pending, *([self._metrics_task] if self._metrics_task is not None else []), return_exceptions=True
            )
        self._tasks.clear()
        self._turns.clear()
        self._emit_metrics()
        await self.client.close()


def build_guardrail(settings) -> ShadowGuardrail | None:
    if settings.agent_guardrail_mode == "off":
        return None
    try:
        key = openrouter_key(settings.openrouter_api_key.get_secret_value(), settings.openai_api_key.get_secret_value())
    except JevError:
        logger.warning("jev_shadow status=invalid_credential")
        return None
    if not key:
        logger.warning("jev_shadow status=unconfigured")
        return None
    return ShadowGuardrail(JevClient(key, timeout_s=settings.agent_guardrail_timeout_s))
