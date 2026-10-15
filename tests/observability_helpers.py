"""Configure existing in-process fixtures without running pytest under the CLI."""

from fastapi import FastAPI
from relohome_observability.asgi import EXCLUDED_URLS, _request_hook, install_http_boundary
from relohome_observability.runtime import enabled


def instrument_fastapi(app, trust_incoming=True):
    if enabled() and not getattr(app, "_is_instrumented_by_opentelemetry", False):
        if isinstance(app, FastAPI):
            from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

            FastAPIInstrumentor.instrument_app(
                app, server_request_hook=_request_hook, excluded_urls=EXCLUDED_URLS,
                exclude_spans=["receive", "send"], http_capture_headers_server_request=[],
                http_capture_headers_server_response=[],
            )
        else:
            from opentelemetry.instrumentation.starlette import StarletteInstrumentor

            StarletteInstrumentor.instrument_app(app, server_request_hook=_request_hook)
    install_http_boundary(app, trust_incoming=trust_incoming)


def uninstrument_http(app):
    if not getattr(app, "_is_instrumented_by_opentelemetry", False):
        return
    original_build = getattr(app, "_relohome_original_build", None)
    if hasattr(app, "_original_build_middleware_stack"):
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

        FastAPIInstrumentor.uninstrument_app(app)
    else:
        from opentelemetry.instrumentation.starlette import StarletteInstrumentor

        StarletteInstrumentor.uninstrument_app(app)
    if original_build is not None and not hasattr(app, "_original_build_middleware_stack"):
        # FastAPI uninstrument_app has already restored its bare builder.
        if not isinstance(app, FastAPI):
            app.build_middleware_stack = original_build
    app.middleware_stack = None
    app._relohome_instrumented = False
