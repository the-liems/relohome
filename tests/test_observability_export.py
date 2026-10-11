"""Exercise the actual OTLP SDK wire format in isolated processes."""

import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from google.protobuf.json_format import MessageToDict
from opentelemetry.proto.collector.logs.v1.logs_service_pb2 import ExportLogsServiceRequest
from opentelemetry.proto.collector.metrics.v1.metrics_service_pb2 import ExportMetricsServiceRequest
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest

ROOT = Path(__file__).resolve().parents[1]


def test_python_sdk_auth_and_payment_stdio_propagation(tmp_path):
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
        env = {**os.environ, "PYTHONPATH": str(ROOT), "OBSERVABILITY_ENABLED": "true",
               "OBSERVABILITY_CONTENT_MODE": "redacted", "OTEL_DEPLOYMENT_ENVIRONMENT": "staging",
               "OTEL_EXPORTER_OTLP_ENDPOINT": f"http://127.0.0.1:{receiver.server_port}",
               "OTEL_EXPORTER_OTLP_HEADERS": "Authorization=Bearer%20fixture-token",
               "PAYMENT_DB_PATH": str(tmp_path / "payments.db")}
        result = subprocess.run([sys.executable, "-m", "tests.observability_process"], cwd=ROOT,
                                env=env, capture_output=True, text=True, timeout=30)
        assert result.returncode == 0, result.stderr
        assert "telemetry_initialization_failed" not in result.stderr
        spans = [span for path, payload in received if path == "/v1/traces"
                 for resource in payload["resourceSpans"] for scope in resource["scopeSpans"] for span in scope["spans"]]
        root = next(span for span in spans if span["name"] == "gateway")
        client = next(span for span in spans if span["name"] == "payment.client")
        tool = next(span for span in spans if span["name"] == "get_payment")
        assert client["traceId"] == tool["traceId"] == root["traceId"]
        assert tool["parentSpanId"] == client["spanId"]
        assert tool["status"]["code"] == "STATUS_CODE_ERROR"
        assert any(span["name"].startswith("db.") for span in spans)
        assert {path for path, _ in received} == set(formats)
    finally:
        receiver.shutdown()
        receiver.server_close()
        worker.join(timeout=5)
