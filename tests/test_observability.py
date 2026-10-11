import asyncio
import importlib.util
import json
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI
from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from src.observability import current_context, generation, operation, runtime, session
from src.observability.asgi import TelemetryMiddleware
from src.observability.privacy import content
from tests.mcp_http import running_mcp

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def spans(monkeypatch):
    monkeypatch.setenv("OBSERVABILITY_ENABLED", "true")
    monkeypatch.setenv("OBSERVABILITY_CONTENT_MODE", "redacted")
    monkeypatch.setattr(runtime, "_initialized", True)
    exporter = InMemorySpanExporter()
    provider = TracerProvider(resource=Resource({"service.name": "test"}))
    provider.add_span_processor(runtime.SanitizingProcessor(SimpleSpanProcessor(exporter)))
    monkeypatch.setattr(trace, "_TRACER_PROVIDER", provider)
    yield exporter
    provider.shutdown()


@pytest.mark.parametrize("mode", ["redacted", "raw"])
def test_secrets_never_export_and_business_input_unchanged(monkeypatch, mode):
    monkeypatch.setenv("OBSERVABILITY_CONTENT_MODE", mode)
    value = {"contact": {"full_name": "Private Person", "email": "private@example.com"},
             "apiKey": "private-key", "authorization": "Bearer private-token", "qr_code": "signed-payment",
             "input": '{"password":"nested-password","mobile":"0901234567"}',
             "text": "Bearer another-secret https://user:password@example.com/path?token=secret#fragment"}
    before = json.dumps(value)
    output = content(value)
    for secret in ("private-key", "private-token", "signed-payment", "nested-password", "another-secret", "user:password", "token=secret"):
        assert secret not in output
    assert ("Private Person" in output) == (mode == "raw")
    assert ("private@example.com" in output) == (mode == "raw")
    assert json.dumps(value) == before


def test_metadata_invalid_modes_and_serialization_failure_omit_content(monkeypatch):
    for mode in ("metadata", "invalid"):
        monkeypatch.setenv("OBSERVABILITY_CONTENT_MODE", mode)
        assert content({"input": "private"}) is None
    monkeypatch.setenv("OBSERVABILITY_CONTENT_MODE", "redacted")

    class Broken:
        def model_dump(self, **kwargs):
            raise ValueError("private")
    assert content(Broken()) is None
    assert len(content("hello " * 10000).encode()) <= 16384


def test_disabled_telemetry_does_not_serialize_or_reject_business_payloads(monkeypatch):
    monkeypatch.setenv("OBSERVABILITY_ENABLED", "false")

    class Private:
        def model_dump(self, **kwargs):
            raise AssertionError("Disabled telemetry must not inspect payloads")
    with operation("disabled", inputs=Private()) as op:
        op.output(Private())
    assert not runtime.failed({"status": {"nested": "value"}, "task_results": None})


@pytest.mark.asyncio
async def test_concurrent_operations_keep_distinct_parents_and_sessions(spans):
    async def request(name):
        with session(name), operation("request"):
            await asyncio.sleep(0)
            with operation("child", "tool", inputs={"email": "private@example.com"}) as op:
                op.output({"isError": True})
    await asyncio.gather(request("thread-a"), request("thread-b"))
    exported = spans.get_finished_spans()
    roots = {item.attributes["langfuse.session.id"]: item for item in exported if item.name == "request"}
    assert len({item.context.trace_id for item in roots.values()}) == 2
    for child in (item for item in exported if item.name == "child"):
        root = roots[child.attributes["langfuse.session.id"]]
        assert child.parent.span_id == root.context.span_id
        assert child.context.trace_id == root.context.trace_id
        assert child.status.status_code.name == "ERROR"
        assert "private@example.com" not in child.attributes["langfuse.observation.input"]


@pytest.mark.asyncio
async def test_generation_records_usage_on_incomplete_response_without_changing_result(spans):
    reply = SimpleNamespace(status="incomplete", model="test-model", usage=SimpleNamespace(input_tokens=7, output_tokens=3),
                            output=[{"email": "private@example.com"}])

    async def create(**kwargs):
        return reply
    assert await generation(create, provider="openai", model="test-model", input="Hello") is reply
    span = spans.get_finished_spans()[0]
    assert span.attributes["gen_ai.usage.input_tokens"] == 7
    assert span.attributes["gen_ai.usage.output_tokens"] == 3
    assert span.status.status_code.name == "ERROR"


def test_interrupts_and_background_links_do_not_hold_request_open(spans):
    class GraphInterrupt(Exception):  # noqa: N818 — matches LangGraph control flow
        pass
    with operation("request"):
        origin = current_context()
        with pytest.raises(GraphInterrupt), operation("confirmation"):
            raise GraphInterrupt()
    with operation("payment.fulfilment", "job", origin=origin):
        pass
    exported = {item.name: item for item in spans.get_finished_spans()}
    assert exported["confirmation"].attributes["lifeflow.outcome"] == "paused"
    assert exported["confirmation"].status.status_code.name != "ERROR"
    job = exported["payment.fulfilment"]
    assert job.parent is None
    assert job.context.trace_id != exported["request"].context.trace_id
    assert job.links[0].context.trace_id == exported["request"].context.trace_id


def test_automatic_database_and_exception_data_removed_before_export(spans):
    with trace.get_tracer("third.party").start_as_current_span("SELECT private", attributes={
        "db.system": "sqlite", "db.statement": "SELECT 'private@example.com'", "http.url": "https://host/?secret=private",
    }) as span:
        span.record_exception(ValueError("private@example.com"))
        span.set_status(trace.Status(trace.StatusCode.ERROR, "private@example.com"))
    result = spans.get_finished_spans()[0]
    assert result.name == "db.SELECT"
    assert "db.statement" not in result.attributes
    assert "http.url" not in result.attributes
    assert not result.events
    assert result.status.description is None


@pytest.mark.asyncio
async def test_asgi_route_template_trace_header_and_untrusted_parent(spans):
    app = FastAPI(telemetry={"tracing": False})
    app.add_middleware(TelemetryMiddleware, trust_incoming=False)

    @app.get("/item/{item_id}")
    async def item(item_id: str):
        return {"ok": True}

    @app.get("/health")
    async def health():
        return {"ok": True}

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/item/private@example.com?api_key=private", headers={
            "traceparent": "00-11111111111111111111111111111111-1111111111111111-00"})
        assert response.status_code == 200
        assert len(response.headers["x-trace-id"]) == 32
        await client.get("/health")
    exported = spans.get_finished_spans()
    assert len(exported) == 1
    assert exported[0].name == "GET /item/{item_id}"
    assert exported[0].parent is None


@pytest.mark.asyncio
async def test_mcp_http_metadata_connects_tool_server_to_client(spans):
    from src.mcp_servers.http_service import HttpServiceMCP
    from src.services.adapters.mcp import McpEndpoint, McpToolClient

    token = "test-credential-" + "a" * 32
    server = HttpServiceMCP("trace-test", service_token=token)

    @server.tool()
    async def echo(value: str) -> dict:
        return {"result": value}

    async with running_mcp(server) as url:
        client = McpToolClient(McpEndpoint("test", frozenset({"echo"}), url=url, token=token))
        with operation("request"):
            assert await client.call("echo", {"value": "hello"}) == "hello"
    exported = spans.get_finished_spans()
    root = next(item for item in exported if item.name == "request")
    tools = [item for item in exported if item.name == "echo"]
    assert len(tools) == 2
    assert {item.context.trace_id for item in tools} == {root.context.trace_id}
    assert any(item.parent.span_id in {other.context.span_id for other in tools} for item in tools)


def load_script(name, relative):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_retention_freezes_pagination_deletes_trace_ids_then_verifies():
    retention = load_script("retention_test", "deploy/observability/retention.py")

    class Fake:
        def __init__(self):
            self.calls = []
            self.deleted = False

        def request(self, path, method="GET", body=None):
            self.calls.append((path, method, body))
            if method == "DELETE":
                self.deleted = True
                assert body == {"traceIds": ["trace-a", "trace-b"]}
                return {}
            if self.deleted:
                return {"data": []}
            if "cursor=" in path:
                return {"data": [{"traceId": "trace-b"}, {"traceId": "trace-a"}]}
            return {"data": [{"traceId": "trace-a"}], "meta": {"cursor": "page-2"}}

    client = Fake()
    assert retention.cleanup(client, now=datetime(2026, 10, 12, tzinfo=UTC), sleep=lambda _: None) == 2
    assert [call[1] for call in client.calls] == ["GET", "GET", "DELETE", "GET"]
    assert "2026-10-05" in client.calls[0][0]
    assert "2026-10-05" in client.calls[1][0]


def test_stack_render_keeps_discord_only_in_grafana_and_separate_tenants(tmp_path):
    import yaml
    renderer = load_script("render_observability_test", "scripts/render-observability.py")
    path = renderer.render(tmp_path, coolify=True, environments=("staging", "production"))
    stack = yaml.safe_load(path.read_text())
    assert not any(service.get("ports") for service in stack["services"].values())
    for name, service in stack["services"].items():
        assert ("DISCORD_WEBHOOK_URL" in service.get("environment", {})) == (name == "grafana")
    grafana = stack["services"]["grafana"]
    alerts = next(mount["content"] for mount in grafana["volumes"] if isinstance(mount, dict) and "alerting" in mount["target"])
    assert "type: discord" in alerts
    assert "disableResolveMessage: false" in alerts
    assert "$$DISCORD_WEBHOOK_URL" in alerts
    assert "staging" in path.read_text() and "production" in path.read_text()
    gateway = next(mount["content"] for mount in stack["services"]["telemetry-gateway"]["volumes"] if isinstance(mount, dict))
    assert "X-Scope-OrgID staging" in gateway
    assert "X-Scope-OrgID production" in gateway


def test_payment_context_is_persisted_but_not_exposed(tmp_path, spans):
    import sqlite3

    from src.checkout.models import FulfilmentJob, PaymentAttempt
    from src.checkout.service import CheckoutService
    from src.checkout.store import CheckoutStore
    now = datetime.now(UTC)
    attempt = PaymentAttempt(attempt_id="a", transaction_id="t", user_id="u", thread_id="th",
        idempotency_key="i", payload_hash="h", option_version=1, amount_vnd=1, created_at=now, updated_at=now)
    assert attempt.origin_trace_context == {}
    attempt.origin_trace_context = {"traceparent": "00-11111111111111111111111111111111-1111111111111111-01"}
    loaded = PaymentAttempt.model_validate_json(attempt.model_dump_json())
    assert loaded.origin_trace_context == attempt.origin_trace_context
    assert "origin_trace_context" not in CheckoutService.attempt_view(None, loaded)
    path = tmp_path / "checkout.sqlite"
    with sqlite3.connect(path) as connection:
        store = CheckoutStore(connection)
        assert store.insert_attempt(attempt)
        assert store.create_job(FulfilmentJob(job_id="j", transaction_id="t", attempt_id="a", kind="flight_ticket",
            origin_trace_context=attempt.origin_trace_context, created_at=now, updated_at=now))
    connection.close()
    # Reopen durable storage as a restarted worker would.
    with sqlite3.connect(path) as connection:
        store = CheckoutStore(connection)
        job = store.job_for("t")
        assert store.get_attempt("a").origin_trace_context == attempt.origin_trace_context
        with operation("restarted.fulfilment", "job", origin=job.origin_trace_context):
            pass
    connection.close()
    result = spans.get_finished_spans()[-1]
    assert result.parent is None
    assert format(result.links[0].context.trace_id, "032x") == "1" * 32


def test_sqlite_shortcuts_preserve_transactions_and_rows(spans):
    import sqlite3

    from src.observability.sqlite import Connection
    connection = Connection(sqlite3.connect(":memory:"))
    connection.row_factory = sqlite3.Row
    connection.execute("CREATE TABLE sample (value TEXT)")
    with connection as transaction:
        transaction.executemany("INSERT INTO sample VALUES (?)", [("first",), ("second",)])
    with pytest.raises(ValueError), connection as transaction:
        transaction.execute("DELETE FROM sample")
        raise ValueError("rollback")
    assert [row["value"] for row in connection.execute("SELECT value FROM sample")] == ["first", "second"]
    connection.close()
    assert {span.name for span in spans.get_finished_spans()} >= {"db.SELECT", "db.INSERT", "db.DELETE"}
