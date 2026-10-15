import asyncio
import json
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace

import pytest
from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from relohome_observability import current_context, generation, operation, runtime, session
from relohome_observability.privacy import content

from tests.mcp_http import running_mcp

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def spans(monkeypatch):
    monkeypatch.setenv("OBSERVABILITY_CONTENT_MODE", "redacted")
    exporter = InMemorySpanExporter()
    provider = TracerProvider(resource=Resource({"service.name": "test"}))
    provider.add_span_processor(SimpleSpanProcessor(exporter))
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
    monkeypatch.setattr(trace, "_TRACER_PROVIDER", trace.NoOpTracerProvider())

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
        assert len(created) == 4
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
    monkeypatch.setattr(trace, "_TRACER_PROVIDER", trace.NoOpTracerProvider())

    def unexpected():
        raise AssertionError("Disabled telemetry must not create metric instruments")

    monkeypatch.setattr(runtime, "instruments", unexpected)
    reply = SimpleNamespace(usage=SimpleNamespace(input_tokens=1, output_tokens=2), output=[])

    async def call(**kwargs):
        return reply

    with operation("disabled"):
        assert await generation(call, provider="test", model="test") is reply
