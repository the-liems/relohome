"""Values the Coolify Compose file gives the backend must be accepted by its settings (review PR #88)."""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory

import pytest
import yaml
from relohome_agent.checkout.viewing import ViewingSettings
from relohome_agent.config import Settings, get_settings
from relohome_agent.services.adapters.registry import ServiceSettings

ROOT = Path(__file__).resolve().parents[1]
pytestmark = pytest.mark.skipif(shutil.which("docker") is None, reason="Docker Compose CLI required; no daemon needed")


def rendered_backend(variables):
    """Use Docker Compose's actual interpolation without contacting a daemon."""
    source = (ROOT / "compose.coolify.yaml").read_text()
    backend = yaml.safe_load(source)["services"]["backend"]
    # Coolify annotations on other services are not standard Compose fields.
    # Exercise the actual backend image/environment, independently of those.
    definition = {"services": {"backend": {key: backend[key] for key in ("image", "environment")}}}
    environment = {
        key: os.environ[key] for key in ("PATH", "HOME", "SYSTEMROOT", "TEMP", "TMP", "TMPDIR") if key in os.environ
    }
    environment.update({key: "test-value" for key in re.findall(r"\$\{([A-Z0-9_]+):\?", source)})
    environment.update(
        IMAGE_PREFIX="ghcr.io/example/relohome",
        RELEASE_TAG="test-release",
        DEPLOY_RESOURCE="test-resource",
        DEPLOY_HOST="staging.example.test",
        APP_URL="https://staging.example.test",
    )
    environment.update(variables)
    with TemporaryDirectory(prefix="relo-viewing-compose-") as directory:
        env_file = Path(directory) / "empty.env"
        env_file.write_text("")
        result = subprocess.run(
            ["docker", "compose", "--env-file", str(env_file), "-f", "-", "config", "--format", "json"],
            env=environment,
            input=yaml.safe_dump(definition),
            capture_output=True,
            text=True,
            check=True,
            timeout=30,
        )
    return json.loads(result.stdout)["services"]["backend"]["environment"]


@pytest.mark.parametrize(
    "configured,expected",
    [({}, "staging"), ({"APP_ENV": "staging"}, "staging"), ({"APP_ENV": "production"}, "production")],
)
def test_backend_app_env_in_compose_is_a_valid_setting(configured, expected):
    backend = rendered_backend(configured)
    settings = Settings(_env_file=None, app_env=backend["APP_ENV"])
    assert settings.app_env == expected


@pytest.mark.parametrize(
    "configured,enabled",
    [
        ({}, False),
        ({"APP_ENV": "staging", "HOUSING_VIEWING_TEST_VISIT_ANYTIME": "true"}, True),
        ({"APP_ENV": "staging", "HOUSING_VIEWING_TEST_VISIT_ANYTIME": "false"}, False),
        ({"APP_ENV": "production", "HOUSING_VIEWING_TEST_VISIT_ANYTIME": "true"}, False),
    ],
)
def test_compose_viewing_test_toggle_reaches_runtime_and_respects_production(configured, enabled, monkeypatch):
    backend = rendered_backend(configured)
    monkeypatch.setenv("APP_ENV", backend["APP_ENV"])
    monkeypatch.setenv("HOUSING_VIEWING_TEST_VISIT_ANYTIME", backend["HOUSING_VIEWING_TEST_VISIT_ANYTIME"])
    get_settings.cache_clear()
    try:
        viewing = ViewingSettings.from_services(ServiceSettings(_env_file=None))
        assert viewing.visit_anytime is enabled
    finally:
        get_settings.cache_clear()
