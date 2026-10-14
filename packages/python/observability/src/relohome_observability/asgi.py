"""Official framework instrumentation with a small policy/metrics boundary."""

import time

from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode

from .runtime import enabled, instruments, log_event

HEALTH = frozenset({"/health", "/healthz", "/ready", "/readyz", "/metrics"})
EXCLUDED_URLS = r"/(?:healthz?|readyz?|metrics)(?:\?.*)?$|/(?:assets|images)/"
_SERVER_SPAN = "relohome.server_span"


def _request_hook(span, scope):
    scope[_SERVER_SPAN] = span


class _ExceptionDetailsMiddleware:
    """Retain the exception before Starlette's error middleware sends its 500."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        try:
            await self.app(scope, receive, send)
        except Exception as exc:
            span = trace.get_current_span()
            if span.is_recording():
                span.record_exception(exc)
                span.set_status(Status(StatusCode.ERROR))
            raise


class HTTPBoundaryMiddleware:
    """Trust policy, trace header, and existing operational signals; creates no spans."""

    def __init__(self, app, uninstrumented_app, trust_incoming=True):
        self.app, self.uninstrumented_app = app, uninstrumented_app
        self.trust_incoming = trust_incoming

    async def __call__(self, scope, receive, send):
        if not enabled() or scope["type"] != "http" or scope["path"] in HEALTH:
            return await self.uninstrumented_app(scope, receive, send)
        if scope["path"].startswith(("/assets/", "/images/")):
            return await self.uninstrumented_app(scope, receive, send)
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


def _install_boundary(app, original_build, trust_incoming):
    instrumented_build = app.build_middleware_stack

    def build():
        return HTTPBoundaryMiddleware(
            instrumented_build(), original_build(), trust_incoming,
        )

    app.build_middleware_stack = build
    app.middleware_stack = None
    app._relohome_original_build = original_build
    app._relohome_instrumented = True


def install_http_boundary(app, trust_incoming=True):
    """Attach application policy to a framework app already instrumented by the CLI."""
    if (not enabled() or getattr(app, "_relohome_instrumented", False)
            or not getattr(app, "_is_instrumented_by_opentelemetry", False)):
        return
    if hasattr(app, "_original_build_middleware_stack"):
        _install_boundary(app, app._original_build_middleware_stack, trust_incoming)
        return

    from opentelemetry.instrumentation.asgi import OpenTelemetryMiddleware
    from opentelemetry.util.http import parse_excluded_urls

    instrumented_build = app.build_middleware_stack

    def original_build():
        middleware = app.user_middleware
        app.user_middleware = [item for item in middleware if item.cls is not OpenTelemetryMiddleware]
        try:
            return instrumented_build()
        finally:
            app.user_middleware = middleware

    # StarletteInstrumentor doesn't expose these ASGI options. Configure the
    # official middleware it installed, rather than installing a second one.
    for middleware in app.user_middleware:
        if middleware.cls is OpenTelemetryMiddleware:
            middleware.kwargs.update(
                excluded_urls=parse_excluded_urls(EXCLUDED_URLS), exclude_spans=["receive", "send"],
                http_capture_headers_server_request=[], http_capture_headers_server_response=[],
            )

    def build():
        # The official Starlette middleware sits inside ServerErrorMiddleware,
        # which sends unhandled 500 responses after its span has ended. Move the
        # installed SDK middleware outside it (as FastAPIInstrumentor does),
        # preserving the original exception before that response is generated.
        stack = instrumented_build()
        parent, current = stack, getattr(stack, "app", None)
        while current is not None and not isinstance(current, OpenTelemetryMiddleware):
            parent, current = current, getattr(current, "app", None)
        if current is not None:
            parent.app = current.app
            stack.app = _ExceptionDetailsMiddleware(stack.app)
            current.app = stack
            return current
        return stack

    app.build_middleware_stack = build
    _install_boundary(app, original_build, trust_incoming)
