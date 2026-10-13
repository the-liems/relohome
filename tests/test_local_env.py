"""Mapping unit tests use fake dictionaries; startup tests use temporary files."""

import importlib.util
import os
from pathlib import Path

import pytest

from scripts.service_environment import service_environment

ROOT = Path(__file__).resolve().parents[1]


def load_script(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_same_name_different_values_and_shared_value_different_names():
    values = {
        "BACKEND_DATABASE_URL": "sqlite:///fake.db",
        "LOCATION_DATABASE_URL": "postgresql://fake/location",
        "MOVING_DATABASE_URL": "postgresql://fake/moving",
        "LOCATION_TOKEN": "shared-fake-token",
    }
    parent = {"DATABASE_URL": "wrong-parent-url", "MCP_AUTH_TOKEN": "wrong-parent-token"}
    api = service_environment("api", values, parent)
    location = service_environment("location", values, parent)
    moving = service_environment("moving", values, parent)
    assert api["DATABASE_URL"] == "sqlite:///fake.db"
    assert location["DATABASE_URL"] == "postgresql://fake/location"
    assert moving["DATABASE_URL"] == "postgresql://fake/moving"
    assert api["LOCATION_MCP_AUTH_TOKEN"] == location["MCP_AUTH_TOKEN"] == "shared-fake-token"
    assert "LOCATION_TOKEN" not in api
    assert "MCP_AUTH_TOKEN" not in api
    assert "BACKEND_DATABASE_URL" not in location


def test_mapping_keeps_host_settings_without_leaking_other_services():
    parent = {
        "PATH": "/bin",
        "ProgramFiles": "C:/Program Files",
        "DOCKER_HOST": "unix:///custom.sock",
        "OPENAI_API_KEY": "unrelated-key",
        "DATABASE_URL": "wrong",
    }
    values = {**parent, "SIU_GATEWAY_URL": "http://localhost:8600", "LOCATION_TOKEN": "fake"}
    web = service_environment("web", values, parent)
    assert web["SIU_GATEWAY_URL"] == "http://localhost:8600"
    for key in ("PATH", "ProgramFiles", "DOCKER_HOST"):
        assert web[key] == parent[key]
    assert "OPENAI_API_KEY" not in web
    assert "DATABASE_URL" not in web
    assert "LOCATION_TOKEN" not in web


def test_missing_optional_url_leaves_postgres_fallback_available():
    env = service_environment(
        "location", {"LOCATION_DATABASE_URL": "", "POSTGRES_APP_USER": "fake"}, {"DATABASE_URL": "sqlite:///wrong.db"}
    )
    assert "DATABASE_URL" not in env
    assert env["POSTGRES_APP_USER"] == "fake"


@pytest.mark.parametrize("service,prefix", [("flight", "FLIGHT"), ("payment", "PAYMENT"), ("moving", "MOVING")])
def test_provider_token_bindings(service, prefix):
    env = service_environment(service, {prefix + "_MCP_AUTH_TOKEN": "fake-token"}, {})
    assert env["MCP_AUTH_TOKEN"] == "fake-token"


def test_startup_loads_only_selected_file_with_shell_precedence(tmp_path, monkeypatch):
    runner = load_script("local-integration")
    monkeypatch.setattr(runner, "ROOT", tmp_path)
    (tmp_path / ".env.local").write_text("LOCATION_TOKEN=default-token\n")
    alternate = tmp_path / "alternate.env"
    alternate.write_text("LOCATION_TOKEN=alternate-token\n")
    monkeypatch.setenv("LOCATION_TOKEN", "shell-token")
    assert runner.environment("location", env_file=alternate)["MCP_AUTH_TOKEN"] == "shell-token"
    monkeypatch.delenv("LOCATION_TOKEN")
    assert runner.environment("location", env_file=alternate)["MCP_AUTH_TOKEN"] == "alternate-token"
    assert runner.environment("location")["MCP_AUTH_TOKEN"] == "default-token"
    with pytest.raises(ValueError, match="Missing local configuration"):
        runner.environment("location", env_file=tmp_path / "missing.env")


def test_staging_overrides_remain_explicit(tmp_path):
    runner = load_script("local-integration")
    config = tmp_path / "config.env"
    config.write_text("AHAMOVE_ENV=production\nAHAMOVE_WRITE_ENABLED=true\n")
    assert runner.environment("moving", env_file=config)["AHAMOVE_WRITE_ENABLED"] == "false"
    assert runner.environment("moving", env_file=config, staging=False)["AHAMOVE_WRITE_ENABLED"] == "true"


def test_python_settings_do_not_read_cwd_dotenv(tmp_path, monkeypatch):
    (tmp_path / ".env").write_text("APP_ENV=production\nAGENT_API_TOKEN=wrong\n")
    monkeypatch.chdir(tmp_path)
    from src.config import Settings
    from src.services.adapters.registry import ServiceSettings

    assert Settings().app_env != "production"
    assert ServiceSettings().agent_api_token.get_secret_value() != "wrong"


def test_initializer_is_private_and_never_overwrites(tmp_path, monkeypatch):
    spec = importlib.util.spec_from_file_location("initializer", ROOT / "scripts/init-local-integration.py")
    initializer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(initializer)
    monkeypatch.setattr(initializer, "ROOT", tmp_path)
    (tmp_path / ".env.example").write_text("LOCATION_TOKEN=\nOPENAI_API_KEY=\n")
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


def test_startup_maps_child_without_consuming_child_flags(tmp_path):
    import json
    import subprocess
    import sys

    config = tmp_path / "fake.env"
    config.write_text("BACKEND_DATABASE_URL=sqlite:///fake.db\nLOCATION_TOKEN=fake-token\n")
    code = (
        "import json,os,sys; print(json.dumps({"
        '"database":os.environ["DATABASE_URL"],'
        '"token":os.environ["LOCATION_MCP_AUTH_TOKEN"],'
        '"pythonpath":os.environ["PYTHONPATH"],"args":sys.argv[1:]}))'
    )
    parent = {k: v for k, v in os.environ.items() if k not in {"BACKEND_DATABASE_URL", "LOCATION_TOKEN"}}
    result = subprocess.run(
        [
            sys.executable,
            str(ROOT / "scripts/local-integration.py"),
            "api",
            "--env-file",
            str(config),
            "--",
            "python",
            "-c",
            code,
            "--env-file",
            "child-owned.env",
        ],
        env=parent,
        capture_output=True,
        text=True,
        check=True,
    )
    assert json.loads(result.stdout) == {
        "database": "sqlite:///fake.db",
        "token": "fake-token",
        "pythonpath": str(ROOT),
        "args": ["--env-file", "child-owned.env"],
    }
