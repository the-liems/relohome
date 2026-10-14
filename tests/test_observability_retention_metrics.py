"""Environment-scoped scrape paths must not expose the other project's state."""

import importlib.util
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import urlopen

import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("retention_metrics_test", ROOT / "deploy/observability/retention.py")
retention = importlib.util.module_from_spec(spec)
spec.loader.exec_module(retention)


@pytest.fixture
def metrics_server(monkeypatch):
    monkeypatch.setattr(retention, "STATE", {
        "staging": {"last_run_success": 1, "last_success_timestamp_seconds": 100},
        "production": {"last_run_success": 0, "last_success_timestamp_seconds": 200},
    })
    server = ThreadingHTTPServer(("127.0.0.1", 0), retention.MetricsHandler)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()
        server.server_close()
        worker.join(timeout=5)


@pytest.mark.parametrize("environment", ["staging", "production"])
def test_tenant_scrape_only_contains_its_retention_state(metrics_server, environment):
    with urlopen(metrics_server + "/metrics/" + environment, timeout=5) as response:
        lines = response.read().decode().splitlines()
        assert response.headers["Content-Type"] == "text/plain; version=0.0.4"
    expected = retention.STATE[environment]
    samples = {line for line in lines if not line.startswith("#")}
    assert samples == {f'relohome_retention_{metric}{{environment="{environment}"}} {value}'
                       for metric, value in expected.items()}
    assert all(f"# TYPE relohome_retention_{metric} gauge" in lines for metric in expected)


def test_private_unfiltered_metrics_and_missing_environment(metrics_server, monkeypatch):
    with urlopen(metrics_server + "/metrics", timeout=5) as response:
        payload = response.read().decode()
    assert 'environment="staging"' in payload and 'environment="production"' in payload
    monkeypatch.setattr(retention, "STATE", {"staging": {"last_run_success": 1}})
    with urlopen(metrics_server + "/metrics/production", timeout=5) as response:
        assert all(line.startswith("#") for line in response.read().decode().splitlines() if line)


@pytest.mark.parametrize("path", ["/metrics/unknown", "/metrics/staging?environment=production", "/"])
def test_only_explicit_metrics_paths_are_accepted(metrics_server, path):
    with pytest.raises(HTTPError) as error:
        urlopen(metrics_server + path, timeout=5)
    assert error.value.code == 404
