"""SQLite spans within real operations, including context across aiosqlite's queue."""

import sqlite3
from contextvars import copy_context

import wrapt
from opentelemetry import trace
from opentelemetry.instrumentation.utils import is_instrumentation_enabled
from opentelemetry.trace import SpanKind, Status, StatusCode

from .runtime import enabled

_instrumented = False


def _execute(wrapped, method, *args, **kwargs):
    # Startup and idle polling are not user operations. An unsampled but valid
    # parent still reaches the sampler, preserving distributed sampling choices.
    if (not enabled() or not is_instrumentation_enabled()
            or not trace.get_current_span().get_span_context().is_valid):
        return getattr(wrapped, method)(*args, **kwargs)
    statement = args[0] if args else kwargs.get("sql", "")
    verb = str(statement).split(maxsplit=1)[0].upper() if statement else "QUERY"
    verb = verb if verb in {"SELECT", "INSERT", "UPDATE", "DELETE", "CREATE", "PRAGMA", "BEGIN", "COMMIT", "ROLLBACK"} else "QUERY"
    with trace.get_tracer("lifeflow.sqlite").start_as_current_span(
        "db." + verb, kind=SpanKind.CLIENT,
        attributes={"db.system": "sqlite", "db.operation.name": verb},
        record_exception=False, set_status_on_exception=False,
    ) as span:
        try:
            return getattr(wrapped, method)(*args, **kwargs)
        except Exception as error:
            span.set_status(Status(StatusCode.ERROR))
            span.set_attribute("error.type", type(error).__name__)
            raise


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
