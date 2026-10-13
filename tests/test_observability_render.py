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


@pytest.mark.parametrize("environments", [("staging",), ("production",), ("staging", "production")])
def test_metrics_queries_rules_and_inventory_use_matching_tenants(tmp_path, environments):
    stack = yaml.safe_load(renderer.render(tmp_path, environments=environments).read_text())
    assert "cortex" in stack["services"]
    assert "prometheus" not in stack["services"]
    assert "prometheus" not in stack["volumes"]
    assert not (tmp_path / "prometheus.yaml").exists()

    sources = yaml.safe_load((tmp_path / "grafana/datasources.yaml").read_text())
    by_uid = {source["uid"]: source for source in sources["datasources"]}
    assert sources["deleteDatasources"] == [{"name": "Prometheus", "orgId": 1}]
    for environment in ("staging", "production"):
        source = by_uid["cortex-" + environment]
        assert source["type"] == "prometheus"  # Grafana's query protocol, not a separate server.
        assert source["url"] == "http://cortex:9009/prometheus"
        assert source["jsonData"]["httpHeaderName1"] == "X-Scope-OrgID"
        assert source["secureJsonData"]["httpHeaderValue1"] == environment
        inventory = yaml.safe_load((tmp_path / "cortex-rules" / environment / "expected-services.yaml").read_text())
        if environment not in environments:
            assert inventory == {"groups": []}
        else:
            rules = [rule for group in inventory["groups"] for rule in group["rules"]]
            assert {rule["labels"]["service_name"] for rule in rules} == set(renderer.SERVICES)
            assert all(rule["labels"]["environment"] == environment for rule in rules)
            assert all(rule["record"] == "relohome_expected_service_info" for rule in rules)

    alerts = yaml.safe_load((tmp_path / "grafana/alerts.yaml").read_text())
    assert {group["name"] for group in alerts["groups"]} == {"relohome-" + env for env in environments}
    deleted = {rule["uid"] for rule in alerts["deleteRules"]}
    for group in alerts["groups"]:
        assert group["rules"]
        for rule in group["rules"]:
            environment = rule["labels"]["environment"]
            assert environment in environments
            assert rule["uid"].startswith("rh-" + environment + "-")
            assert rule["uid"] not in deleted
            query = next(item for item in rule["data"] if item["refId"] == "A")
            assert query["datasourceUid"] == "cortex-" + environment
            assert query["model"]["datasource"]["uid"] == query["datasourceUid"]
    for environment in {"staging", "production"} - set(environments):
        assert "rh-" + environment + "-heartbeat" in deleted

    dashboard = yaml.safe_load((tmp_path / "grafana/overview.json").read_text())
    assert all(panel["datasource"]["uid"] == "cortex-${environment}" for panel in dashboard["panels"]
               if panel["type"] == "timeseries")


@pytest.mark.parametrize("coolify", [False, True])
def test_metrics_and_logs_storage_keep_s3_secrets_as_runtime_variables(tmp_path, monkeypatch, coolify):
    for backend in ("CORTEX", "LOKI"):
        for suffix in ("BUCKET", "ENDPOINT", "REGION", "ACCESS_KEY_ID", "SECRET_ACCESS_KEY"):
            monkeypatch.setenv(backend + "_S3_" + suffix, "operator-secret-must-not-be-rendered")
    path = renderer.render(tmp_path, coolify=coolify)
    assert "operator-secret-must-not-be-rendered" not in path.read_text()
    services = yaml.safe_load(path.read_text())["services"]
    for backend in ("cortex", "loki"):
        service = services[backend]
        prefix = backend.upper() + "_S3_"
        for suffix in ("BUCKET", "ENDPOINT", "REGION", "ACCESS_KEY_ID", "SECRET_ACCESS_KEY"):
            name = prefix + suffix
            assert service["environment"][name] == "${" + name + ":?}"
        assert service["environment"][prefix + "INSECURE"] == "${" + prefix + "INSECURE:-false}"
        assert "-config.expand-env=true" in service["command"]
        if coolify:
            content = next(mount["content"] for mount in service["volumes"]
                           if isinstance(mount, dict) and mount["source"] == "./" + backend + ".yaml")
        else:
            content = (tmp_path / (backend + ".yaml")).read_text()
        assert "operator-secret-must-not-be-rendered" not in content
        assert "${" + prefix + "SECRET_ACCESS_KEY}" in content
    assert services["cortex"]["environment"]["CORTEX_S3_BUCKET_LOOKUP_TYPE"] == "${CORTEX_S3_BUCKET_LOOKUP_TYPE:-auto}"
    assert services["loki"]["environment"]["LOKI_S3_FORCE_PATH_STYLE"] == "${LOKI_S3_FORCE_PATH_STYLE:-false}"
