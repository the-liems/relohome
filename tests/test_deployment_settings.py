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

ROOT = Path(__file__).resolve().parents[1]
pytestmark = pytest.mark.skipif(shutil.which("docker") is None, reason="Docker Compose CLI required; no daemon needed")


def rendered_backend(variables, service="backend"):
    """Use Docker Compose's actual interpolation without contacting a daemon."""
    source = (ROOT / "compose.coolify.yaml").read_text()
    backend = yaml.safe_load(source)["services"][service]
    # Coolify annotations on other services are not standard Compose fields.
    # Exercise the actual service image/environment, independently of those.
    definition = {"services": {service: {key: backend[key] for key in ("image", "environment")}}}
    environment = {
        key: os.environ[key] for key in ("PATH", "HOME", "SYSTEMROOT", "TEMP", "TMP", "TMPDIR") if key in os.environ
    }
    environment.update({key: "test-value" for key in re.findall(r"\$\{([A-Z0-9_]+):\?", source)})
    environment.update(
        IMAGE_PREFIX="ghcr.io/example/relohome",
        RELEASE_TAG="test-release",
        DEPLOY_RESOURCE="test-resource",
        DEPLOY_HOST="staging.example.test",
        SERVICE_URL_WEB="https://staging.example.test",
        SERVICE_FQDN_WEB="staging.example.test",
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
    return json.loads(result.stdout)["services"][service]["environment"]


@pytest.mark.parametrize('hostname', ['staging.example.test', 'pr-200.previews.example.net'])
def test_public_origins_follow_coolify_web_domain(hostname):
    origin = 'https://' + hostname
    variables = {'SERVICE_URL_WEB': origin, 'SERVICE_FQDN_WEB': hostname}
    assert rendered_backend(variables, 'web')['SIU_PUBLIC_BASE_URL'] == origin
    assert rendered_backend(variables, 'payments-mcp')['PAYMENT_REDIRECT_URL'] == origin + '/'


@pytest.mark.parametrize(
    "configured,expected",
    [({}, "staging"), ({"APP_ENV": "staging"}, "staging"), ({"APP_ENV": "production"}, "production")],
)
def test_backend_app_env_in_compose_is_a_valid_setting(configured, expected):
    backend = rendered_backend(configured)
    settings = Settings(_env_file=None, app_env=backend["APP_ENV"])
    assert settings.app_env == expected


@pytest.mark.parametrize("identifiers", ["", "admin-one", "admin-one,admin-two"])
def test_housing_admin_ids_reach_both_backends_without_a_second_moderator_list(identifiers):
    configured = {"HOUSING_MODERATOR_IDS": identifiers}
    backend = rendered_backend(configured)
    platform = rendered_backend(configured, service="platform")
    assert backend["HOUSING_MODERATOR_IDS"] == platform["HOUSING_MODERATOR_IDS"] == identifiers
    assert backend["ROOMMATE_MODERATORS"] == ""
    assert (
        Settings(_env_file=None, housing_moderator_ids=backend["HOUSING_MODERATOR_IDS"]).housing_moderator_ids
        == identifiers
    )


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
        viewing = ViewingSettings.from_services(Settings(_env_file=None))
        assert viewing.visit_anytime is enabled
    finally:
        get_settings.cache_clear()


@pytest.mark.parametrize("configured,days", [({}, 7), ({"HOUSING_VIEWING_PROPOSAL_DAYS": "10"}, 10)])
def test_viewing_proposal_window_is_one_setting_for_backend_and_platform(configured, days, monkeypatch):
    backend = rendered_backend(configured)
    platform = rendered_backend(configured, "platform")
    assert backend["HOUSING_VIEWING_PROPOSAL_DAYS"] == platform["HOUSING_VIEWING_PROPOSAL_DAYS"] == str(days)
    monkeypatch.setenv("HOUSING_VIEWING_PROPOSAL_DAYS", backend["HOUSING_VIEWING_PROPOSAL_DAYS"])
    get_settings.cache_clear()
    try:
        assert ViewingSettings.from_services(Settings(_env_file=None)).proposal_days == days
    finally:
        get_settings.cache_clear()
