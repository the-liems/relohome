"""Coolify deploys the observability Compose files from Git with their repository file mounts."""

import json
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "deploy/observability"


def compose(filename="compose.yaml"):
    return yaml.safe_load((SOURCE / filename).read_text())


def file_mounts(filename="compose.yaml"):
    """Map each repository file mount's container path to its source path."""
    mounts = {}
    for service in compose(filename)["services"].values():
        for mount in service.get("volumes", []):
            if mount.startswith("./"):
                source, target, *_ = mount.split(":")
                mounts[target] = source.removeprefix("./")
    return mounts


@pytest.mark.parametrize("filename", ["compose.yaml", "compose.collector.yaml"])
def test_file_mounts_exist_in_repository(filename):
    # A missing source would make Docker create a directory and the container fail.
    mounts = file_mounts(filename)
    assert mounts
    for source in mounts.values():
        assert (SOURCE / source).is_file(), source


def test_gateway_and_collector_keep_runtime_interpolation():
    assert "staging {$STAGING_INGEST_PASSWORD_HASH}" in (SOURCE / "Caddyfile").read_text()
    config = yaml.safe_load((SOURCE / "collector.yaml").read_text())
    assert config["extensions"]["bearertokenauth/app"]["token"] == "${env:OTEL_COLLECTOR_TOKEN}"
    assert config["exporters"]["otlphttp/gateway"]["endpoint"] == (
        "${env:OBSERVABILITY_GATEWAY_URL}/${env:OTEL_DEPLOYMENT_ENVIRONMENT}"
    )


def test_existing_bucket_configuration_stays_in_deployment_environment():
    prefix = "LANGFUSE_S3_EVENT_UPLOAD_"
    required = {prefix + suffix for suffix in (
        "BUCKET", "ENDPOINT", "REGION", "ACCESS_KEY_ID", "SECRET_ACCESS_KEY",
    )}
    stack = compose()
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


def test_staging_is_enabled_and_production_disabled_by_default():
    mounts = file_mounts()
    assert mounts["/etc/grafana/provisioning/alerting/relohome-staging.yaml"] == "grafana/alerts/staging.yaml"
    assert mounts["/etc/cortex/rules/staging/expected-services.yaml"] == "cortex-rules/staging/expected-services.yaml"
    assert mounts["/etc/grafana/provisioning/alerting/relohome-production.yaml"] == "grafana/alerts/disabled/production.yaml"
    assert mounts["/etc/cortex/rules/production/expected-services.yaml"] == "cortex-rules/disabled.yaml"
    assert compose()["services"]["retention"]["environment"]["OBSERVABILITY_ENVIRONMENTS"] == (
        "${OBSERVABILITY_ENVIRONMENTS:-staging}"
    )


def test_metrics_backend_is_cortex():
    stack = compose()
    assert "cortex" in stack["services"]
    assert "prometheus" not in stack["services"]
    assert "prometheus" not in stack["volumes"]


@pytest.mark.parametrize("environment", ["staging", "production"])
def test_rules_and_inventory_use_matching_tenants(environment):
    sources = yaml.safe_load((SOURCE / "grafana/datasources.yaml").read_text())
    by_uid = {source["uid"]: source for source in sources["datasources"]}
    assert sources["deleteDatasources"] == [{"name": "Prometheus", "orgId": 1}]
    source = by_uid["cortex-" + environment]
    assert source["type"] == "prometheus"  # Grafana's query protocol, not a separate server.
    assert source["url"] == "http://cortex:9009/prometheus"
    for uid in ("cortex-" + environment, "loki-" + environment):
        assert by_uid[uid]["jsonData"]["httpHeaderName1"] == "X-Scope-OrgID"
        assert by_uid[uid]["secureJsonData"]["httpHeaderValue1"] == environment

    inventory = yaml.safe_load((SOURCE / f"cortex-rules/{environment}/expected-services.yaml").read_text())
    inventory_rules = [rule for group in inventory["groups"] for rule in group["rules"]]
    assert inventory_rules
    assert all(rule["labels"]["environment"] == environment for rule in inventory_rules)
    assert all(rule["record"] == "relohome_expected_service_info" for rule in inventory_rules)
    assert yaml.safe_load((SOURCE / "cortex-rules/disabled.yaml").read_text()) == {"groups": []}

    alerts = yaml.safe_load((SOURCE / f"grafana/alerts/{environment}.yaml").read_text())
    assert {group["name"] for group in alerts["groups"]} == {"relohome-" + environment}
    assert not alerts.get("deleteRules")
    active_uids = set()
    for group in alerts["groups"]:
        assert group["rules"]
        for rule in group["rules"]:
            active_uids.add(rule["uid"])
            assert rule["labels"]["environment"] == environment
            assert rule["uid"].startswith("rh-" + environment + "-")
            query = next(item for item in rule["data"] if item["refId"] == "A")
            assert query["datasourceUid"] == "cortex-" + environment
            assert query["model"]["datasource"]["uid"] == query["datasourceUid"]
    disabled = yaml.safe_load((SOURCE / f"grafana/alerts/disabled/{environment}.yaml").read_text())
    assert not disabled.get("groups")
    assert {rule["uid"] for rule in disabled["deleteRules"]} == active_uids


def test_legacy_rules_and_dashboard():
    legacy = yaml.safe_load((SOURCE / "grafana/alerts/legacy.yaml").read_text())
    assert not legacy.get("groups")
    assert all(not rule["uid"].startswith(("rh-staging-", "rh-production-")) for rule in legacy["deleteRules"])

    sources = yaml.safe_load((SOURCE / "grafana/datasources.yaml").read_text())
    uids = {source["uid"] for source in sources["datasources"]}
    dashboard = json.loads((SOURCE / "grafana/overview.json").read_text())
    for panel in dashboard["panels"]:
        assert all('{environment="$environment"' in target["expr"] for target in panel["targets"])
        for environment in ("staging", "production"):
            assert panel["datasource"]["uid"].replace("${environment}", environment) in uids
    variable = next(item for item in dashboard["templating"]["list"] if item["name"] == "environment")
    assert variable["current"]["value"] == "staging"


def test_grafana_uses_runtime_values_and_no_contact_points():
    assert "DISCORD_WEBHOOK_URL" not in (SOURCE / "compose.yaml").read_text()
    for path in (SOURCE / "grafana/alerts").rglob("*.yaml"):
        config = yaml.safe_load(path.read_text())
        assert not ({"contactPoints", "policies", "deleteContactPoints"} & config.keys()), path
    sources = yaml.safe_load((SOURCE / "grafana/datasources.yaml").read_text())
    for source in sources["datasources"]:
        if source["type"] == "loki":
            environment = source["secureJsonData"]["httpHeaderValue1"]
            assert source["jsonData"]["derivedFields"][0]["url"] == (
                "${LANGFUSE_URL}/project/${LANGFUSE_" + environment.upper() + "_PROJECT_ID}/traces/$${__value.raw}"
            )


def test_metrics_and_logs_storage_keep_s3_secrets_as_runtime_variables():
    services = compose()["services"]
    for backend in ("cortex", "loki"):
        service = services[backend]
        prefix = backend.upper() + "_S3_"
        for suffix in ("BUCKET", "ENDPOINT", "REGION", "ACCESS_KEY_ID", "SECRET_ACCESS_KEY"):
            name = prefix + suffix
            assert service["environment"][name] == "${" + name + ":?}"
        assert service["environment"][prefix + "INSECURE"] == "${" + prefix + "INSECURE:-false}"
        assert "-config.expand-env=true" in service["command"]
        assert "${" + prefix + "SECRET_ACCESS_KEY}" in (SOURCE / (backend + ".yaml")).read_text()
    assert services["cortex"]["environment"]["CORTEX_S3_BUCKET_LOOKUP_TYPE"] == "${CORTEX_S3_BUCKET_LOOKUP_TYPE:-auto}"
    assert services["loki"]["environment"]["LOKI_S3_FORCE_PATH_STYLE"] == "${LOKI_S3_FORCE_PATH_STYLE:-false}"
