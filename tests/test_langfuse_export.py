"""Verify actual Langfuse spans through OTLP, without paid model/API calls."""

import gzip
import json
import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from google.protobuf.json_format import MessageToDict
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest

ROOT = Path(__file__).resolve().parents[1]


def test_preview_metadata_is_scoped_to_valid_preview_hosts(monkeypatch):
    from relohome_agent.agents.telemetry import preview_metadata

    monkeypatch.setenv('OTEL_DEPLOYMENT_ENVIRONMENT', 'preview')
    monkeypatch.setenv('PREVIEW_HOSTNAME', 'pr-200.c4-app-044.io.vn')
    monkeypatch.setenv('RELEASE_SHA', 'a' * 40)
    assert preview_metadata() == {
        'preview.id': '200', 'preview.hostname': 'pr-200.c4-app-044.io.vn', 'service.version': 'a' * 40,
    }
    monkeypatch.setenv('OTEL_DEPLOYMENT_ENVIRONMENT', 'staging')
    assert preview_metadata() == {}
    monkeypatch.setenv('OTEL_DEPLOYMENT_ENVIRONMENT', 'preview')
    monkeypatch.setenv('PREVIEW_HOSTNAME', 'pr-321.previews.example.net')
    assert preview_metadata()['preview.id'] == '321'
    for hostname in ('', 'unexpected.example.net', 'pr-nope.example.net', 'https://pr-200.example.net', 'pr-200.example.net/path'):
        monkeypatch.setenv('PREVIEW_HOSTNAME', hostname)
        assert preview_metadata() == {}


def test_langgraph_and_openai_export_connected_generations():
    unexpected_paths = []
    received = {"/v1/traces": [], "/api/public/otel/v1/traces": []}

    class Receiver(BaseHTTPRequestHandler):
        def do_POST(self):
            message = ExportTraceServiceRequest()
            body = self.rfile.read(int(self.headers["Content-Length"]))
            if self.headers.get("Content-Encoding") == "gzip":
                body = gzip.decompress(body)
            if self.path not in received:
                unexpected_paths.append(self.path)
                self.send_response(404)
                self.end_headers()
                return
            message.ParseFromString(body)
            received[self.path].append(MessageToDict(message))
            self.send_response(200)
            self.end_headers()

        def log_message(self, *args):
            pass

    receiver = ThreadingHTTPServer(("127.0.0.1", 0), Receiver)
    worker = threading.Thread(target=receiver.serve_forever, daemon=True)
    worker.start()
    try:
        env = {
            **os.environ,
            "LANGFUSE_PUBLIC_KEY": "pk-lf-fixture",
            "LANGFUSE_SECRET_KEY": "sk-lf-fixture",
            "LANGFUSE_BASE_URL": f"http://127.0.0.1:{receiver.server_port}",
            "LANGFUSE_TRACING_ENVIRONMENT": "test",
            "LANGFUSE_MEDIA_UPLOAD_ENABLED": "false",
            "OTEL_SDK_DISABLED": "false",
            "OTEL_EXPORTER_OTLP_HEADERS": "",
            "OTEL_EXPORTER_OTLP_ENDPOINT": f"http://127.0.0.1:{receiver.server_port}",
            "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT": f"http://127.0.0.1:{receiver.server_port}/v1/traces",
            "OTEL_EXPORTER_OTLP_TRACES_HEADERS": "",
            "OTEL_EXPORTER_OTLP_COMPRESSION": "none",
        }
        env.pop("LANGFUSE_OTEL_TRACES_EXPORT_PATH", None)
        env.pop("LANGFUSE_TRACING_ENABLED", None)  # The SDK defaults to enabled.
        result = subprocess.run(
            [sys.executable, "-m", "tests.langfuse_process"],
            cwd=ROOT,
            env=env,
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert result.returncode == 0, result.stderr
        assert not unexpected_paths, f"Unexpected export paths: {unexpected_paths}"
        spans = [
            span
            for payload in received["/v1/traces"]
            for resource in payload["resourceSpans"]
            for scope in resource["scopeSpans"]
            for span in scope["spans"]
        ]
        assert len({s["spanId"] for s in spans}) == len(spans), "duplicate exports"

        def attrs(s):
            return {a["key"]: next(iter(a["value"].values())) for a in s.get("attributes", [])}

        langfuse_spans = [
            span
            for payload in received["/api/public/otel/v1/traces"]
            for resource in payload["resourceSpans"]
            for scope in resource["scopeSpans"]
            for span in scope["spans"]
        ]
        assert langfuse_spans
        assert len({s["spanId"] for s in langfuse_spans}) == len(langfuse_spans)
        assert all(s["name"] not in {"session-success", "session-failure"} for s in langfuse_spans)
        expected = {s["spanId"] for s in spans if s["name"] not in {"session-success", "session-failure"}}
        assert {s["spanId"] for s in langfuse_spans} == expected
        by_id = {s["spanId"]: s for s in spans}
        for span in langfuse_spans:
            copy = by_id[span["spanId"]]
            assert copy["traceId"] == span["traceId"]
            assert copy.get("parentSpanId") == span.get("parentSpanId")
            assert copy.get("attributes") == span.get("attributes")
            assert attrs(span)["langfuse.environment"] == "test"

        generations = [s for s in spans if attrs(s).get("langfuse.observation.type") == "generation"]
        assert len(generations) == 3, [(s["name"], attrs(s)) for s in spans]
        success = next(s for s in spans if s["name"] == "session-success")
        failure = next(s for s in spans if s["name"] == "session-failure")
        assert success["traceId"] != failure["traceId"]
        by_id = {s["spanId"]: s for s in spans}
        for generation in generations:
            assert generation["traceId"] in {success["traceId"], failure["traceId"]}
            parent = by_id[generation["parentSpanId"]]
            assert parent["name"] == "model"
            assert parent["traceId"] == generation["traceId"]
        successful = [s for s in generations if s["traceId"] == success["traceId"]]
        for generation in successful:
            a = attrs(generation)
            assert a["langfuse.observation.model.name"] == "gpt-4.1-mini"
            usage = json.loads(a["langfuse.observation.usage_details"])
            assert usage["input_tokens"] == 20 and usage["output_tokens"] == 5
            assert usage["input_tokens_details"]["cached_tokens"] == 4
            assert json.loads(a["langfuse.observation.cost_details"])["total"] == 0.001
            assert "fixture answer" in a["langfuse.observation.output"]
        assert any("Fixture system prompt" in attrs(s).get("langfuse.observation.input", "") for s in successful)
        assert any(
            s.get("status", {}).get("code") == "STATUS_CODE_ERROR"
            or attrs(s).get("langfuse.observation.level") == "ERROR"
            for s in generations
            if s["traceId"] == failure["traceId"]
        )
        assert any(attrs(s).get("session.id") == "session-success" for s in spans)
    finally:
        receiver.shutdown()
        receiver.server_close()
        worker.join(timeout=5)


def test_unconfigured_and_disabled_sdk_keeps_model_calls_working():
    # Exercise the real official integrations, rather than checking our own flags.
    code = """
import asyncio
import httpx
from langfuse import get_client
from langfuse.openai import AsyncOpenAI
from relohome_agent.agents.telemetry import graph_callbacks
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
provider = TracerProvider()
exporter = InMemorySpanExporter()
provider.add_span_processor(SimpleSpanProcessor(exporter))
trace.set_tracer_provider(provider)
from langgraph.graph import StateGraph, START, END
async def main():
    def respond(request):
        return httpx.Response(200, json={"id":"fixture", "object":"response", "created_at":1,
            "status":"completed", "model":"gpt-4.1-mini", "output":[]})
    client = AsyncOpenAI(api_key="fixture", max_retries=0,
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(respond)))
    async def model(state):
        result = await client.responses.create(model="gpt-4.1-mini", input="fixture")
        assert result.status == "completed"
        return {"ok": True}
    graph = StateGraph(dict)
    graph.add_node("model", model)
    graph.add_edge(START, "model")
    graph.add_edge("model", END)
    result = await graph.compile().ainvoke({}, {"callbacks": graph_callbacks()})
    assert result["ok"]
    await client.close()
asyncio.run(main())
with get_client().start_as_current_observation(name="disabled-check"):
    assert not trace.get_current_span().is_recording()
assert not exporter.get_finished_spans()
"""
    for missing_key in ("LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY", None):
        env = {
            **os.environ,
            "LANGFUSE_PUBLIC_KEY": "pk-fixture",
            "LANGFUSE_SECRET_KEY": "sk-fixture",
            "LANGFUSE_BASE_URL": "http://127.0.0.1:1",
            "LANGFUSE_TRACING_ENABLED": "true" if missing_key else "false",
            "LANGFUSE_MEDIA_UPLOAD_ENABLED": "false",
        }
        if missing_key:
            env.pop(missing_key)
        result = subprocess.run(
            [sys.executable, "-c", code], cwd=ROOT, env=env, capture_output=True, text=True, timeout=15
        )
        assert result.returncode == 0, result.stderr
        assert "Failed to export" not in result.stderr


def test_disabled_graph_tracing_avoids_handler_creation(monkeypatch):
    from relohome_agent.agents import telemetry

    def unexpected_handler():
        raise AssertionError("Disabled graph tracing must not construct a handler")

    monkeypatch.setattr(telemetry, "CallbackHandler", unexpected_handler)
    monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "pk-fixture")
    monkeypatch.setenv("LANGFUSE_SECRET_KEY", "sk-fixture")
    monkeypatch.setenv("LANGFUSE_TRACING_ENABLED", "false")
    assert telemetry.graph_callbacks() == []
    monkeypatch.setenv("LANGFUSE_TRACING_ENABLED", "true")
    monkeypatch.setenv("OTEL_SDK_DISABLED", "true")
    assert telemetry.graph_callbacks() == []
    monkeypatch.setenv("OTEL_SDK_DISABLED", "false")
    monkeypatch.delenv("LANGFUSE_PUBLIC_KEY")
    assert telemetry.graph_callbacks() == []
