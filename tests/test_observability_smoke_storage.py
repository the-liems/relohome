"""Smoke validation must never inherit an operator's real object-storage target."""

import importlib.util
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("observability_validation", ROOT / "scripts/validate-observability.py")
validation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validation)


def test_smoke_storage_overrides_caller_bucket_settings(monkeypatch):
    for suffix in ("BUCKET", "PREFIX", "REGION", "ACCESS_KEY_ID", "SECRET_ACCESS_KEY", "ENDPOINT", "FORCE_PATH_STYLE"):
        monkeypatch.setenv("LANGFUSE_S3_EVENT_UPLOAD_" + suffix, "operator-value")
    first = validation.local_storage_environment()
    second = validation.local_storage_environment()
    environment = validation.compose_environment(first)
    assert environment["LANGFUSE_S3_EVENT_UPLOAD_ENDPOINT"] == "http://smoke-object-storage:9000"
    assert environment["LANGFUSE_S3_EVENT_UPLOAD_FORCE_PATH_STYLE"] == "true"
    assert all(environment[key] == value != "operator-value" for key, value in first.items())
    for suffix in ("BUCKET", "ACCESS_KEY_ID", "SECRET_ACCESS_KEY"):
        assert first["LANGFUSE_S3_EVENT_UPLOAD_" + suffix] != second["LANGFUSE_S3_EVENT_UPLOAD_" + suffix]


def test_local_object_storage_is_added_only_to_smoke_definition():
    definition = yaml.safe_load((ROOT / "deploy/observability/compose.yaml").read_text())
    deployed_services = set(definition["services"])
    assert not any("minio" in service["image"] for service in definition["services"].values())
    validation.add_smoke_object_storage(definition)
    assert set(definition["services"]) - deployed_services == {"smoke-object-storage", "smoke-object-storage-init"}
    assert "smoke-object-storage" in definition["volumes"]
    for name in ("langfuse", "langfuse-worker"):
        assert definition["services"][name]["depends_on"]["smoke-object-storage-init"] == {
            "condition": "service_completed_successfully"}
    for name in ("smoke-object-storage", "smoke-object-storage-init"):
        assert not definition["services"][name].get("ports")
