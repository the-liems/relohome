from __future__ import annotations

import atexit
import functools
import inspect
import logging
import os
import sys
import time
from contextlib import contextmanager
from contextvars import ContextVar
from types import SimpleNamespace

from opentelemetry import context, metrics, trace
from opentelemetry.sdk.trace import ReadableSpan, SpanProcessor
from opentelemetry.trace import Link, SpanKind, Status, StatusCode
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

from .privacy import content

_SESSION: ContextVar[str | None] = ContextVar("telemetry_session", default=None)
_initialized = False
_logger = None
_propagator = TraceContextTextMapPropagator()  # No baggage: never propagate identity/credentials.
SAFE_ATTRIBUTES = frozenset({
    "http.request.method", "http.method", "http.response.status_code", "http.status_code", "http.route",
    "db.system", "db.system.name", "db.operation", "db.operation.name", "server.address", "server.port",
    "network.protocol.version", "rpc.system", "rpc.method", "error.type", "lifeflow.operation", "lifeflow.kind",
    "lifeflow.outcome", "lifeflow.origin_trace_id", "lifeflow.cache_hit", "langfuse.session.id",
    "langfuse.environment", "langfuse.observation.type", "langfuse.observation.input", "langfuse.observation.output",
    "gen_ai.system", "gen_ai.provider.name", "gen_ai.operation.name", "gen_ai.request.model",
    "gen_ai.response.model", "gen_ai.usage.input_tokens", "gen_ai.usage.output_tokens", "langfuse.observation.level",
})


def enabled() -> bool:
    return os.getenv("OBSERVABILITY_ENABLED", "false").lower() == "true"


def instruments():
    """Create instruments once, on the first enabled request after SDK setup."""
    return _instruments(metrics.get_meter_provider())


@functools.lru_cache(maxsize=1)
def _instruments(provider):
    # The provider changes after bootstrap (and in isolated tests). Do not retain
    # instruments belonging to the previous provider or a shutdown exporter.
    meter = provider.get_meter("lifeflow")
    return SimpleNamespace(
        operations=meter.create_counter("lifeflow.operations"),
        operation_duration=meter.create_histogram("lifeflow.operation.duration", unit="s"),
        http_requests=meter.create_counter("lifeflow.http.requests"),
        http_duration=meter.create_histogram("lifeflow.http.duration", unit="s"),
        rate_limits=meter.create_counter("lifeflow.provider.rate_limits"),
        llm_tokens=meter.create_counter("lifeflow.llm.tokens"),
    )


def safe_span(span: ReadableSpan) -> ReadableSpan:
    """Drop raw HTTP URLs, SQL, stack traces and arbitrary instrumentor attributes before queueing."""
    attrs = {key: value for key, value in (span.attributes or {}).items() if key in SAFE_ATTRIBUTES}
    name = span.name
    if "db.system" in attrs or "db.system.name" in attrs:
        statement = (span.attributes or {}).get("db.query.text", (span.attributes or {}).get("db.statement", ""))
        operation_name = str(attrs.get("db.operation.name", attrs.get("db.operation", "")))
        if not operation_name:
            operation_name = str(statement).split(maxsplit=1)[0].upper() if statement else "QUERY"
        operation_name = operation_name if operation_name in {"SELECT", "INSERT", "UPDATE", "DELETE", "CREATE", "COMMIT", "ROLLBACK", "BEGIN", "PRAGMA"} else "QUERY"
        name = "db." + operation_name
        attrs["db.operation.name"] = operation_name
    return ReadableSpan(
        name=name, context=span.context, parent=span.parent, resource=span.resource,
        attributes=attrs, events=(), links=tuple(Link(link.context) for link in span.links),
        kind=span.kind, status=Status(span.status.status_code), start_time=span.start_time, end_time=span.end_time,
        instrumentation_scope=span.instrumentation_scope,
    )


class SanitizingProcessor(SpanProcessor):
    def __init__(self, delegate):
        self.delegate = delegate

    def on_start(self, span, parent_context=None):
        sid = _SESSION.get()
        if sid:
            span.set_attribute("langfuse.session.id", sid)
        span.set_attribute("langfuse.environment", os.getenv("OTEL_DEPLOYMENT_ENVIRONMENT", "development"))

    def on_end(self, span):
        try:
            self.delegate.on_end(safe_span(span))
        except Exception:
            # Broken telemetry must not escape into a business operation.
            pass

    def shutdown(self):
        self.delegate.shutdown()

    def force_flush(self, timeout_millis=30000):
        return self.delegate.force_flush(timeout_millis)


class MetadataLogHandler(logging.Handler):
    def emit(self, record):
        if record.name.startswith("opentelemetry"):
            return  # Exporter failures must never recursively export themselves.
        # Arbitrary application messages/args may contain payloads. Export only source metadata.
        log_event("application.log", severity=record.levelname, source=record.name,
                  error_type=record.exc_info[0].__name__ if record.exc_info and record.exc_info[0] else None)


def initialize(service_name: str):
    global _initialized, _logger
    if _initialized or not enabled():
        return
    _initialized = True
    try:
        from opentelemetry._logs import set_logger_provider
        from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
        from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
        from opentelemetry.sdk._logs import LoggerProvider
        from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
        from opentelemetry.sdk.metrics import MeterProvider
        from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
        from opentelemetry.sdk.metrics.view import ExplicitBucketHistogramAggregation, View
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
        from opentelemetry.sdk.trace.sampling import ALWAYS_ON, ParentBased

        resource = Resource({
            "service.name": os.getenv("OTEL_SERVICE_NAME", service_name), "service.namespace": "lifeflow",
            "service.version": os.getenv("RELEASE_SHA", "development"),
            "deployment.environment.name": os.getenv("OTEL_DEPLOYMENT_ENVIRONMENT", "development"),
        })
        endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318").rstrip("/")
        providers = []
        tracer_provider = TracerProvider(resource=resource, sampler=ParentBased(ALWAYS_ON))
        tracer_provider.add_span_processor(SanitizingProcessor(BatchSpanProcessor(
            OTLPSpanExporter(endpoint=endpoint + "/v1/traces", timeout=3),
            max_queue_size=2048, max_export_batch_size=256, schedule_delay_millis=5000,
        )))
        trace.set_tracer_provider(tracer_provider)
        providers.append(tracer_provider)
        logs = LoggerProvider(resource=resource)
        logs.add_log_record_processor(BatchLogRecordProcessor(
            OTLPLogExporter(endpoint=endpoint + "/v1/logs", timeout=3),
            max_queue_size=2048, max_export_batch_size=256, schedule_delay_millis=5000,
        ))
        set_logger_provider(logs)
        _logger = logs.get_logger("lifeflow")
        providers.append(logs)
        reader = PeriodicExportingMetricReader(
            OTLPMetricExporter(endpoint=endpoint + "/v1/metrics", timeout=3),
            export_interval_millis=15000, export_timeout_millis=5000,
        )
        meter_provider = MeterProvider(resource=resource, metric_readers=[reader], views=[View(
            instrument_name="lifeflow.*.duration", aggregation=ExplicitBucketHistogramAggregation(
                boundaries=[0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 180, 240, 300]),
        )])
        metrics.set_meter_provider(meter_provider)
        providers.append(meter_provider)
        from opentelemetry.metrics import Observation
        metrics.get_meter("lifeflow").create_observable_gauge(
            "lifeflow.heartbeat", callbacks=[lambda _: [Observation(time.time())]], unit="s",
        )
        HTTPXClientInstrumentor().instrument()
        from .sqlite import instrument_shortcuts
        instrument_shortcuts()
        logging.getLogger().addHandler(MetadataLogHandler(level=logging.INFO))

        def shutdown():
            for provider in providers:
                try:
                    provider.shutdown()
                except Exception:
                    pass
        atexit.register(shutdown)
    except Exception:
        # Deliberately omit exception values, URLs, and config: they can contain credentials.
        print('{"event":"telemetry_initialization_failed"}', file=sys.stderr)


def log_event(event: str, *, severity="INFO", **attributes):
    if _logger is None:
        return
    try:
        from opentelemetry._logs import SeverityNumber
        severity_name = {"WARNING": "WARN", "CRITICAL": "FATAL"}.get(severity, severity)
        severity_number = getattr(SeverityNumber, severity_name, SeverityNumber.INFO)
        attributes = {key: value for key, value in attributes.items() if value is not None}
        _logger.emit(body=event, severity_number=severity_number, severity_text=severity, attributes=attributes)
    except Exception:
        pass


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
    attrs = {"lifeflow.operation": name, "lifeflow.kind": kind,
             "langfuse.observation.type": {"llm": "generation", "tool": "tool", "agent": "agent",
                                            "workflow": "chain"}.get(kind, "span")}
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
            attrs["lifeflow.origin_trace_id"] = format(linked.trace_id, "032x")
    with trace.get_tracer("lifeflow").start_as_current_span(
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
            span.set_attribute("lifeflow.outcome", op.outcome)
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
