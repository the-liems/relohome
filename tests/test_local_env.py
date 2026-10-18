"""Local env-file entrypoints preserve the shell; application settings are process-only."""

import importlib.util
import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def load_script(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize("component", ["location", "platform", "moving", "moving-api"])
def test_local_node_services_preload_before_entrypoint(component, tmp_path, monkeypatch):
    import sys

    runner = load_script("local-integration")
    monkeypatch.setattr(runner, "ROOT", tmp_path)
    entrypoint = {
        "location": "apps/location-mcp/dist/http-server.js",
        "platform": "apps/platform-api/dist/server.js",
        "moving": "apps/moving-mcp/dist/http-server.js",
        "moving-api": "apps/moving-api/dist/server.js",
    }[component]
    path = tmp_path / entrypoint
    path.parent.mkdir(parents=True)
    path.write_text("// fixture")
    monkeypatch.setattr(sys, "argv", ["local-integration.py", component])
    env = {}
    monkeypatch.setattr(runner, "environment", lambda *args: env)
    monkeypatch.setattr(runner.shutil, "which", lambda _: "node")
    calls = []
    monkeypatch.setattr(runner.subprocess, "call", lambda command, **kw: calls.append((command, kw)) or 0)
    with pytest.raises(SystemExit) as exit_info:
        runner.main()
    assert exit_info.value.code == 0
    assert calls == [(["node", "--import", "@relohome/telemetry/register", entrypoint], {"env": env, "cwd": tmp_path})]
    assert env == {}  # Preload activates telemetry without an environment toggle.


@pytest.mark.parametrize("component,entrypoint", [
    ("check", "scripts/relohome/check-local-schema.mjs"),
    ("migrate", "apps/platform-api/dist/migrate.js"),
])
def test_schema_commands_do_not_preload_telemetry(component, entrypoint):
    runner = load_script("local-integration")
    assert runner.node_command(component, entrypoint) == ["node", entrypoint]


def test_integration_default_is_anchored_and_preserves_shell(tmp_path, monkeypatch):
    runner = load_script("local-integration")
    monkeypatch.setattr(runner, "ROOT", tmp_path)
    (tmp_path / ".env.local").write_text("LOCATION_MCP_AUTH_TOKEN=file-token\nSIU_GATEWAY_URL=http://localhost:8600\n")
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / ".env").write_text("LOCATION_MCP_AUTH_TOKEN=wrong\n")
    monkeypatch.chdir(workspace)
    monkeypatch.setenv("LOCATION_MCP_AUTH_TOKEN", "shell-token")
    monkeypatch.setenv("DOCKER_HOST", "unix:///custom/docker.sock")
    monkeypatch.setenv("ProgramFiles", "C:/Program Files")
    env = runner.environment("location")
    assert env["LOCATION_MCP_AUTH_TOKEN"] == "shell-token"
    assert env["SIU_GATEWAY_URL"] == "http://localhost:8600"
    assert env["DOCKER_HOST"] == "unix:///custom/docker.sock"
    # Windows os.environ normalizes names to uppercase; preservation is case-insensitive.
    assert {key.casefold(): value for key, value in env.items()}["programfiles"] == "C:/Program Files"
    assert "LIFEFLOW_ENV_FILE" not in env


def test_explicit_file_is_exclusive_and_missing_file_fails(tmp_path, monkeypatch):
    runner = load_script("local-integration")
    monkeypatch.setattr(runner, "ROOT", tmp_path)
    (tmp_path / ".env.local").write_text("ONLY_DEFAULT=wrong\n")
    other = tmp_path / "custom.env"
    other.write_text("ONLY_CUSTOM=correct\n")
    env = runner.environment("api", env_file=other)
    assert "ONLY_DEFAULT" not in env
    assert env["ONLY_CUSTOM"] == "correct"
    with pytest.raises(ValueError, match="Missing local configuration"):
        runner.environment("api", env_file=tmp_path / "missing.env")


def test_integration_retains_staging_safety_overrides(tmp_path):
    runner = load_script("local-integration")
    config = tmp_path / "custom.env"
    config.write_text("AHAMOVE_ENV=production\nAHAMOVE_WRITE_ENABLED=true\n")
    env = runner.environment("moving", env_file=config)
    assert env["AHAMOVE_ENV"] == "staging"
    assert env["AHAMOVE_WRITE_ENABLED"] == "false"
    assert runner.environment("moving", sandbox_writes=True, env_file=config)["AHAMOVE_WRITE_ENABLED"] == "true"


def test_uvicorn_file_preserves_exported_values(tmp_path, monkeypatch):
    from uvicorn import Config

    config = tmp_path / "uvicorn.env"
    config.write_text("LOCAL_ENV_TEST=from-file\nSIU_GATEWAY_URL=http://localhost:8600\n")
    monkeypatch.setenv("LOCAL_ENV_TEST", "from-shell")
    monkeypatch.delenv("SIU_GATEWAY_URL", raising=False)
    Config("unused:app", env_file=config)
    assert os.environ["LOCAL_ENV_TEST"] == "from-shell"
    assert os.environ["SIU_GATEWAY_URL"] == "http://localhost:8600"


def test_python_settings_do_not_read_cwd_dotenv(tmp_path, monkeypatch):
    (tmp_path / ".env").write_text("APP_ENV=production\nAGENT_API_TOKEN=wrong\n")
    monkeypatch.chdir(tmp_path)
    from relohome_agent.config import Settings

    assert Settings().app_env != "production"
    assert Settings().agent_api_token.get_secret_value() != "wrong"


def test_initializer_is_private_and_never_overwrites(tmp_path, monkeypatch):
    spec = importlib.util.spec_from_file_location("initializer", ROOT / "scripts/init-local-integration.py")
    initializer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(initializer)
    monkeypatch.setattr(initializer, "ROOT", tmp_path)
    (tmp_path / ".env.example").write_text("LOCATION_MCP_AUTH_TOKEN=\nOPENAI_API_KEY=\n")
    target = tmp_path / ".env.local"
    initializer.initialize(target)
    original = target.read_text()
    assert len(original.splitlines()[0].split("=", 1)[1]) >= 32
    assert "OPENAI_API_KEY=\n" in original
    if os.name != "nt":
        assert target.stat().st_mode & 0o777 == 0o600
    with pytest.raises(ValueError, match="retained unchanged"):
        initializer.initialize(target)
    assert target.read_text() == original
    target.unlink()
    (tmp_path / ".env").write_text("POSTGRES_APP_PASSWORD=existing\n")
    with pytest.raises(ValueError, match="Existing local configuration"):
        initializer.initialize(target)
    assert not target.exists()


def test_native_node_loads_file_before_python_shim(tmp_path, monkeypatch):
    node = shutil.which("node")
    if not node:
        pytest.skip("Node is not installed")
    config = tmp_path / "python.env"
    config.write_text("PYTHON_ENV_PROBE=file-value\nPYTHON_ENV_FILE_ONLY=present\n")
    monkeypatch.setenv("PYTHON_ENV_PROBE", "shell-value")
    command = [
        node,
        "--env-file=" + str(config),
        str(ROOT / "scripts/python.mjs"),
        "-c",
        "import os; assert os.environ['PYTHON_ENV_PROBE'] == 'shell-value'; "
        "assert os.environ['PYTHON_ENV_FILE_ONLY'] == 'present'",
    ]
    subprocess.run(command, cwd=tmp_path, check=True, capture_output=True, text=True)
    command[1] = "--env-file=" + str(tmp_path / "missing.env")
    assert subprocess.run(command, cwd=tmp_path, capture_output=True).returncode != 0


def test_env_test_reader_is_strict_and_literal(tmp_path):
    from tests.live import parse_env_file

    good = tmp_path / "good.env"
    good.write_text('# vendor keys\n\nOPENAI_API_KEY=sk-a=b#c\nMOVING_LIVE_QUOTE_INPUTS={"a": 1}\n')
    assert parse_env_file(good) == {"OPENAI_API_KEY": "sk-a=b#c", "MOVING_LIVE_QUOTE_INPUTS": '{"a": 1}'}
    for line in ("export OPENAI_API_KEY=x", "lower=x", "NO_EQUALS"):
        bad = tmp_path / "bad.env"
        bad.write_text(line + "\n")
        with pytest.raises(ValueError, match="expected KEY=VALUE"):
            parse_env_file(bad)


def test_test_runs_drop_inherited_application_configuration(tmp_path):
    from tests.live import clean_environment

    template = tmp_path / ".env.example"
    template.write_text("AGENT_API_TOKEN=\nLOCATION_DATABASE_URL=\n# COMMENTED_OUT=\n")
    environ = {
        "PATH": "/bin",
        "ProgramFiles": "C:/Program Files",
        "RUN_LIVE_INTEGRATION": "1",
        "AGENT_API_TOKEN": "from-shell",
        "LOCATION_DATABASE_URL": "postgresql://shell/location",
        "DATABASE_URL": "sqlite:///backend.db",
        "LANGCHAIN_TRACING_V2": "true",
        "OPENAI_API_KEY": "real-key",
    }
    clean_environment(environ, template)
    assert environ == {
        "PATH": "/bin",
        "ProgramFiles": "C:/Program Files",
        "RUN_LIVE_INTEGRATION": "1",
        "APP_ENV": "test",
        "OPENAI_API_KEY": "test-key",
    }
