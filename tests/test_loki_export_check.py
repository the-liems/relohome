"""The delivery probe must verify readback, not just Collector acceptance."""

import importlib.util
import io
import json
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest


@pytest.mark.parametrize("label", ["deployment_environment_name", "environment"])
@pytest.mark.parametrize("outcome", ["sanitized", "rejected", "missing", "wrong_trace"])
def test_delivery_check(monkeypatch, capsys, label, outcome):
    path = Path(__file__).resolve().parents[1] / "scripts/check-loki-export.py"
    spec = importlib.util.spec_from_file_location("loki_check", path)
    probe = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(probe)
    monkeypatch.setattr(sys, "argv", [str(path), "--collector", "http://collector:4318",
                                    "--loki", "http://loki:3100", "--environment", "staging",
                                    "--environment-label", label, "--timeout", "1"])
    clock = iter([0, 0, 2])
    monkeypatch.setattr(probe.time, "monotonic", lambda: next(clock))
    monkeypatch.setattr(probe.time, "sleep", lambda _: None)
    sent = {}

    def receiver(request, timeout):
        if not isinstance(request, str):
            payload = json.loads(request.data)
            resource = payload["resourceLogs"][0]
            assert resource["resource"]["attributes"] == [
                {"key": "service.name", "value": {"stringValue": "logging-smoke"}}]
            sent["trace"] = resource["scopeLogs"][0]["logRecords"][0]["traceId"]
            response = {"partialSuccess": {"rejectedLogRecords": "1"}} if outcome == "rejected" else {}
        else:
            query = parse_qs(urlparse(request).query)["query"][0]
            assert f'{label}="staging"' in query
            assert sent["trace"] in query
            trace = "0" * 32 if outcome == "wrong_trace" else sent["trace"]
            rows = [] if outcome == "missing" else [
                {"stream": {"trace_id": trace}, "values": [["1", "application.log"]]}]
            response = {"status": "success", "data": {"result": rows}}
        return io.BytesIO(json.dumps(response).encode())

    monkeypatch.setattr(probe, "urlopen", receiver)
    assert probe.main() == (0 if outcome == "sanitized" else 1)
    output = capsys.readouterr().out
    assert ("PASS:" in output) == (outcome == "sanitized")
