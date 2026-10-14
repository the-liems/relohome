"""Fixed-cardinality shadow metrics; no log parsing, decisions or request data."""

import functools
from types import SimpleNamespace

from opentelemetry import metrics

from .runtime import enabled

POINTS = frozenset({"plan", "assessment"})
EVENTS = frozenset({
    "seen", "eligible", "submitted", "completed", "skipped", "timeout",
    "provider_error", "connection_error", "invalid_response", "response_limit",
    "unavailable", "internal_error", "cancelled",
})
REASONS = frozenset({
    "deterministic", "unsupported_domain", "no_assessment", "closed", "missing_scope",
    "turn_limit", "ledger_full", "overload", "not_applicable",
    "privacy_insufficient_evidence", "projection_skipped",
})


@functools.lru_cache(maxsize=1)
def _instruments(provider):
    # Resolve per provider: an early no-op must not pin instruments before bootstrap.
    meter = provider.get_meter("relohome")
    return SimpleNamespace(
        observations=meter.create_counter("relohome.guardrail.observations"),
        skips=meter.create_counter("relohome.guardrail.skips"),
        in_flight=meter.create_up_down_counter("relohome.guardrail.in_flight"),
    )


def record_event(point: str, event: str):
    if not enabled() or point not in POINTS or event not in EVENTS:
        return
    try:
        _instruments(metrics.get_meter_provider()).observations.add(1, {"point": point, "event": event})
    except Exception:
        pass  # Telemetry failure cannot affect admission or business operations.


def record_skip(point: str, reason: str):
    if not enabled() or point not in POINTS or reason not in REASONS:
        return
    try:
        _instruments(metrics.get_meter_provider()).skips.add(1, {"point": point, "reason": reason})
    except Exception:
        pass


def pending_change(point: str, delta: int):
    if not enabled() or point not in POINTS or type(delta) is not int or delta not in {-1, 1}:
        return
    try:
        _instruments(metrics.get_meter_provider()).in_flight.add(delta, {"point": point})
    except Exception:
        pass
