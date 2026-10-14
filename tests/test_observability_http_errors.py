"""Real HTTP boundaries retain safe causes from automatic and handled failures."""

import json
import socket
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI
from opentelemetry import trace
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
from opentelemetry.sdk._logs import LoggerProvider
from opentelemetry.sdk._logs.export import InMemoryLogRecordExporter, SimpleLogRecordProcessor
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from pydantic import SecretStr
from relohome_gateway.server import create_app
from relohome_observability import record_http_error, runtime
from relohome_observability.asgi import TelemetryMiddleware
from relohome_observability.fastapi import (
    DiagnosticHTTPException,
    DiagnosticJSONResponse,
    diagnostic_exception_handler,
)


@pytest.fixture
def observed(monkeypatch):
    monkeypatch.setenv("OBSERVABILITY_ENABLED", "true")
    monkeypatch.setenv("OBSERVABILITY_CONTENT_MODE", "metadata")
    monkeypatch.setenv("RELOHOME_GUEST_ENABLED", "true")
    monkeypatch.setattr(runtime, "_initialized", True)
    spans = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(runtime.SanitizingProcessor(SimpleSpanProcessor(spans)))
    monkeypatch.setattr(trace, "_TRACER_PROVIDER", provider)
    logs = InMemoryLogRecordExporter()
    logger_provider = LoggerProvider()
    logger_provider.add_log_record_processor(SimpleLogRecordProcessor(logs))
    monkeypatch.setattr(runtime, "_logger", logger_provider.get_logger("test"))
    yield SimpleNamespace(spans=spans, logs=logs)
    logger_provider.shutdown()
    provider.shutdown()


async def gateway_status(tmp_path, observed, transport=None):
    app = create_app(tmp_path / "web.db", transport)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client,
    ):
        await client.get("/web/api/session")
        observed.spans.clear()
        observed.logs.clear()
        return await client.get("/web/api/status")


def assert_diagnostic(observed, response, error_type):
    span = next(item for item in observed.spans.get_finished_spans() if item.kind == trace.SpanKind.SERVER)
    assert span.attributes["error.type"] == error_type
    assert span.attributes["http.response.status_code"] == response.status_code
    assert span.status.status_code == trace.StatusCode.ERROR
    assert response.headers["x-trace-id"] == format(span.context.trace_id, "032x")
    logs = [item.log_record for item in observed.logs.get_finished_logs()
            if (item.log_record.attributes or {}).get("error_type") == error_type]
    assert len(logs) == 1
    assert logs[0].trace_id == span.context.trace_id
    assert logs[0].span_id == span.context.span_id
    assert logs[0].severity_text == "ERROR"
    assert not span.events
    assert span.status.description is None


@pytest.mark.asyncio
@pytest.mark.parametrize("enabled", [True, False])
async def test_gateway_missing_token_has_safe_reason_and_never_calls_upstream(tmp_path, monkeypatch, observed, enabled):
    monkeypatch.setenv("OBSERVABILITY_ENABLED", str(enabled).lower())
    monkeypatch.delenv("AGENT_API_TOKEN", raising=False)

    def upstream(request):
        raise AssertionError("A missing token must stop before the HTTP request")

    response = await gateway_status(tmp_path, observed, httpx.MockTransport(upstream))
    assert response.status_code == 503
    assert response.json() == {"detail": "Chưa kết nối được hệ thống AI. Vui lòng kiểm tra cấu hình máy chủ."}
    if enabled:
        assert_diagnostic(observed, response, "missing_agent_api_token")
        assert len(observed.spans.get_finished_spans()) == 1
    else:
        assert not observed.spans.get_finished_spans()
        assert not observed.logs.get_finished_logs()
        assert "x-trace-id" not in response.headers


@pytest.mark.asyncio
@pytest.mark.parametrize("reason", ["agent_runtime_not_started", "missing_agent_api_token"])
async def test_backend_status_has_reason_on_existing_http_span(monkeypatch, observed, reason):
    from relohome_agent.main import app

    if reason == "missing_agent_api_token":
        service = SimpleNamespace(mode="live", settings=SimpleNamespace(agent_api_token=SecretStr("")))
    else:
        service = None
    monkeypatch.setattr(app.state, "agent_service", service, raising=False)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/v1/status")
    assert response.status_code == 503
    assert_diagnostic(observed, response, reason)
    assert len(observed.spans.get_finished_spans()) == 1


@pytest.mark.asyncio
async def test_automatic_httpx_exception_type_survives_sanitization(tmp_path, monkeypatch, observed):
    monkeypatch.setenv("AGENT_API_TOKEN", "SYNTHETIC_PRIVATE_TOKEN")
    instrumentor = HTTPXClientInstrumentor()
    instrumentor.instrument()
    try:
        # Reserve a local port without listening: fail without an external service.
        with socket.socket() as reserved:
            reserved.bind(("127.0.0.1", 0))
            monkeypatch.setenv("LIFEFLOW_API_BASE_URL", f"http://127.0.0.1:{reserved.getsockname()[1]}/api/v1")
            response = await gateway_status(tmp_path, observed)
        assert response.status_code == 502
        spans = observed.spans.get_finished_spans()
        server = next(span for span in spans if span.kind == trace.SpanKind.SERVER)
        client = next(span for span in spans if span.kind == trace.SpanKind.CLIENT)
        assert client.attributes["error.type"].endswith("ConnectError")
        assert client.status.status_code == trace.StatusCode.ERROR
        assert client.parent.span_id == server.context.span_id
        assert client.context.trace_id == server.context.trace_id
        assert server.attributes["error.type"] == "502"
        assert not client.events
        assert client.status.description is None
        assert "SYNTHETIC_PRIVATE" not in json.dumps([dict(span.attributes) for span in spans])
    finally:
        instrumentor.uninstrument()


@pytest.mark.asyncio
async def test_invalid_upstream_json_has_reason_without_exporting_body(tmp_path, monkeypatch, observed):
    monkeypatch.setenv("AGENT_API_TOKEN", "SYNTHETIC_PRIVATE_TOKEN")
    transport = httpx.MockTransport(lambda _: httpx.Response(200, text="SYNTHETIC_PRIVATE_RESPONSE"))
    response = await gateway_status(tmp_path, observed, transport)
    assert response.status_code == 502
    assert_diagnostic(observed, response, "upstream_invalid_json")
    assert "SYNTHETIC_PRIVATE" not in str(observed.spans.get_finished_spans())
    assert "SYNTHETIC_PRIVATE" not in str(observed.logs.get_finished_logs())


@pytest.mark.asyncio
async def test_recovered_error_does_not_mark_successful_http_span(observed):
    app = FastAPI(telemetry={"tracing": False})
    app.add_middleware(TelemetryMiddleware)
    app.add_exception_handler(DiagnosticHTTPException, diagnostic_exception_handler)

    @app.get("/recovered")
    async def recovered():
        try:
            raise DiagnosticHTTPException(503, "Not available", error_type="missing_agent_api_token")
        except DiagnosticHTTPException:
            return {"cached": True}

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/recovered")
    assert response.status_code == 200
    span = observed.spans.get_finished_spans()[0]
    assert span.status.status_code == trace.StatusCode.UNSET
    assert "error.type" not in span.attributes
    assert all("error_type" not in item.log_record.attributes for item in observed.logs.get_finished_logs())


@pytest.mark.asyncio
async def test_diagnostic_response_preserves_body_and_headers(observed):
    app = FastAPI(telemetry={"tracing": False})
    app.add_middleware(TelemetryMiddleware)

    @app.get("/uncertain")
    async def uncertain():
        return DiagnosticJSONResponse(
            {"code": "uncertain", "detail": "Check before retrying"}, status_code=502,
            error_type="upstream_invalid_json", headers={"Retry-After": "10"},
        )

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/uncertain")
    assert response.status_code == 502
    assert response.json() == {"code": "uncertain", "detail": "Check before retrying"}
    assert response.headers["Retry-After"] == "10"
    assert_diagnostic(observed, response, "upstream_invalid_json")


def test_diagnostics_reject_arbitrary_codes_and_fail_open(monkeypatch, observed):
    with trace.get_tracer("test").start_as_current_span("request"):
        record_http_error("SYNTHETIC_PRIVATE_ERROR_MESSAGE")
    assert "error.type" not in observed.spans.get_finished_spans()[0].attributes
    assert not observed.logs.get_finished_logs()

    def broken():
        raise RuntimeError("Broken telemetry")

    monkeypatch.setattr(trace, "get_current_span", broken)
    record_http_error("missing_agent_api_token")
