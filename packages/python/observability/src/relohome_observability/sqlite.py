"""SQLite spans within real operations, including context across aiosqlite's queue."""

import sqlite3
from contextvars import copy_context
from functools import lru_cache

import wrapt
from opentelemetry import trace
from opentelemetry.instrumentation.dbapi import CursorTracer, DatabaseApiIntegration
from opentelemetry.instrumentation.utils import is_instrumentation_enabled

from .runtime import enabled

_instrumented = False


@lru_cache(maxsize=1)
def _cursor_tracer(provider):
    # SQLite's C backup API rejects generic connection proxies. Delegate tracing
    # to the official DB-API integration while retaining native SQLite objects.
    return CursorTracer(DatabaseApiIntegration(
        "opentelemetry.instrumentation.sqlite3", "sqlite", {}, version="0.66b1",
        tracer_provider=provider, capture_parameters=False, enable_commenter=False,
    ))


def _execute(wrapped, method, *args, **kwargs):
    # Startup and idle polling are not user operations. An unsampled but valid
    # parent still reaches the sampler, preserving distributed sampling choices.
    if (not enabled() or not is_instrumentation_enabled()
            or not trace.get_current_span().get_span_context().is_valid):
        return getattr(wrapped, method)(*args, **kwargs)
    return _cursor_tracer(trace.get_tracer_provider()).traced_execution(
        wrapped, getattr(wrapped, method), *args, **kwargs,
    )


class Cursor(sqlite3.Cursor):
    def execute(self, *args, **kwargs):
        return _execute(super(), "execute", *args, **kwargs)

    def executemany(self, *args, **kwargs):
        return _execute(super(), "executemany", *args, **kwargs)

    def executescript(self, *args, **kwargs):
        return _execute(super(), "executescript", *args, **kwargs)


class Connection(sqlite3.Connection):
    # Native subclasses remain valid for SQLite's C API, including a backup
    # from an uninstrumented source into an instrumented destination.
    def execute(self, *args, **kwargs):
        return self.cursor().execute(*args, **kwargs)

    def executemany(self, *args, **kwargs):
        return self.cursor().executemany(*args, **kwargs)

    def executescript(self, *args, **kwargs):
        return self.cursor().executescript(*args, **kwargs)

    def cursor(self, *args, **kwargs):
        if not args and "factory" not in kwargs:
            kwargs["factory"] = Cursor
        return super().cursor(*args, **kwargs)


def instrument_shortcuts():
    """Instrument both SQLite APIs once; aiosqlite remains an optional dependency."""
    global _instrumented
    if _instrumented:
        return
    _instrumented = True

    def connect(wrapped, instance, args, kwargs):
        # Keep application-owned factories and their constructor behavior intact.
        # Only replace SQLite's native default; never proxy C extension objects.
        if len(args) > 5:
            if args[5] is sqlite3.Connection:
                args = (*args[:5], Connection, *args[6:])
        elif kwargs.get("factory", sqlite3.Connection) is sqlite3.Connection:
            kwargs = {**kwargs, "factory": Connection}
        return wrapped(*args, **kwargs)

    for module in (sqlite3, sqlite3.dbapi2):
        wrapt.wrap_function_wrapper(module, "connect", connect)

    try:
        import aiosqlite
    except ImportError:
        return

    async def dispatch(wrapped, instance, args, kwargs):
        # One shared worker serves many requests. Capture context for each queued
        # call, not at connection creation, so concurrent requests stay separate.
        function, *arguments = args
        return await wrapped(copy_context().run, function, *arguments, **kwargs)

    wrapt.wrap_function_wrapper(aiosqlite.Connection, "_execute", dispatch)
