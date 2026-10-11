"""Trace sqlite connection shortcuts, which the upstream cursor instrumentor omits."""

import sqlite3

import wrapt
from opentelemetry import trace
from opentelemetry.trace import SpanKind, Status, StatusCode


class Connection(wrapt.ObjectProxy):
    def _execute(self, method, *args, **kwargs):
        statement = args[0] if args else kwargs.get("sql", "")
        verb = str(statement).split(maxsplit=1)[0].upper() if statement else "QUERY"
        verb = verb if verb in {"SELECT", "INSERT", "UPDATE", "DELETE", "CREATE", "PRAGMA", "BEGIN", "COMMIT", "ROLLBACK"} else "QUERY"
        with trace.get_tracer("lifeflow.sqlite").start_as_current_span(
            "db." + verb, kind=SpanKind.CLIENT,
            attributes={"db.system": "sqlite", "db.operation.name": verb},
            record_exception=False, set_status_on_exception=False,
        ) as span:
            try:
                return getattr(self.__wrapped__, method)(*args, **kwargs)
            except Exception as error:
                span.set_status(Status(StatusCode.ERROR))
                span.set_attribute("error.type", type(error).__name__)
                raise

    def execute(self, *args, **kwargs):
        return self._execute("execute", *args, **kwargs)

    def executemany(self, *args, **kwargs):
        return self._execute("executemany", *args, **kwargs)

    def executescript(self, *args, **kwargs):
        return self._execute("executescript", *args, **kwargs)

    def __enter__(self):
        self.__wrapped__.__enter__()
        return self

    def __exit__(self, *args):
        return self.__wrapped__.__exit__(*args)


def instrument_shortcuts():
    def connect(wrapped, instance, args, kwargs):
        return Connection(wrapped(*args, **kwargs))
    for module in (sqlite3, sqlite3.dbapi2):
        wrapt.wrap_function_wrapper(module, "connect", connect)
