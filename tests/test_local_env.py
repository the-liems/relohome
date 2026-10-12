"""Regression coverage for the local configuration boundary (no external services)."""

import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from scripts import local_env

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def config_file(tmp_path, monkeypatch):
    for key in list(os.environ):
        if key not in local_env.SYSTEM_KEYS:
            monkeypatch.delenv(key)
    path = tmp_path / "team.env"
    path.write_text(
        "LOCATION_MCP_TOKEN=location-secret\nPOSTGRES_APP_USER=app\n"
        "POSTGRES_APP_PASSWORD=db-secret\nPOSTGRES_ADMIN_PASSWORD=admin-secret\n"
        "MOVING_MCP_AUTH_TOKEN=moving-secret\nMOVING_DB_ADMIN_PASSWORD=moving-admin-secret\n"
        "FLIGHT_MCP_AUTH_TOKEN=flight-secret\nPAYMENT_MCP_AUTH_TOKEN=payment-secret\n"
        "PAYMENT_ZALOPAY_KEY1=provider-secret\nOPENAI_API_KEY=llm-secret\n"
        "DATABASE_URL=sqlite:///backend.db\nMCP_PORT=4321\nAGENT_API_TOKEN=gateway-secret\n"
    )
    return path


def test_default_is_repository_anchored_and_override_is_exclusive(config_file, tmp_path, monkeypatch):
    monkeypatch.setattr(local_env, "ROOT", tmp_path)
    config_file.rename(tmp_path / ".env.local")
    other = tmp_path / "workspace"
    other.mkdir()
    (other / ".env").write_text("LOCATION_MCP_TOKEN=wrong\n")
    monkeypatch.chdir(other)
    assert local_env.load_config()["LOCATION_MCP_AUTH_TOKEN"] == "location-secret"
    with pytest.raises(ValueError, match="Missing local configuration"):
        local_env.load_config("missing.env")


def test_mapping_scoping_and_shell_priority(config_file, monkeypatch):
    monkeypatch.setenv("LOCATION_MCP_TOKEN", "shell-secret")
    values = local_env.load_config(config_file)
    backend = local_env.scope_environment("api", values)
    location = local_env.scope_environment("location", values)
    assert backend["LOCATION_MCP_AUTH_TOKEN"] == location["MCP_AUTH_TOKEN"] == "shell-secret"
    assert backend["LOCATION_MCP_URL"] == "http://127.0.0.1:4321/mcp"
    assert backend["DATABASE_URL"] == "sqlite:///backend.db"
    for key in ("DATABASE_URL", "OPENAI_API_KEY", "PAYMENT_ZALOPAY_KEY1", "POSTGRES_ADMIN_PASSWORD"):
        assert key not in location
    for key in ("PAYMENT_ZALOPAY_KEY1", "POSTGRES_APP_PASSWORD", "MOVING_DB_ADMIN_PASSWORD"):
        assert key not in backend
    assert local_env.scope_environment("payment", values)["MCP_AUTH_TOKEN"] == "payment-secret"
    assert local_env.scope_environment("flight", values)["MCP_AUTH_TOKEN"] == "flight-secret"
    assert local_env.scope_environment("moving", values)["MCP_AUTH_TOKEN"] == "moving-secret"
    assert "POSTGRES_ADMIN_PASSWORD" not in local_env.scope_environment("platform", values)
    assert local_env.scope_environment("migrate", values)["POSTGRES_ADMIN_PASSWORD"] == "admin-secret"


def test_changed_shared_values_reach_both_sides(config_file):
    config_file.write_text(config_file.read_text().replace("location-secret", "rotated").replace("db-secret", "new-db"))
    values = local_env.load_config(config_file)
    assert local_env.scope_environment("api", values)["LOCATION_MCP_AUTH_TOKEN"] == "rotated"
    assert local_env.scope_environment("location", values)["MCP_AUTH_TOKEN"] == "rotated"
    assert local_env.scope_environment("database", values)["POSTGRES_APP_PASSWORD"] == "new-db"
    assert local_env.scope_environment("platform", values)["POSTGRES_APP_PASSWORD"] == "new-db"


def test_drift_and_invalid_ports_fail_without_printing_secrets(config_file):
    config_file.write_text(config_file.read_text() + "MCP_AUTH_TOKEN=do-not-print-me\n")
    with pytest.raises(ValueError, match="use LOCATION_MCP_TOKEN once") as error:
        local_env.load_config(config_file)
    assert "do-not-print-me" not in str(error.value)
    config_file.write_text("MCP_PORT=65536\n")
    with pytest.raises(ValueError, match="MCP_PORT"):
        local_env.load_config(config_file)


@pytest.mark.parametrize("cwd", [".", "Maps VN/LifeFlow", "Maps VN/LifeFlow/mcp-server"])
def test_launcher_process_receives_only_mapped_variables(config_file, cwd):
    result = subprocess.run(
        [
            sys.executable,
            str(ROOT / "scripts/dev.py"),
            "location",
            "--",
            "python",
            "-c",
            "import os,json; print(json.dumps(dict(os.environ)))",
            "--env-file",
            str(config_file),
        ],
        cwd=ROOT / cwd,
        capture_output=True,
        text=True,
        check=True,
    )
    env = json.loads(result.stdout)
    assert env["MCP_AUTH_TOKEN"] == "location-secret"
    assert "DATABASE_URL" not in env
    assert "OPENAI_API_KEY" not in env
    assert "LIFEFLOW_ENV_FILE" not in env


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
    (tmp_path / ".env.example").write_text("LOCATION_MCP_TOKEN=\nOPENAI_API_KEY=\n")
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


def test_separate_moving_db_mapping_excludes_admin_credentials(config_file):
    values = local_env.load_config(config_file)
    values.update(
        MOVING_DB_HOST="db.test",
        MOVING_DB_PORT="5434",
        MOVING_DB_NAME="moving",
        MOVING_DB_APP_USER="moving_app",
        MOVING_DB_APP_PASSWORD="special@password",
        MOVING_DB_ADMIN_USER="moving_admin",
        MOVING_DB_ADMIN_PASSWORD="admin-password",
    )
    runtime = local_env.scope_environment("moving", values)
    migration = local_env.scope_environment("moving-migration", values)
    assert runtime["MOVING_DATABASE_URL"] == "postgresql://moving_app:special%40password@db.test:5434/moving"
    assert "MOVING_DATABASE_ADMIN_URL" not in runtime
    assert "MOVING_DB_ADMIN_PASSWORD" not in runtime
    assert migration["MOVING_DATABASE_ADMIN_URL"] == "postgresql://moving_admin:admin-password@db.test:5434/moving"
    assert migration["MOVING_DB_APP_PASSWORD"] == "special@password"


def test_literal_values_are_not_expanded(config_file):
    config_file.write_text("LOCATION_MCP_TOKEN=literal-${HOME}\n")
    assert local_env.load_config(config_file)["MCP_AUTH_TOKEN"] == "literal-${HOME}"
