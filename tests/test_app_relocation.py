"""Physical app moves preserve installed imports, packaged fixtures and runtime paths."""

import json
import os
import subprocess
import sys
from importlib.resources import files
from pathlib import Path

import pytest
from relohome_agent.runtime_paths import runtime_path
from relohome_agent.services.adapters.sqlite_runtime import RuntimeDatabase

ROOT = Path(__file__).resolve().parents[1]
APPLICATIONS = {
    "relohome_agent": "apps/agent-api/src/relohome_agent",
    "relohome_flights_mcp": "apps/flights-mcp/src/relohome_flights_mcp",
    "relohome_payments_mcp": "apps/payments-mcp/src/relohome_payments_mcp",
}


@pytest.mark.parametrize("namespace,source", APPLICATIONS.items())
def test_reinstalled_editable_origin_outside_checkout(namespace, source, tmp_path):
    # Isolated mode ignores cwd/PYTHONPATH: a stale editable mapping cannot hide a deleted shim.
    code = "import importlib, sys; print(importlib.import_module(sys.argv[1]).__file__)"
    result = subprocess.run(
        [sys.executable, "-I", "-c", code, namespace],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert Path(result.stdout.strip()).resolve() == ROOT / source / "__init__.py"


def test_all_subagent_fixtures_are_package_resources():
    fixtures = files("relohome_agent.agents.subagents") / "fixtures"
    assert {p.name for p in fixtures.iterdir()} == {
        "flight.json",
        "map.json",
        "payment.json",
        "property.json",
        "relocation.json",
        "roommate.json",
    }
    for fixture in fixtures.iterdir():
        assert json.loads(fixture.read_text())


def test_default_runtime_store_and_key_stay_under_configured_root(monkeypatch, tmp_path):
    root, elsewhere = tmp_path / "deployment", tmp_path / "elsewhere"
    elsewhere.mkdir()
    monkeypatch.setenv("RELOHOME_RUNTIME_ROOT", str(root))
    monkeypatch.chdir(elsewhere)
    db = RuntimeDatabase("data/agent-runtime")
    db.close()
    directory = root / "data/agent-runtime"
    assert (directory / "runtime.sqlite3").is_file()
    assert (directory / "pii.key").stat().st_mode & 0o777 == 0o600
    assert runtime_path("data/agent-runtime/checkpoints.sqlite3") == directory / "checkpoints.sqlite3"
    assert not (elsewhere / "data").exists()


def test_schema_export_from_outside_checkout_keeps_contract_destination(tmp_path):
    root, elsewhere = tmp_path / "deployment", tmp_path / "elsewhere"
    elsewhere.mkdir()
    result = subprocess.run(
        [sys.executable, "-I", "-m", "relohome_agent.agents.contracts.export_schema"],
        cwd=elsewhere,
        env={**os.environ, "RELOHOME_RUNTIME_ROOT": str(root)},
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    outputs = root / "docs/api/agent-contract"
    for model in ("AgentManifest", "AgentTaskRequest", "AgentTaskResult"):
        assert json.loads((outputs / f"{model}.schema.json").read_text())["title"] == model
    assert not (elsewhere / "docs").exists()
