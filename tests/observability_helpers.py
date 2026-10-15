"""Configure in-process fixtures without running pytest under the CLI."""

from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from relohome_observability.runtime import enabled


def instrument_fastapi(app):
    if enabled():
        FastAPIInstrumentor.instrument_app(app)


def uninstrument_http(app):
    if getattr(app, "_is_instrumented_by_opentelemetry", False):
        FastAPIInstrumentor.uninstrument_app(app)
        app.middleware_stack = None
