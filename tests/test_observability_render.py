"""Deployment files must reach their consumers unchanged through Coolify storage."""

import importlib.util
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("observability_renderer", ROOT / "scripts/render-observability.py")
renderer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(renderer)


@pytest.mark.parametrize("kind", ["stack", "collector"])
def test_coolify_storage_matches_local_runtime_files(tmp_path, kind):
    local = tmp_path / "local"
    renderer.render(local, kind=kind)
    compose = renderer.render(tmp_path / "coolify", kind=kind, coolify=True)
    definition = yaml.safe_load(compose.read_text())
    inline_files = [mount for service in definition["services"].values()
                    for mount in service.get("volumes", []) if isinstance(mount, dict) and "content" in mount]
    assert inline_files
    for mount in inline_files:
        # Coolify writes these bytes to storage before Compose sees the bind mount.
        expected = (local / mount["source"].removeprefix("./")).read_text()
        assert mount["content"] == expected, mount["target"]


def test_coolify_keeps_consumer_environment_and_dashboard_interpolation(tmp_path):
    stack = yaml.safe_load(renderer.render(tmp_path / "stack", coolify=True).read_text())
    mounts = {mount["source"]: mount["content"] for service in stack["services"].values()
              for mount in service.get("volumes", []) if isinstance(mount, dict) and "content" in mount}
    assert "staging {$STAGING_INGEST_PASSWORD_HASH}" in mounts["./Caddyfile"]
    alerts = yaml.safe_load(mounts["./grafana/alerts.yaml"])
    assert alerts["contactPoints"][0]["receivers"][0]["settings"]["url"] == "$DISCORD_WEBHOOK_URL"
    datasources = yaml.safe_load(mounts["./grafana/datasources.yaml"])
    assert datasources["datasources"][1]["jsonData"]["derivedFields"][0]["url"] == (
        "${LANGFUSE_URL}/project/${LANGFUSE_STAGING_PROJECT_ID}/traces/$${__value.raw}"
    )
    dashboard = yaml.safe_load(mounts["./grafana/overview.json"])
    assert '{environment="$environment"}' in dashboard["panels"][0]["targets"][0]["expr"]

    collector = yaml.safe_load(renderer.render(tmp_path / "collector", kind="collector", coolify=True).read_text())
    config = yaml.safe_load(collector["services"]["collector"]["volumes"][0]["content"])
    assert config["extensions"]["bearertokenauth/app"]["token"] == "${env:OTEL_COLLECTOR_TOKEN}"
    assert config["exporters"]["otlphttp/gateway"]["endpoint"] == (
        "${env:OBSERVABILITY_GATEWAY_URL}/${env:OTEL_DEPLOYMENT_ENVIRONMENT}"
    )


@pytest.mark.parametrize("coolify", [False, True])
def test_existing_bucket_configuration_stays_in_deployment_environment(tmp_path, monkeypatch, coolify):
    prefix = "LANGFUSE_S3_EVENT_UPLOAD_"
    required = {prefix + suffix for suffix in (
        "BUCKET", "ENDPOINT", "REGION", "ACCESS_KEY_ID", "SECRET_ACCESS_KEY",
    )}
    for key in required:
        monkeypatch.setenv(key, "private-deployment-value-must-not-be-rendered")
    path = renderer.render(tmp_path, coolify=coolify)
    rendered = path.read_text()
    assert "private-deployment-value-must-not-be-rendered" not in rendered
    stack = yaml.safe_load(rendered)
    assert "minio" not in stack["services"] and "minio-init" not in stack["services"]
    assert "minio" not in stack["volumes"]
    for name, service in stack["services"].items():
        values = {key: value for key, value in service.get("environment", {}).items() if key.startswith(prefix)}
        if name not in {"langfuse", "langfuse-worker"}:
            assert not values
            continue
        assert all(values[key] == "${" + key + ":?}" for key in required)
        assert values[prefix + "PREFIX"] == "${LANGFUSE_S3_EVENT_UPLOAD_PREFIX:-events/}"
        assert values[prefix + "FORCE_PATH_STYLE"] == "${LANGFUSE_S3_EVENT_UPLOAD_FORCE_PATH_STYLE:-false}"
        assert set(service["depends_on"]) == {"postgres", "clickhouse", "redis"}
    assert not (tmp_path / "minio-lifecycle.json").exists()
