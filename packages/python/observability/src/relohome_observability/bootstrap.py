"""OpenTelemetry CLI extension: one SDK configuration, discovered integrations."""

import os

from opentelemetry.instrumentation.distro import BaseDistro
from opentelemetry.sdk._configuration import _BaseConfigurator

from .runtime import enabled, initialize


class ReloHomeConfigurator(_BaseConfigurator):
    def _configure(self, **kwargs):
        initialize(os.getenv("OTEL_SERVICE_NAME", "relohome"))


class ReloHomeDistro(BaseDistro):
    def _configure(self, **kwargs):
        os.environ.setdefault("OTEL_PYTHON_CONFIGURATOR", "relohome")

    def load_instrumentor(self, entry_point, **kwargs):
        if not enabled() or entry_point.name in {"sqlite3", "logging"}:
            # Native SQLite objects and metadata-only logs need our existing
            # adapters; generic proxies/handlers would bypass those policies.
            return
        if entry_point.name in {"fastapi", "starlette"}:
            from .asgi import EXCLUDED_URLS, _request_hook

            kwargs["server_request_hook"] = _request_hook
            if entry_point.name == "fastapi":
                kwargs.update(
                    excluded_urls=EXCLUDED_URLS, exclude_spans=["receive", "send"],
                    http_capture_headers_server_request=[], http_capture_headers_server_response=[],
                )
        if entry_point.name == "psycopg":
            kwargs.update(capture_parameters=False, enable_commenter=False)
        super().load_instrumentor(entry_point, **kwargs)
