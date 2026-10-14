"""Exercise the actual OTLP SDK wire format in isolated processes."""

import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest
from google.protobuf.json_format import MessageToDict
from opentelemetry.proto.collector.logs.v1.logs_service_pb2 import ExportLogsServiceRequest
from opentelemetry.proto.collector.metrics.v1.metrics_service_pb2 import ExportMetricsServiceRequest
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest

ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize("domain,tool_name", [("payments", "get_payment"), ("flights", "get_booking")])
def test_python_sdk_auth_and_mcp_stdio_propagation(tmp_path, domain, tool_name):
    received = []
    formats = {"/v1/traces": ExportTraceServiceRequest, "/v1/logs": ExportLogsServiceRequest,
               "/v1/metrics": ExportMetricsServiceRequest}

    class Receiver(BaseHTTPRequestHandler):
        def do_POST(self):
            assert self.headers["Authorization"] == "Bearer fixture-token"
            message = formats[self.path]()
            message.ParseFromString(self.rfile.read(int(self.headers["Content-Length"])))
            received.append((self.path, MessageToDict(message)))
            self.send_response(200)
            self.end_headers()

        def log_message(self, *args):
            pass

    receiver = ThreadingHTTPServer(("127.0.0.1", 0), Receiver)
    worker = threading.Thread(target=receiver.serve_forever, daemon=True)
    worker.start()
    try:
        env = {**os.environ, "OBSERVABILITY_ENABLED": "true",
               "OBSERVABILITY_CONTENT_MODE": "redacted", "OTEL_DEPLOYMENT_ENVIRONMENT": "staging",
               "OTEL_EXPORTER_OTLP_ENDPOINT": f"http://127.0.0.1:{receiver.server_port}",
               "OTEL_EXPORTER_OTLP_HEADERS": "Authorization=Bearer%20fixture-token",
               "PAYMENT_DB_PATH": str(tmp_path / "payments.db"),
               "FLIGHT_DB_PATH": str(tmp_path / "flights.db"), "OBSERVABILITY_FIXTURE_MCP": domain}
        env.pop("PYTHONPATH", None)
        result = subprocess.run([sys.executable, "-m", "tests.observability_process"], cwd=ROOT,
                                env=env, capture_output=True, text=True, timeout=30)
        assert result.returncode == 0, result.stderr
        assert "telemetry_initialization_failed" not in result.stderr
        spans = [span for path, payload in received if path == "/v1/traces"
                 for resource in payload["resourceSpans"] for scope in resource["scopeSpans"] for span in scope["spans"]]
        root = next(span for span in spans if span["name"] == "gateway")
        client = next(span for span in spans if span["name"] == "mcp.client")
        tool = next(span for span in spans if span["name"] == tool_name)
        assert client["traceId"] == tool["traceId"] == root["traceId"]
        assert tool["parentSpanId"] == client["spanId"]
        assert tool["status"]["code"] == "STATUS_CODE_ERROR"
        assert any(span["name"].startswith("db.") for span in spans)
        assert {path for path, _ in received} == set(formats)
        resources = [resource for _, payload in received for groups in payload.values() for resource in groups]
        assert all({attribute["key"]: attribute["value"] for attribute in resource["resource"]["attributes"]}[
            "service.namespace"] == {"stringValue": "relohome"} for resource in resources)
        scopes = [scope for resource in resources for key, groups in resource.items()
                  if key.startswith("scope") for scope in groups]
        assert {scope["scope"]["name"] for scope in scopes} >= {"relohome", "relohome.sqlite"}
        names = {metric["name"] for scope in scopes for metric in scope.get("metrics", [])}
        assert {"relohome.operations", "relohome.heartbeat"} <= names
        assert not any(name.startswith("lifeflow") for name in names)
        assert any(attribute["key"] == "relohome.outcome" for span in spans for attribute in span["attributes"])
    finally:
        receiver.shutdown()
        receiver.server_close()
        worker.join(timeout=5)


@pytest.mark.parametrize("environment,mode", [("staging", None), ("production", "redacted"), ("production", "raw")])
def test_jev_real_otlp_metrics_and_metadata_payload_privacy(tmp_path, environment, mode):
    import json

    received = []
    formats = {"/v1/traces": ExportTraceServiceRequest, "/v1/logs": ExportLogsServiceRequest,
               "/v1/metrics": ExportMetricsServiceRequest}

    class Receiver(BaseHTTPRequestHandler):
        def do_POST(self):
            message = formats[self.path]()
            message.ParseFromString(self.rfile.read(int(self.headers["Content-Length"])))
            received.append((self.path, MessageToDict(message)))
            self.send_response(200)
            self.end_headers()

        def log_message(self, *args):
            pass

    receiver = ThreadingHTTPServer(("127.0.0.1", 0), Receiver)
    worker = threading.Thread(target=receiver.serve_forever, daemon=True)
    worker.start()
    try:
        env = {**os.environ, "OBSERVABILITY_ENABLED": "true", "APP_ENV": environment,
               "OTEL_DEPLOYMENT_ENVIRONMENT": environment,
               "OTEL_EXPORTER_OTLP_ENDPOINT": f"http://127.0.0.1:{receiver.server_port}",
               "OTEL_EXPORTER_OTLP_HEADERS": "Authorization=Bearer%20fixture-token"}
        env.pop("OBSERVABILITY_CONTENT_MODE", None)
        if mode is not None:
            env["OBSERVABILITY_CONTENT_MODE"] = mode
        env.pop("PYTHONPATH", None)
        result = subprocess.run([sys.executable, "-m", "tests.observability_guardrails_process"], cwd=ROOT,
                                env=env, capture_output=True, text=True, timeout=30)
        assert result.returncode == 0, result.stderr
        assert "telemetry_initialization_failed" not in result.stderr
        assert "SYNTHETIC_PRIVATE" not in json.dumps(received)
        metrics = {metric["name"]: metric for path, payload in received if path == "/v1/metrics"
                   for resource in payload["resourceMetrics"] for scope in resource["scopeMetrics"]
                   for metric in scope["metrics"]}
        points = metrics["relohome.guardrail.observations"]["sum"]["dataPoints"]
        counts = {tuple(sorted((attr["key"], attr["value"]["stringValue"]) for attr in point["attributes"])):
                  int(point["asInt"]) for point in points}
        assert counts[(("event", "eligible"), ("point", "plan"))] == 2
        assert counts[(("event", "completed"), ("point", "plan"))] == 1
        assert counts[(("event", "skipped"), ("point", "plan"))] == 1
        # Protobuf JSON omits the default false value.
        assert metrics["relohome.guardrail.in_flight"]["sum"].get("isMonotonic", False) is False
        assert int(metrics["relohome.guardrail.in_flight"]["sum"]["dataPoints"][0]["asInt"]) == 0
        assert "relohome.guardrail.skips" in metrics
        assert "relohome.llm.tokens" in metrics  # Usage survives metadata-only capture.
        spans = [span for path, payload in received if path == "/v1/traces"
                 for resource in payload["resourceSpans"] for scope in resource["scopeSpans"] for span in scope["spans"]]
        assert any(span["name"] == "llm.responses" for span in spans)
    finally:
        receiver.shutdown()
        receiver.server_close()
        worker.join(timeout=5)
