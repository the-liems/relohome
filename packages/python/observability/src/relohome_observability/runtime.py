from __future__ import annotations

import functools
import inspect
import os
import time
from contextlib import contextmanager
from contextvars import ContextVar
from types import SimpleNamespace

from opentelemetry import context, metrics, trace
from opentelemetry._logs import get_logger
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.trace import Link, SpanKind, Status, StatusCode
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

from .privacy import content

_SESSION: ContextVar[str | None] = ContextVar("telemetry_session", default=None)
_logger = get_logger("relohome")
_propagator = TraceContextTextMapPropagator()  # No baggage: never propagate identity/credentials.
HTTP_ERROR_TYPES = frozenset({
    "missing_agent_api_token", "agent_runtime_not_started", "upstream_invalid_json",
    "missing_service_token", "llm_not_configured", "llm_unavailable", "llm_provider_error",
    "llm_invalid_output", "llm_no_result", "internal_service_error", "approval_not_configured",
})


def enabled() -> bool:
    return isinstance(trace.get_tracer_provider(), TracerProvider)


def instruments():
    """Create instruments once, on the first enabled request after SDK setup."""
    return _instruments(metrics.get_meter_provider())


@functools.lru_cache(maxsize=1)
def _instruments(provider):
    # The provider changes after bootstrap (and in isolated tests). Do not retain
    # instruments belonging to the previous provider or a shutdown exporter.
    meter = provider.get_meter("relohome")
    return SimpleNamespace(
        operations=meter.create_counter("relohome.operations"),
        operation_duration=meter.create_histogram("relohome.operation.duration", unit="s"),
        rate_limits=meter.create_counter("relohome.provider.rate_limits"),
        llm_tokens=meter.create_counter("relohome.llm.tokens"),
    )


def log_event(event: str, *, severity="INFO", **attributes):
    if not enabled():
        return
    try:
        from opentelemetry._logs import SeverityNumber
        severity_name = {"WARNING": "WARN", "CRITICAL": "FATAL"}.get(severity, severity)
        severity_number = getattr(SeverityNumber, severity_name, SeverityNumber.INFO)
        attributes = {key: value for key, value in attributes.items() if value is not None}
        _logger.emit(body=event, severity_number=severity_number, severity_text=severity, attributes=attributes)
    except Exception:
        pass


def record_http_error(error_type: str):
    """Explain handled HTTP failures using fixed codes, without exporting exception values.

    Automatic instrumentors cover dependency exceptions. Use this only where
    application logic handles a failure before an instrumentor can observe it.
    """
    if not enabled() or not isinstance(error_type, str) or error_type not in HTTP_ERROR_TYPES:
        return
    try:
        span = trace.get_current_span()
        span.set_attribute("app.error.code", error_type)
        span.set_attribute("error.type", error_type)
        span.set_attribute("langfuse.observation.level", "ERROR")
        span.set_status(Status(StatusCode.ERROR))
        log_event("application.log", severity="ERROR", source="relohome.http", error_type=error_type)
    except Exception:
        pass  # Diagnostic failures must not change the HTTP response.


def current_context() -> dict[str, str]:
    carrier: dict[str, str] = {}
    if enabled():
        _propagator.inject(carrier)
    return carrier


def trace_metadata() -> dict[str, str] | None:
    return current_context() or None


def extract(carrier):
    if not isinstance(carrier, dict):
        return context.get_current()
    return _propagator.extract({key: value for key, value in carrier.items()
                                if key in {"traceparent", "tracestate"} and isinstance(value, str)})


@contextmanager
def session(thread_id: str):
    token = _SESSION.set(thread_id)
    span = trace.get_current_span()
    if span.is_recording():
        span.set_attribute("langfuse.session.id", thread_id)
    try:
        yield
    finally:
        _SESSION.reset(token)


def failed(value) -> bool:
    if hasattr(value, "status"):
        return str(value.status) in {"failed", "error"}
    if not isinstance(value, dict):
        return False
    status, results = value.get("status"), value.get("task_results")
    return bool(value.get("isError") or value.get("error")
                or (isinstance(status, str) and status in {"failed", "error"})
                or (isinstance(results, dict) and any(failed(item) for item in results.values())))


class Operation:
    def __init__(self, span):
        self.span, self.outcome = span, "success"

    def error(self, error_type="operation_failed"):
        self.outcome = "error"
        self.span.set_status(Status(StatusCode.ERROR))
        self.span.set_attribute("error.type", error_type)
        self.span.set_attribute("langfuse.observation.level", "ERROR")

    def output(self, value):
        if not enabled():
            return
        if failed(value):
            self.error()
        payload = content(value) if self.span.is_recording() else None
        if payload is not None:
            self.span.set_attribute("langfuse.observation.output", payload)


@contextmanager
def operation(name: str, kind="internal", *, inputs=None, remote=None, origin=None, attributes=None):
    if not enabled():
        yield Operation(trace.INVALID_SPAN)
        return
    started = time.monotonic()
    attrs = {"relohome.operation": name, "relohome.kind": kind,
             "langfuse.observation.type": {"llm": "generation", "tool": "tool", "agent": "agent",
                                            "workflow": "chain"}.get(kind, "span")}
    if sid := _SESSION.get():
        attrs["langfuse.session.id"] = sid
    attrs["langfuse.environment"] = os.getenv("OTEL_DEPLOYMENT_ENVIRONMENT", "development")
    attrs.update(attributes or {})
    parent, links = None, []
    if remote:
        extracted = extract(remote)
        # MCP metadata also carries progress tokens. Missing/invalid propagation
        # must retain the enclosing HTTP span instead of creating an orphan.
        if trace.get_current_span(extracted).get_span_context().is_valid:
            parent = extracted
    if origin is not None:
        parent = context.Context()  # A durable job starts a fresh trace; origin is a link, not a held-open parent.
        linked = trace.get_current_span(extract(origin)).get_span_context()
        if linked.is_valid:
            links.append(Link(linked))
            attrs["relohome.origin_trace_id"] = format(linked.trace_id, "032x")
    with trace.get_tracer("relohome").start_as_current_span(
        name, context=parent, links=links, attributes=attrs,
        kind=SpanKind.SERVER if remote else SpanKind.INTERNAL,
        record_exception=False, set_status_on_exception=False,
    ) as span:
        op = Operation(span)
        if inputs is not None and span.is_recording():
            payload = content(inputs)
            if payload is not None:
                span.set_attribute("langfuse.observation.input", payload)
        try:
            yield op
        except BaseException as exc:
            if type(exc).__name__ in {"GraphInterrupt", "NodeInterrupt"}:
                op.outcome = "paused"
            elif type(exc).__name__ == "CancelledError":
                op.outcome = "cancelled"
            else:
                op.error(type(exc).__name__)
            raise
        finally:
            elapsed = time.monotonic() - started
            span.set_attribute("relohome.outcome", op.outcome)
            labels = {"operation": name, "kind": kind, "outcome": op.outcome}
            instruments().operations.add(1, labels)
            instruments().operation_duration.record(elapsed, labels)
            log_event("operation.completed", operation=name, kind=kind, outcome=op.outcome,
                      duration_ms=round(elapsed * 1000))


def traced_node(name, fn):
    # Preserve signatures used by LangGraph, including its optional config parameter.
    kind = "agent" if name.endswith("_agent") else "workflow"

    @functools.wraps(fn)
    async def wrapped(*args, **kwargs):
        state = args[0] if args and isinstance(args[0], dict) else {}
        with session(state.get("thread_id") or _SESSION.get() or ""), operation(name, kind) as op:
            result = fn(*args, **kwargs)
            result = await result if inspect.isawaitable(result) else result
            # Never serialize graph state: it contains private stores and checkpoints.
            if failed(result):
                op.error()
            return result
    return wrapped


async def invoke_graph(graph, value, config):
    with session(config["configurable"]["thread_id"]), operation("agent.turn", "workflow") as op:
        result = await graph.ainvoke(value, config)
        if failed(result):
            op.error()
        if result.get("__interrupt__"):
            op.outcome = "paused"
        return result


async def generation(call, *, provider: str, **kwargs):
    model = kwargs.get("model", "unknown")
    attrs = {"gen_ai.system": provider, "gen_ai.provider.name": provider,
             "gen_ai.request.model": model, "gen_ai.operation.name": "chat"}
    with operation("llm.responses", "llm", inputs={"instructions": kwargs.get("instructions"),
                   "input": kwargs.get("input")}, attributes=attrs) as op:
        try:
            result = await call(**kwargs)
        except Exception as exc:
            if enabled() and getattr(exc, "status_code", None) == 429:
                instruments().rate_limits.add(
                    1, {"provider": provider, "model": model})
            raise
        usage = getattr(result, "usage", None)
        for direction in ("input", "output"):
            count = getattr(usage, direction + "_tokens", 0) or 0
            op.span.set_attribute("gen_ai.usage." + direction + "_tokens", count)
            if enabled():
                instruments().llm_tokens.add(
                    count, {"provider": provider, "model": model, "direction": direction})
        op.span.set_attribute("gen_ai.response.model", getattr(result, "model", None) or model)
        if getattr(result, "status", "completed") != "completed":
            op.error("incomplete_response")
        op.output(getattr(result, "output", None))
        return result


if enabled():
    from .sqlite import instrument_shortcuts
    instrument_shortcuts()

    from opentelemetry.metrics import Observation
    metrics.get_meter("relohome").create_observable_gauge(
        "relohome.heartbeat", callbacks=[lambda _: [Observation(time.time())]], unit="s",
    )
