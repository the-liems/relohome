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
CLI = str(Path(sys.executable).with_name("opentelemetry-instrument.exe" if os.name == "nt" else "opentelemetry-instrument"))


@pytest.mark.parametrize("conventions", ["", "http"])
def test_official_framework_otlp_chain_has_errors_and_metrics(conventions):
    import base64
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
        env = {**os.environ, "OTEL_EXPORTER_OTLP_PROTOCOL": "http/protobuf",
               "OTEL_PYTHON_DISABLED_INSTRUMENTATIONS": "sqlite3", "OTEL_PROPAGATORS": "tracecontext",
               "OTEL_PYTHON_EXCLUDED_URLS": r"/(healthz?|readyz?|metrics)(\?.*)?$|/(assets|images)/",
               "OTEL_RESOURCE_ATTRIBUTES": "service.namespace=relohome",
               "OBSERVABILITY_CONTENT_MODE": "metadata",
               "APP_ENV": "production", "OTEL_DEPLOYMENT_ENVIRONMENT": "production",
               "RELOHOME_RUNTIME_ROOT": str(ROOT), "OTEL_SERVICE_NAME": "framework-fixture",
               "OTEL_SEMCONV_STABILITY_OPT_IN": conventions,
               "OTEL_EXPORTER_OTLP_ENDPOINT": f"http://127.0.0.1:{receiver.server_port}",
               "OTEL_EXPORTER_OTLP_HEADERS": ""}
        result = subprocess.run([CLI, sys.executable, "-m", "tests.observability_framework_process"], cwd=ROOT,
                                env=env, capture_output=True, text=True, timeout=30)
        assert result.returncode == 0, result.stderr
        assert "telemetry_initialization_failed" not in result.stderr
        cases = json.loads(result.stdout)
        assert cases["forward"]["status"] == 200
        assert cases["failure"]["status"] == 500
        assert cases["unknown"]["status"] == 404
        assert cases["starlette_failure"]["status"] == 500
        assert cases["intake"]["status"] == cases["orchestrator"]["status"] == 503
        assert all(case["trace_id"] != "1" * 32 for case in cases.values())
        spans = [span for path, payload in received if path == "/v1/traces"
                 for resource in payload["resourceSpans"] for scope in resource["scopeSpans"] for span in scope["spans"]]
        chain = [span for span in spans if base64.b64decode(span["traceId"]).hex() == cases["forward"]["trace_id"]
                 and span["kind"] in ("SPAN_KIND_SERVER", "SPAN_KIND_CLIENT")]
        assert len(chain) == 3  # One FastAPI server, one HTTPX client, one Starlette server.
        caller = next(span for span in chain if span["name"] == "GET /forward")
        downstream = next(span for span in chain if span["name"] == "GET /records/{record_id}")
        outbound = next(span for span in chain if span["kind"] == "SPAN_KIND_CLIENT")
        assert outbound["parentSpanId"] == caller["spanId"]
        assert downstream["parentSpanId"] == outbound["spanId"]
        scopes = {scope["scope"]["name"] for path, payload in received if path == "/v1/traces"
                  for resource in payload["resourceSpans"] for scope in resource["scopeSpans"]}
        assert scopes >= {"opentelemetry.instrumentation.fastapi", "opentelemetry.instrumentation.starlette",
                          "opentelemetry.instrumentation.httpx"}
        unknown = next(span for span in spans
                       if base64.b64decode(span["traceId"]).hex() == cases["unknown"]["trace_id"]
                       and span["kind"] == "SPAN_KIND_SERVER")
        assert unknown["name"] == "GET"
        failure = next(span for span in spans
                       if base64.b64decode(span["traceId"]).hex() == cases["failure"]["trace_id"]
                       and span["kind"] == "SPAN_KIND_SERVER")
        assert any(event["name"] == "exception" for event in failure.get("events", []))
        downstream_failure = next(span for span in spans if span["name"] == "GET /broken")
        assert any(event["name"] == "exception" for event in downstream_failure.get("events", []))
        for name in ("intake", "orchestrator"):
            standalone = next(span for span in spans
                              if base64.b64decode(span["traceId"]).hex() == cases[name]["trace_id"]
                              and span["kind"] == "SPAN_KIND_SERVER")
            assert any(item["key"] == "app.error.code" and item["value"]["stringValue"] == "missing_service_token"
                       for item in standalone["attributes"])
        metric_names = {metric["name"] for path, payload in received if path == "/v1/metrics"
                        for resource in payload["resourceMetrics"] for scope in resource["scopeMetrics"]
                        for metric in scope["metrics"]}
        assert any(name.startswith("http.server.") for name in metric_names)
    finally:
        receiver.shutdown()
        receiver.server_close()
        worker.join(timeout=5)


@pytest.mark.parametrize("environment,conventions", [("staging", ""), ("production", ""), ("production", "http")])
def test_http_error_causes_and_log_correlation_survive_real_otlp(environment, conventions):
    import base64
    import json

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
        env = {**os.environ, "OTEL_EXPORTER_OTLP_PROTOCOL": "http/protobuf",
               "OTEL_PYTHON_DISABLED_INSTRUMENTATIONS": "sqlite3", "OTEL_PROPAGATORS": "tracecontext",
               "OTEL_PYTHON_EXCLUDED_URLS": r"/(healthz?|readyz?|metrics)(\?.*)?$|/(assets|images)/",
               "OTEL_RESOURCE_ATTRIBUTES": "service.namespace=relohome",
               "OBSERVABILITY_CONTENT_MODE": "metadata",
               "APP_ENV": environment, "OTEL_DEPLOYMENT_ENVIRONMENT": environment,
               "RELOHOME_RUNTIME_ROOT": str(ROOT), "OTEL_SERVICE_NAME": "http-errors-fixture",
               "OTEL_EXPORTER_OTLP_ENDPOINT": f"http://127.0.0.1:{receiver.server_port}",
               "OTEL_EXPORTER_OTLP_HEADERS": "Authorization=Bearer%20fixture-token"}
        env.pop("PYTHONPATH", None)
        # Exercise both legacy exception events and stable HTTP conventions.
        env["OTEL_SEMCONV_STABILITY_OPT_IN"] = conventions
        result = subprocess.run([CLI, sys.executable, "-m", "tests.observability_http_errors_process"], cwd=ROOT,
                                env=env, capture_output=True, text=True, timeout=30)
        assert result.returncode == 0, result.stderr
        assert "telemetry_initialization_failed" not in result.stderr
        cases = json.loads(result.stdout)
        spans = [span for path, payload in received if path == "/v1/traces"
                 for resource in payload["resourceSpans"] for scope in resource["scopeSpans"] for span in scope["spans"]]
        logs = [record for path, payload in received if path == "/v1/logs"
                for resource in payload["resourceLogs"] for scope in resource["scopeLogs"] for record in scope["logRecords"]]

        def attributes(record):
            return {item["key"]: int(item["value"]["intValue"]) if "intValue" in item["value"]
                    else next(iter(item["value"].values())) for item in record.get("attributes", [])}

        def trace_id(record):
            return base64.b64decode(record.get("traceId", "")).hex()

        for name, reason in (
            ("missing_token", "missing_agent_api_token"),
            ("invalid_json", "upstream_invalid_json"),
            ("missing_runtime", "agent_runtime_not_started"),
            ("missing_backend_token", "missing_agent_api_token"),
        ):
            case_trace = cases[name]["trace_id"]
            matching = [span for span in spans if trace_id(span) == case_trace]
            servers = [span for span in matching if span["kind"] == "SPAN_KIND_SERVER"]
            assert len(servers) == 1
            assert not any("http.method" in attributes(span) or "http.request.method" in attributes(span)
                           for span in matching if span["kind"] == "SPAN_KIND_CLIENT")
            span = servers[0]
            assert span["status"]["code"] == "STATUS_CODE_ERROR"
            assert attributes(span)["app.error.code"] == reason
            assert attributes(span).get("http.response.status_code", attributes(span).get("http.status_code")) == cases[name]["status"]
            correlated = [record for record in logs if trace_id(record) == case_trace
                          and attributes(record).get("error_type") == reason]
            assert len(correlated) == 1
            assert correlated[0]["spanId"] == span["spanId"]

        matching = [span for span in spans if trace_id(span) == cases["connection_error"]["trace_id"]]
        server = next(span for span in matching if span["kind"] == "SPAN_KIND_SERVER")
        client = next(span for span in matching if span["kind"] == "SPAN_KIND_CLIENT"
                      and span.get("events"))
        assert cases["connection_error"]["status"] == 502
        assert any(item["key"] == "exception.type" and item["value"]["stringValue"].endswith("ConnectError")
                   for event in client["events"] for item in event.get("attributes", []))
        assert client["parentSpanId"] == server["spanId"]
    finally:
        receiver.shutdown()
        receiver.server_close()
        worker.join(timeout=5)


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
        env = {**os.environ, "OTEL_EXPORTER_OTLP_PROTOCOL": "http/protobuf",
               "OTEL_PYTHON_DISABLED_INSTRUMENTATIONS": "sqlite3", "OTEL_PROPAGATORS": "tracecontext",
               "OTEL_PYTHON_EXCLUDED_URLS": r"/(healthz?|readyz?|metrics)(\?.*)?$|/(assets|images)/",
               "OTEL_RESOURCE_ATTRIBUTES": "service.namespace=relohome",
               "OBSERVABILITY_CONTENT_MODE": "redacted", "OTEL_DEPLOYMENT_ENVIRONMENT": "staging",
               "OTEL_EXPORTER_OTLP_ENDPOINT": f"http://127.0.0.1:{receiver.server_port}",
               "OTEL_EXPORTER_OTLP_HEADERS": "Authorization=Bearer%20fixture-token",
               "PAYMENT_DB_PATH": str(tmp_path / "payments.db"),
               "FLIGHT_DB_PATH": str(tmp_path / "flights.db"), "OBSERVABILITY_FIXTURE_MCP": domain}
        env.pop("PYTHONPATH", None)
        result = subprocess.run([CLI, sys.executable, "-m", "tests.observability_process"], cwd=ROOT,
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
        assert any(item["key"] == "db.system" and item["value"]["stringValue"] == "sqlite"
                   for span in spans for item in span.get("attributes", []))
        assert {path for path, _ in received} == set(formats)
        resources = [resource for _, payload in received for groups in payload.values() for resource in groups]
        assert all({attribute["key"]: attribute["value"] for attribute in resource["resource"]["attributes"]}[
            "service.namespace"] == {"stringValue": "relohome"} for resource in resources)
        scopes = [scope for resource in resources for key, groups in resource.items()
                  if key.startswith("scope") for scope in groups]
        assert {scope["scope"]["name"] for scope in scopes} >= {"relohome", "opentelemetry.instrumentation.sqlite3"}
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
        env = {**os.environ, "OTEL_EXPORTER_OTLP_PROTOCOL": "http/protobuf",
               "OTEL_PYTHON_DISABLED_INSTRUMENTATIONS": "sqlite3", "OTEL_PROPAGATORS": "tracecontext",
               "OTEL_PYTHON_EXCLUDED_URLS": r"/(healthz?|readyz?|metrics)(\?.*)?$|/(assets|images)/",
               "OTEL_RESOURCE_ATTRIBUTES": "service.namespace=relohome",
               "APP_ENV": environment,
               "OTEL_DEPLOYMENT_ENVIRONMENT": environment,
               "OTEL_EXPORTER_OTLP_ENDPOINT": f"http://127.0.0.1:{receiver.server_port}",
               "OTEL_EXPORTER_OTLP_HEADERS": "Authorization=Bearer%20fixture-token"}
        env.pop("OBSERVABILITY_CONTENT_MODE", None)
        if mode is not None:
            env["OBSERVABILITY_CONTENT_MODE"] = mode
        env.pop("PYTHONPATH", None)
        result = subprocess.run([CLI, sys.executable, "-m", "tests.observability_guardrails_process"], cwd=ROOT,
                                env=env, capture_output=True, text=True, timeout=30)
        assert result.returncode == 0, result.stderr
        assert "telemetry_initialization_failed" not in result.stderr
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
