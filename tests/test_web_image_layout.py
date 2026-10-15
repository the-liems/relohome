"""Check image packaging and ownership; executable HTTP smoke runs in CI as well."""

import json
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_combined_web_image_installs_gateway_and_serves_web_dist():
    dockerfile = (ROOT / "apps/web/Dockerfile").read_text()
    assert "COPY apps/browser-gateway/ ./apps/browser-gateway/" in dockerfile
    assert "./packages/python/flight ./apps/browser-gateway" in dockerfile
    assert "-r requirements-observability.txt" in dockerfile
    runtime = dockerfile.split("AS runtime", 1)[1]
    assert "COPY --from=python-build /opt/venv /opt/venv" in runtime
    assert "/web/apps/web/dist ./apps/web/dist" in runtime
    assert '"relohome_gateway.server:app"' in runtime
    assert '"8503", "--workers", "1"' in runtime
    assert "Frontend" not in runtime and "COPY src" not in runtime


def test_web_and_gateway_have_separate_source_ownership():
    metadata = tomllib.loads((ROOT / "apps/browser-gateway/pyproject.toml").read_text())
    assert metadata["project"]["name"] == "relohome-browser-gateway"
    assert metadata["tool"]["setuptools"]["packages"]["find"]["where"] == ["src"]
    assert not list((ROOT / "apps/web").glob("*.py"))
    assert not (ROOT / "apps/web/pyproject.toml").exists()
    assert json.loads((ROOT / "apps/web/package.json").read_text())["name"] == "siu-ai-web"
    assert "ReloHome" in (ROOT / "apps/web/index.html").read_text()
