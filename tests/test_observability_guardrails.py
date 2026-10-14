"""Issue #160: privacy defaults and real observer events reach bounded metrics."""

import asyncio
import json
from types import SimpleNamespace

import pytest
from opentelemetry import metrics
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import InMemoryMetricReader
from relohome_agent.agents.guardrails.jev import JevError
from relohome_agent.agents.guardrails.shadow import ShadowGuardrail
from relohome_observability import guardrails
from relohome_observability.privacy import content


@pytest.fixture
def readings(monkeypatch):
    monkeypatch.setattr("relohome_observability.runtime._initialized", True)
    reader = InMemoryMetricReader()
    provider = MeterProvider(metric_readers=[reader])
    monkeypatch.setattr(metrics, "get_meter_provider", lambda: provider)
    guardrails._instruments.cache_clear()

    def read():
        return {metric.name: metric.data.data_points
                for resource in reader.get_metrics_data().resource_metrics
                for scope in resource.scope_metrics for metric in scope.metrics}

    yield read
    provider.shutdown()
    guardrails._instruments.cache_clear()


def value(readings, name, **labels):
    return next(point.value for point in readings()["relohome.guardrail." + name]
                if dict(point.attributes) == labels)


def test_default_content_does_not_inspect_or_export_private_payload(monkeypatch):
    for key in ("OBSERVABILITY_CONTENT_MODE", "APP_ENV", "OTEL_DEPLOYMENT_ENVIRONMENT"):
        monkeypatch.delenv(key, raising=False)

    class Private:
        def model_dump(self, **kwargs):
            raise AssertionError("Metadata must not inspect business data")

    assert content(Private()) is None
    assert content({"input": "SYNTHETIC_NAME lives at 123 SYNTHETIC_ADDRESS"}) is None


@pytest.mark.parametrize("environment_key", ["APP_ENV", "OTEL_DEPLOYMENT_ENVIRONMENT"])
@pytest.mark.parametrize("requested_mode", ["metadata", "redacted", "raw", "invalid"])
def test_production_forces_metadata_for_legacy_content_modes(monkeypatch, environment_key, requested_mode):
    monkeypatch.setenv(environment_key, " Production ")
    monkeypatch.setenv("OBSERVABILITY_CONTENT_MODE", requested_mode)
    assert content({"input": "SYNTHETIC_NAME lives at 123 SYNTHETIC_ADDRESS"}) is None


@pytest.mark.asyncio
async def test_observer_exports_admission_skip_and_completion_without_identifiers(readings):
    gate = asyncio.Event()

    class Client:
        async def decide(self, *args):
            await gate.wait()
            return SimpleNamespace(answers=["uncertain"], input_tokens=1, output_tokens=1,
                                   served_model="fixture", cost=None)

        async def close(self):
            pass

    observer = ShadowGuardrail(Client(), max_pending=1)
    scope = {"thread_id": "SYNTHETIC_PRIVATE_THREAD", "request_id": "SYNTHETIC_PRIVATE_REQUEST"}
    try:
        observer._observe("plan", {}, lambda: {}, [])
        observer._observe("plan", scope, lambda: {}, [])
        assert value(readings, "in_flight", point="plan") == 1
        observer._observe("plan", {**scope, "request_id": "other"}, lambda: {}, [])
        gate.set()
        await asyncio.gather(*observer._tasks)
        await asyncio.sleep(0)
        observer._observe("plan", scope, lambda: {}, [])  # Submitted duplicate is not eligible.
        observer._observe("assessment", scope, lambda: None, [])
        assert value(readings, "observations", point="plan", event="seen") == 4
        assert value(readings, "observations", point="plan", event="eligible") == 3
        assert value(readings, "observations", point="plan", event="submitted") == 1
        assert value(readings, "observations", point="plan", event="completed") == 1
        assert value(readings, "observations", point="plan", event="skipped") == 3
        assert value(readings, "skips", point="plan", reason="missing_scope") == 1
        assert value(readings, "skips", point="plan", reason="overload") == 1
        assert value(readings, "skips", point="plan", reason="turn_limit") == 1
        assert value(readings, "skips", point="assessment", reason="not_applicable") == 1
        assert value(readings, "in_flight", point="plan") == 0
        attributes = [dict(point.attributes) for points in readings().values() for point in points]
        assert "SYNTHETIC_PRIVATE" not in json.dumps(attributes)
        assert all(set(labels) <= {"point", "event", "reason"} for labels in attributes)
    finally:
        await observer.close()


@pytest.mark.asyncio
async def test_timeout_and_pre_start_cancellation_are_distinct_and_balance_pending(readings):
    class Client:
        async def decide(self, *args):
            raise JevError("timeout")

        async def close(self):
            pass

    first = ShadowGuardrail(Client())
    scope = {"thread_id": "private", "request_id": "private"}
    first._observe("plan", scope, lambda: {}, [])
    await asyncio.gather(*first._tasks)
    await first.close()
    assert value(readings, "observations", point="plan", event="timeout") == 1
    second = ShadowGuardrail(Client())
    second._observe("plan", scope, lambda: {}, [])
    await second.close()  # Cancel before decide starts.
    assert value(readings, "observations", point="plan", event="cancelled") == 1
    assert value(readings, "observations", point="plan", event="submitted") == 2
    assert value(readings, "in_flight", point="plan") == 0


@pytest.mark.asyncio
async def test_privacy_and_deterministic_assessments_remain_visible_without_calls(readings):
    class Client:
        async def decide(self, *args):
            raise AssertionError("Privacy skips must never call Jev")

        async def close(self):
            pass

    observer = ShadowGuardrail(Client())
    result = SimpleNamespace(usage=SimpleNamespace(llm_calls=1), agent=SimpleNamespace(value="property"),
                             status="done", data={"agent_assessment": {"reason": "SYNTHETIC_PRIVATE_NAME"}})
    observer.observe_assessment({"thread_id": "private", "request_id": "private"}, result)
    result.usage.llm_calls = 0
    observer.observe_assessment({}, result)
    await observer.close()
    assert value(readings, "skips", point="assessment", reason="privacy_insufficient_evidence") == 1
    assert value(readings, "skips", point="assessment", reason="deterministic") == 1
    assert value(readings, "observations", point="assessment", event="eligible") == 1
    assert value(readings, "observations", point="assessment", event="skipped") == 2


def test_metrics_disabled_unknown_labels_and_sdk_failure_are_fail_open(monkeypatch):
    def unavailable(*args):
        raise AssertionError("Unexpected SDK access")

    monkeypatch.setattr(guardrails, "_instruments", unavailable)
    monkeypatch.setattr("relohome_observability.runtime._initialized", False)
    guardrails.record_event("plan", "seen")
    guardrails.record_skip("plan", "overload")
    guardrails.pending_change("plan", 1)
    monkeypatch.setattr("relohome_observability.runtime._initialized", True)
    guardrails.record_event("private-thread", "seen")
    guardrails.record_skip("plan", "private-address")
    guardrails.pending_change("private-thread", 1)
    # A broken SDK cannot interrupt the valid observation either.
    guardrails.record_event("plan", "seen")
    guardrails.record_skip("plan", "overload")
    guardrails.pending_change("plan", 1)


def test_factory_already_enables_info_snapshots_after_uvicorn_setup(monkeypatch, caplog):
    import logging

    from relohome_agent.agents.guardrails import shadow
    from relohome_agent.services.adapters.registry import ServiceSettings

    monkeypatch.setattr("relohome_observability.runtime._initialized", False)
    monkeypatch.setattr(shadow.logger, "level", logging.WARNING)
    monkeypatch.setattr(shadow, "JevClient", lambda *args, **kwargs: SimpleNamespace())
    observer = shadow.build_guardrail(ServiceSettings(agent_guardrail_mode="shadow", openrouter_api_key="sk-or-v1-test"))
    assert shadow.logger.isEnabledFor(logging.INFO)
    observer._emit_metrics()
    assert "jev_metrics" in caplog.text


def test_collector_preserves_only_fixed_guardrail_label_keys_and_native_panels():
    from pathlib import Path

    import yaml

    root = Path(__file__).resolve().parents[1]
    collector = yaml.safe_load((root / "deploy/observability/collector.yaml").read_text())
    statements = collector["processors"]["transform/privacy"]["metric_statements"][-1]["statements"]
    allowed = json.loads(statements[0].removeprefix("keep_keys(attributes, ").removesuffix(")"))
    assert {"point", "event", "reason"} <= set(allowed)
    assert not ({"request_id", "thread_id", "input", "text", "address"} & set(allowed))
    trace_statements = collector["processors"]["transform/privacy"]["trace_statements"][-1]["statements"]
    for field in ("input", "output"):
        assert (f'delete_key(attributes, "langfuse.observation.{field}") '
                'where resource.attributes["environment"] == "production"') in trace_statements
    assert collector["processors"]["filter/metrics"]["metrics"]["metric"] == ['not IsMatch(name, "^relohome\\\\.")']
    panels = json.loads((root / "deploy/observability/grafana/overview.json").read_text())["panels"]
    selected = [panel for panel in panels if panel["id"] in {21, 22, 23, 24}]
    assert len(selected) == 4
    assert len({panel["id"] for panel in panels}) == len(panels)
    assert all(panel["datasource"]["uid"] == "cortex" for panel in selected)
    expressions = " ".join(target["expr"] for panel in selected for target in panel["targets"])
    assert 'event="eligible"' in expressions and 'event="completed"' in expressions
    assert 'environment="$environment"' in expressions and "relohome_guardrail_skips_total" in expressions


def test_compose_shares_production_privacy_marker():
    from pathlib import Path

    import yaml

    root = Path(__file__).resolve().parents[1]
    compose = yaml.safe_load((root / "compose.coolify.yaml").read_text())
    for service in compose["services"].values():
        environment = service.get("environment", {})
        if "OBSERVABILITY_CONTENT_MODE" in environment:
            assert environment["APP_ENV"] == "${APP_ENV:-staging}"
            assert environment["OBSERVABILITY_CONTENT_MODE"] == "${OBSERVABILITY_CONTENT_MODE:-metadata}"
