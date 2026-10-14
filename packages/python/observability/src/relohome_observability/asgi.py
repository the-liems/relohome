"""ASGI boundaries without request/response bodies, headers, URLs or query strings."""

import time

from opentelemetry import trace
from opentelemetry.trace import SpanKind, Status, StatusCode

from .runtime import enabled, extract, initialize, instruments, log_event

HEALTH = frozenset({"/health", "/healthz", "/ready", "/readyz", "/metrics"})


class TelemetryMiddleware:
    def __init__(self, app, service_name="backend", trust_incoming=True):
        self.app, self.trust_incoming = app, trust_incoming
        initialize(service_name)

    async def __call__(self, scope, receive, send):
        if not enabled() or scope["type"] != "http" or scope["path"] in HEALTH:
            return await self.app(scope, receive, send)
        if scope["path"].startswith(("/assets/", "/images/")):
            return await self.app(scope, receive, send)
        carrier = {key.decode(): value.decode("latin-1") for key, value in scope.get("headers", [])
                   if key in {b"traceparent", b"tracestate"}}
        from opentelemetry.context import Context
        parent = extract(carrier) if self.trust_incoming else Context()
        method = scope.get("method", "OTHER")
        if method not in {"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"}:
            method = "OTHER"
        status, started = 500, time.monotonic()
        with trace.get_tracer("relohome").start_as_current_span(
            method, context=parent, kind=SpanKind.SERVER, attributes={"http.request.method": method},
            record_exception=False, set_status_on_exception=False,
        ) as span:
            async def wrapped_send(message):
                nonlocal status
                if message["type"] == "http.response.start":
                    status = message["status"]
                    headers = list(message.get("headers", []))
                    headers.append((b"x-trace-id", format(span.get_span_context().trace_id, "032x").encode()))
                    message = {**message, "headers": headers}
                await send(message)
            try:
                await self.app(scope, receive, wrapped_send)
            except Exception as exc:
                span.set_attribute("error.type", type(exc).__name__)
                raise
            finally:
                route = getattr(scope.get("route"), "path", None)
                # Starlette MCP apps have no FastAPI route template attached to scope.
                route = route or ("/mcp" if scope["path"] == "/mcp" else "unmatched")
                span.update_name(method + " " + route)
                span.set_attribute("http.route", route)
                span.set_attribute("http.response.status_code", status)
                if status >= 500:
                    span.set_status(Status(StatusCode.ERROR))
                labels = {"method": method, "route": route, "status": str(status)}
                duration = time.monotonic() - started
                instruments().http_requests.add(1, labels)
                instruments().http_duration.record(duration, labels)
                log_event("http.completed", method=method, route=route, status=status,
                          duration_ms=round(duration * 1000))
