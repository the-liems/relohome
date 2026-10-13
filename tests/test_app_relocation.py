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
LEGACY = {
    "relohome_agent": "src",
    "relohome_flights_mcp": "src/mcp_servers/flights",
    "relohome_payments_mcp": "src/mcp_servers/payments",
    "relohome_intake": "src/agent_services/intake",
    "relohome_orchestrator": "src/agent_services/orchestrator",
}


@pytest.mark.parametrize("namespace,legacy", LEGACY.items())
def test_stale_editable_install_requires_reinstall(namespace, legacy, tmp_path):
    code = """
import importlib
import importlib.abc
import importlib.util
import sys
from pathlib import Path

class StaleFinder(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname == sys.argv[1]:
            return importlib.util.spec_from_file_location(
                fullname, Path(sys.argv[2]) / '__init__.py',
                submodule_search_locations=[sys.argv[2]],
            )

sys.meta_path.insert(0, StaleFinder())
importlib.import_module(sys.argv[1])
"""
    result = subprocess.run(
        [sys.executable, "-I", "-c", code, namespace, str(ROOT / legacy)],
        cwd=tmp_path, capture_output=True, text=True, check=False,
    )
    assert result.returncode != 0
    assert f"Stale editable install maps {namespace}" in result.stderr
    assert "npm run setup:python" in result.stderr


def test_all_subagent_fixtures_are_package_resources():
    fixtures = files("relohome_agent.agents.subagents") / "fixtures"
    assert {p.name for p in fixtures.iterdir()} == {
        "flight.json", "map.json", "payment.json", "property.json", "relocation.json", "roommate.json",
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
        cwd=elsewhere, env={**os.environ, "RELOHOME_RUNTIME_ROOT": str(root)},
        capture_output=True, text=True, check=False,
    )
    assert result.returncode == 0, result.stderr
    outputs = root / "docs/api/agent-contract"
    for model in ("AgentManifest", "AgentTaskRequest", "AgentTaskResult"):
        assert json.loads((outputs / f"{model}.schema.json").read_text())["title"] == model
    assert not (elsewhere / "docs").exists()
