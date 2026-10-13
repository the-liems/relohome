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
from relohome_observability import current_context, generation, operation, runtime, session
from relohome_observability.asgi import TelemetryMiddleware
from relohome_observability.privacy import content

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
    assert exported["confirmation"].attributes["relohome.outcome"] == "paused"
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
    from relohome_agent.services.adapters.mcp import McpEndpoint, McpToolClient
    from relohome_mcp_http import HttpServiceMCP

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
    assert "url: $DISCORD_WEBHOOK_URL" in alerts
    assert "staging" in path.read_text() and "production" in path.read_text()
    gateway = next(mount["content"] for mount in stack["services"]["telemetry-gateway"]["volumes"] if isinstance(mount, dict))
    assert "X-Scope-OrgID staging" in gateway
    assert "X-Scope-OrgID production" in gateway


def test_payment_context_is_persisted_but_not_exposed(tmp_path, spans):
    import sqlite3

    from relohome_agent.checkout.models import FulfilmentJob, PaymentAttempt
    from relohome_agent.checkout.service import CheckoutService
    from relohome_agent.checkout.store import CheckoutStore
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

    from relohome_observability.sqlite import Connection
    connection = Connection(":memory:")
    connection.row_factory = sqlite3.Row
    connection.execute("CREATE TABLE sample (value TEXT)")
    with operation("database.request"):
        with connection as transaction:
            transaction.executemany("INSERT INTO sample VALUES (?)", [("first",), ("second",)])
        with pytest.raises(ValueError), connection as transaction:
            transaction.execute("DELETE FROM sample")
            raise ValueError("rollback")
        assert [row["value"] for row in connection.execute("SELECT value FROM sample")] == ["first", "second"]
    connection.close()
    assert {span.name for span in spans.get_finished_spans()} >= {"db.SELECT", "db.INSERT", "db.DELETE"}


@pytest.mark.parametrize("remote", [None, {}, {"progressToken": "progress-1"},
                                  {"traceparent": "invalid"}, {"tracestate": "vendor=value"}])
def test_mcp_metadata_without_valid_traceparent_preserves_active_parent(spans, remote):
    with operation("http.request"):
        with operation("mcp.tool", "tool", remote=remote):
            pass
    tool, parent = spans.get_finished_spans()
    assert tool.parent.span_id == parent.context.span_id
    assert tool.context.trace_id == parent.context.trace_id


def test_mcp_valid_remote_context_overrides_active_parent(spans):
    remote = {"traceparent": "00-11111111111111111111111111111111-2222222222222222-01"}
    with operation("unrelated.request"):
        with operation("mcp.tool", "tool", remote=remote):
            pass
    tool, parent = spans.get_finished_spans()
    assert tool.parent.span_id == int("2" * 16, 16)
    assert tool.context.trace_id == int("1" * 32, 16)
    assert tool.context.trace_id != parent.context.trace_id


@pytest.mark.parametrize("level,expected", [(20, "INFO"), (30, "WARN"), (40, "ERROR"), (50, "FATAL")])
def test_logging_handler_preserves_python_severity(monkeypatch, level, expected):
    import logging

    events = []
    monkeypatch.setattr(runtime, "_logger", SimpleNamespace(emit=lambda **event: events.append(event)))
    record = logging.LogRecord("application", level, __file__, 1, "private message", (), None)
    runtime.MetadataLogHandler().emit(record)
    assert events[0]["severity_number"].name == expected
    assert events[0]["severity_text"] == record.levelname
    assert events[0]["body"] == "application.log"
    assert "private message" not in str(events)


@pytest.fixture
def sqlite_instrumentation(monkeypatch):
    import sqlite3

    import aiosqlite
    from relohome_observability import sqlite

    # Restore process-wide wrappers after each test, including the async queue.
    for module in (sqlite3, sqlite3.dbapi2):
        monkeypatch.setattr(module, "connect", module.connect)
    monkeypatch.setattr(aiosqlite.Connection, "_execute", aiosqlite.Connection._execute)
    monkeypatch.setattr(sqlite, "_instrumented", False)
    sqlite.instrument_shortcuts()


def test_sqlite_idle_polls_do_not_export_but_request_queries_do(spans, sqlite_instrumentation):
    import sqlite3

    from relohome_agent.checkout.store import CheckoutStore

    connection = sqlite3.connect(":memory:")
    try:
        store = CheckoutStore(connection)
        assert store.open_attempts() == store.pending_jobs() == []
        assert not spans.get_finished_spans()
        with operation("request"):
            store.open_attempts()
            cursor = connection.cursor()
            assert cursor.execute("SELECT 1") is cursor
            assert cursor.fetchone() == (1,)
            with pytest.raises(sqlite3.OperationalError):
                cursor.execute("SELECT * FROM missing_private_table")
        exported = spans.get_finished_spans()
        parent = exported[-1]
        database = exported[:-1]
        assert len(database) == 3
        assert all(item.name == "db.SELECT" and item.parent.span_id == parent.context.span_id for item in database)
        assert database[-1].status.status_code.name == "ERROR"
        assert "missing_private_table" not in str(database[-1].attributes)
        assert not database[-1].events
    finally:
        connection.close()


@pytest.mark.asyncio
async def test_aiosqlite_queue_preserves_each_concurrent_request_context(spans, sqlite_instrumentation):
    import aiosqlite

    async with aiosqlite.connect(":memory:") as connection:
        await connection.execute("CREATE TABLE sample (value INTEGER)")

        async def request(name):
            with session(name), operation(name):
                await connection.execute("INSERT INTO sample VALUES (1)")
                async with connection.cursor() as cursor:
                    await cursor.execute("SELECT value FROM sample")
                    assert await cursor.fetchone() == (1,)

        await asyncio.gather(request("first"), request("second"))
        count = len(spans.get_finished_spans())
        await connection.execute("SELECT 1")  # Worker context must not leak after either request.
        assert len(spans.get_finished_spans()) == count
    exported = spans.get_finished_spans()
    parents = {item.name: item for item in exported if item.name in {"first", "second"}}
    database = [item for item in exported if item.name.startswith("db.")]
    assert len(database) == 4
    for item in database:
        parent = parents[item.attributes["langfuse.session.id"]]
        assert item.parent.span_id == parent.context.span_id
        assert item.context.trace_id == parent.context.trace_id


def test_sqlite_respects_disabled_and_unsampled_context(spans, sqlite_instrumentation, monkeypatch):
    import sqlite3

    from opentelemetry.instrumentation.utils import suppress_instrumentation

    connection = sqlite3.connect(":memory:")
    try:
        with operation("request"), suppress_instrumentation():
            connection.execute("SELECT 1")
        with operation("unsampled", remote={
            "traceparent": "00-11111111111111111111111111111111-2222222222222222-00",
        }):
            connection.cursor().execute("SELECT 1")
        monkeypatch.setenv("OBSERVABILITY_ENABLED", "false")
        with trace.get_tracer("external").start_as_current_span("external"):
            connection.execute("SELECT 1")
        assert [item.name for item in spans.get_finished_spans()] == ["request", "external"]
    finally:
        connection.close()


@pytest.mark.asyncio
async def test_metric_instruments_are_created_once_for_repeated_requests(spans, monkeypatch):
    from collections import Counter

    created, records = Counter(), []

    def instrument(name, **kwargs):
        created[name] += 1
        return SimpleNamespace(add=lambda value, labels: records.append((name, value)),
                               record=lambda value, labels: records.append((name, value)))

    meter = SimpleNamespace(create_counter=instrument, create_histogram=instrument)

    class Provider:
        def get_meter(self, name):
            return meter

    provider = Provider()
    monkeypatch.setattr(runtime.metrics, "get_meter_provider", lambda: provider)
    runtime._instruments.cache_clear()
    try:
        for _ in range(3):
            with operation("request"):
                pass
        assert len(created) == 6
        assert set(created.values()) == {1}
        assert records.count(("relohome.operations", 1)) == 3
        provider = Provider()
        with operation("replacement.provider"):
            pass
        assert set(created.values()) == {2}
    finally:
        runtime._instruments.cache_clear()


@pytest.mark.asyncio
async def test_disabled_operations_and_generation_do_not_create_instruments(monkeypatch):
    monkeypatch.setenv("OBSERVABILITY_ENABLED", "false")

    def unexpected():
        raise AssertionError("Disabled telemetry must not create metric instruments")

    monkeypatch.setattr(runtime, "instruments", unexpected)
    reply = SimpleNamespace(usage=SimpleNamespace(input_tokens=1, output_tokens=2), output=[])

    async def call(**kwargs):
        return reply

    with operation("disabled"):
        assert await generation(call, provider="test", model="test") is reply


def test_observability_compatibility_imports_share_runtime_state():
    import importlib

    for suffix in ("", ".runtime", ".privacy", ".sqlite", ".asgi"):
        assert importlib.import_module("src.observability" + suffix) is importlib.import_module(
            "relohome_observability" + suffix)


@pytest.mark.parametrize("raw_source,raw_target", [(True, False), (False, True), (False, False)])
def test_sqlite_backups_accept_native_and_instrumented_connections(spans, sqlite_instrumentation,
                                                                  raw_source, raw_target):
    import sqlite3

    source = (sqlite3.Connection if raw_source else sqlite3.connect)(":memory:")
    target = (sqlite3.Connection if raw_target else sqlite3.connect)(":memory:")
    try:
        source.execute("CREATE TABLE sample (value TEXT)")
        source.execute("INSERT INTO sample VALUES ('preserved')")
        source.commit()
        source.backup(target)
        assert target.execute("SELECT value FROM sample").fetchall() == [("preserved",)]
        assert source.cursor().connection is source
        assert target.cursor().connection is target
    finally:
        source.close()
        target.close()


def test_sqlite_preserves_application_factories_and_instruments_explicit_default(spans, sqlite_instrumentation):
    import sqlite3

    class CustomConnection(sqlite3.Connection):
        pass

    class CustomCursor(sqlite3.Cursor):
        pass

    with sqlite3.connect(":memory:", factory=CustomConnection) as custom:
        assert type(custom) is CustomConnection
        assert type(custom.cursor(factory=CustomCursor)) is CustomCursor
    custom.close()
    # The legacy positional factory argument remains supported, too.
    connection = sqlite3.dbapi2.connect(":memory:", 5.0, 0, "", True, sqlite3.Connection)
    try:
        with operation("request"):
            assert connection.execute("SELECT 1").fetchone() == (1,)
        assert [item.name for item in spans.get_finished_spans()] == ["db.SELECT", "request"]
    finally:
        connection.close()
