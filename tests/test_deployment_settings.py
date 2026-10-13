"""Values the Coolify Compose file gives the backend must be accepted by its settings (review PR #88)."""

from __future__ import annotations

from pathlib import Path

import yaml
from relohome_agent.config import Settings

ROOT = Path(__file__).resolve().parents[1]


def test_backend_app_env_in_compose_is_a_valid_setting():
    compose = yaml.safe_load((ROOT / "compose.coolify.yaml").read_text())
    backend = compose["services"]["backend"]["environment"]
    settings = Settings(_env_file=None, app_env=backend["APP_ENV"])
    assert settings.app_env == backend["APP_ENV"] != "production"

