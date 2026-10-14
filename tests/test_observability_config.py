"""Coolify deploys the observability Compose files from Git with their repository file mounts."""

import json
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "deploy/observability"


def load(relative):
    return yaml.safe_load((SOURCE / relative).read_text())


def datasource_uids():
    return {source["uid"]: source for source in load("grafana/datasources.yaml")["datasources"]}


@pytest.mark.parametrize("filename", ["compose.yaml", "compose.collector.yaml"])
def test_file_mounts_exist_in_repository(filename):
    # A missing source would make Docker create a directory and the container fail.
    sources = [mount.split(":")[0] for service in load(filename)["services"].values()
               for mount in service.get("volumes", []) if mount.startswith("./")]
    assert sources
    for source in sources:
        assert (SOURCE / source).is_file(), source


@pytest.mark.parametrize("environment", ["staging", "production"])
def test_rules_and_datasources_use_matching_tenants(environment):
    by_uid = datasource_uids()
    for uid in ("cortex-" + environment, "loki-" + environment):
        assert by_uid[uid]["secureJsonData"]["httpHeaderValue1"] == environment

    inventory = load(f"cortex-rules/{environment}/expected-services.yaml")
    rules = [rule for group in inventory["groups"] for rule in group["rules"]]
    assert rules and all(rule["labels"]["environment"] == environment for rule in rules)

    for group in load(f"grafana/alerts/{environment}.yaml")["groups"]:
        for rule in group["rules"]:
            assert rule["labels"]["environment"] == environment
            assert rule["uid"].startswith("rh-" + environment + "-")
            query = next(item for item in rule["data"] if item["refId"] == "A")
            assert query["datasourceUid"] == query["model"]["datasource"]["uid"] == "cortex-" + environment


@pytest.mark.parametrize("environment", ["staging", "production"])
def test_disabled_alerts_delete_exactly_the_active_rules(environment):
    active = load(f"grafana/alerts/{environment}.yaml")
    disabled = load(f"grafana/alerts/disabled/{environment}.yaml")
    assert not disabled.get("groups")
    assert {rule["uid"] for rule in disabled["deleteRules"]} == {
        rule["uid"] for group in active["groups"] for rule in group["rules"]}


def test_dashboard_panels_use_existing_datasources():
    uids = datasource_uids()
    dashboard = json.loads((SOURCE / "grafana/overview.json").read_text())
    for panel in dashboard["panels"]:
        for environment in ("staging", "production"):
            assert panel["datasource"]["uid"].replace("${environment}", environment) in uids
