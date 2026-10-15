"""Official framework instrumentation with a small policy/metrics boundary."""

import time

from opentelemetry import trace

from .runtime import enabled, instruments, log_event

HEALTH = frozenset({"/health", "/healthz", "/ready", "/readyz", "/metrics"})
EXCLUDED_URLS = r"/(?:healthz?|readyz?|metrics)(?:\?.*)?$|/(?:assets|images)/"
_SERVER_SPAN = "relohome.server_span"


def _request_hook(span, scope):
    scope[_SERVER_SPAN] = span


class HTTPBoundaryMiddleware:
    """Trust policy, trace header, and existing operational signals; creates no spans."""

    def __init__(self, app, trust_incoming=True):
        self.app = app
        self.trust_incoming = trust_incoming

    async def __call__(self, scope, receive, send):
        if not enabled() or scope["type"] != "http" or scope["path"] in HEALTH:
            return await self.app(scope, receive, send)
        if scope["path"].startswith(("/assets/", "/images/")):
            return await self.app(scope, receive, send)
        scope = {**scope}
        if not self.trust_incoming:
            scope["headers"] = [(key, value) for key, value in scope.get("headers", [])
                                if key not in {b"traceparent", b"tracestate", b"baggage"}]
        status, started = 500, time.monotonic()

        async def wrapped_send(message):
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                span = scope.get(_SERVER_SPAN)
                if span is not None and span.get_span_context().is_valid:
                    headers = [(key, value) for key, value in message.get("headers", []) if key != b"x-trace-id"]
                    headers.append((b"x-trace-id", format(span.get_span_context().trace_id, "032x").encode()))
                    message = {**message, "headers": headers}
            await send(message)

        from opentelemetry import context
        token = context.attach(context.Context()) if not self.trust_incoming else None
        try:
            await self.app(scope, receive, wrapped_send)
        finally:
            try:
                span = scope.get(_SERVER_SPAN, trace.INVALID_SPAN)
                attributes = getattr(span, "attributes", None) or {}
                route = attributes.get("http.route", "unmatched")
                method = scope.get("method", "OTHER")
                method = method if method in {"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"} else "OTHER"
                labels = {"method": method, "route": route, "status": str(status)}
                duration = time.monotonic() - started
                instruments().http_requests.add(1, labels)
                instruments().http_duration.record(duration, labels)
                # The official middleware has ended its span. Retain its context
                # for log correlation without creating or reopening a span.
                with trace.use_span(span, end_on_exit=False, record_exception=False, set_status_on_exception=False):
                    log_event("http.completed", **labels, duration_ms=round(duration * 1000))
            except Exception:
                pass
            finally:
                if token is not None:
                    context.detach(token)


def install_http_boundary(app, trust_incoming=True):
    """Add trace headers and dashboard metrics to the CLI's official middleware."""
    if not enabled() or getattr(app, "_relohome_instrumented", False):
        return
    from opentelemetry.instrumentation.asgi import OpenTelemetryMiddleware

    original_build = app.build_middleware_stack

    def build():
        stack = original_build()
        middleware = stack
        while middleware is not None:
            if isinstance(middleware, OpenTelemetryMiddleware):
                middleware.server_request_hook = _request_hook
                middleware.exclude_receive_span = middleware.exclude_send_span = True
                break
            middleware = getattr(middleware, "app", None)
        return HTTPBoundaryMiddleware(stack, trust_incoming=trust_incoming)

    app.build_middleware_stack = build
    app.middleware_stack = None
    app._relohome_original_build = original_build
    app._relohome_instrumented = True
