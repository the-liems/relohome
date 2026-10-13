"""Deployment files must reach their consumers unchanged through Coolify storage."""

import importlib.util
import json
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("observability_renderer", ROOT / "scripts/render-observability.py")
renderer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(renderer)


def runtime_files(compose):
    """Read file mounts by their consumer path for either packaging mode."""
    files = {}
    definition = yaml.safe_load(compose.read_text())
    for service in definition["services"].values():
        for mount in service.get("volumes", []):
            if isinstance(mount, dict) and "content" in mount:
                files[mount["target"]] = (mount["source"], mount["content"])
            elif isinstance(mount, str) and mount.startswith("./"):
                source, target, *_ = mount.split(":")
                files[target] = (source, (compose.parent / source).read_text())
    return files


@pytest.mark.parametrize("kind", ["stack", "collector"])
@pytest.mark.parametrize("coolify", [False, True])
def test_packaged_files_match_git_sources(tmp_path, kind, coolify):
    files = runtime_files(renderer.render(tmp_path, kind=kind, coolify=coolify))
    assert files
    for source, content in files.values():
        # Packaging must preserve consumer interpolation and directly editable source files.
        assert content.encode() == (renderer.SOURCE / source).read_bytes(), source


def test_coolify_keeps_gateway_and_collector_interpolation(tmp_path):
    stack = yaml.safe_load(renderer.render(tmp_path / "stack", coolify=True).read_text())
    mounts = {mount["source"]: mount["content"] for service in stack["services"].values()
              for mount in service.get("volumes", []) if isinstance(mount, dict) and "content" in mount}
    assert "staging {$STAGING_INGEST_PASSWORD_HASH}" in mounts["./Caddyfile"]
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


@pytest.mark.parametrize("environments", [None, ("production",), ("staging", "production")])
@pytest.mark.parametrize("coolify", [False, True])
def test_metrics_queries_rules_and_inventory_use_matching_tenants(tmp_path, environments, coolify):
    options = {} if environments is None else {"environments": environments}
    environments = environments or ("staging",)
    compose = renderer.render(tmp_path, coolify=coolify, **options)
    stack = yaml.safe_load(compose.read_text())
    files = runtime_files(compose)
    assert "cortex" in stack["services"]
    assert "prometheus" not in stack["services"]
    assert "prometheus" not in stack["volumes"]

    sources = yaml.safe_load(files["/etc/grafana/provisioning/datasources/relohome.yaml"][1])
    by_uid = {source["uid"]: source for source in sources["datasources"]}
    assert sources["deleteDatasources"] == [{"name": "Prometheus", "orgId": 1}]
    for environment in ("staging", "production"):
        source = by_uid["cortex-" + environment]
        assert source["type"] == "prometheus"  # Grafana's query protocol, not a separate server.
        assert source["url"] == "http://cortex:9009/prometheus"
        for uid in ("cortex-" + environment, "loki-" + environment):
            assert by_uid[uid]["jsonData"]["httpHeaderName1"] == "X-Scope-OrgID"
            assert by_uid[uid]["secureJsonData"]["httpHeaderValue1"] == environment

        inventory_source, inventory_content = files[f"/etc/cortex/rules/{environment}/expected-services.yaml"]
        inventory = yaml.safe_load(inventory_content)
        alert_source, alert_content = files[f"/etc/grafana/provisioning/alerting/relohome-{environment}.yaml"]
        alerts = yaml.safe_load(alert_content)
        for source_path, content in ((inventory_source, inventory_content), (alert_source, alert_content)):
            assert content.encode() == (renderer.SOURCE / source_path).read_bytes()
        if environment not in environments:
            assert inventory_source == "./cortex-rules/disabled.yaml"
            assert inventory == {"groups": []}
            assert alert_source == f"./grafana/alerts/disabled/{environment}.yaml"
            assert not alerts.get("groups")
            active = yaml.safe_load((renderer.SOURCE / f"grafana/alerts/{environment}.yaml").read_text())
            active_uids = {rule["uid"] for group in active["groups"] for rule in group["rules"]}
            assert {rule["uid"] for rule in alerts["deleteRules"]} == active_uids
            continue

        assert inventory_source == f"./cortex-rules/{environment}/expected-services.yaml"
        inventory_rules = [rule for group in inventory["groups"] for rule in group["rules"]]
        assert inventory_rules
        assert all(rule["labels"]["environment"] == environment for rule in inventory_rules)
        assert all(rule["record"] == "relohome_expected_service_info" for rule in inventory_rules)
        assert alert_source == f"./grafana/alerts/{environment}.yaml"
        assert {group["name"] for group in alerts["groups"]} == {"relohome-" + environment}
        assert not alerts.get("deleteRules")
        for group in alerts["groups"]:
            assert group["rules"]
            for rule in group["rules"]:
                assert rule["labels"]["environment"] == environment
                assert rule["uid"].startswith("rh-" + environment + "-")
                query = next(item for item in rule["data"] if item["refId"] == "A")
                assert query["datasourceUid"] == "cortex-" + environment
                assert query["model"]["datasource"]["uid"] == query["datasourceUid"]

    legacy = yaml.safe_load(files["/etc/grafana/provisioning/alerting/relohome-legacy.yaml"][1])
    assert not legacy.get("groups")
    assert all(not rule["uid"].startswith(("rh-staging-", "rh-production-")) for rule in legacy["deleteRules"])

    dashboard = json.loads(files["/var/lib/grafana/dashboards/overview.json"][1])
    for panel in dashboard["panels"]:
        assert all('{environment="$environment"' in target["expr"] for target in panel["targets"])
        for environment in ("staging", "production"):
            assert panel["datasource"]["uid"].replace("${environment}", environment) in by_uid
    variable = next(item for item in dashboard["templating"]["list"] if item["name"] == "environment")
    assert variable["current"]["value"] == "staging"


@pytest.mark.parametrize("coolify", [False, True])
def test_grafana_runtime_values_are_not_embedded_in_artifacts(tmp_path, monkeypatch, coolify):
    for name in ("GRAFANA_ADMIN_PASSWORD", "LANGFUSE_URL", "LANGFUSE_STAGING_PROJECT_ID",
                 "LANGFUSE_PRODUCTION_PROJECT_ID", "DISCORD_WEBHOOK_URL"):
        monkeypatch.setenv(name, "deployment-value-must-not-be-rendered")
    compose = renderer.render(tmp_path, coolify=coolify)
    files = runtime_files(compose)
    assert "deployment-value-must-not-be-rendered" not in compose.read_text()
    assert all("deployment-value-must-not-be-rendered" not in content for _, content in files.values())
    assert "DISCORD_WEBHOOK_URL" not in compose.read_text()
    for target, (_, content) in files.items():
        if target.startswith("/etc/grafana/provisioning/alerting/"):
            config = yaml.safe_load(content)
            assert not ({"contactPoints", "policies", "deleteContactPoints"} & config.keys())
    sources = yaml.safe_load(files["/etc/grafana/provisioning/datasources/relohome.yaml"][1])
    for source in sources["datasources"]:
        if source["type"] == "loki":
            environment = source["secureJsonData"]["httpHeaderValue1"]
            assert source["jsonData"]["derivedFields"][0]["url"] == (
                "${LANGFUSE_URL}/project/${LANGFUSE_" + environment.upper() + "_PROJECT_ID}/traces/$${__value.raw}"
            )


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
