"""Issue #155: safe credential boundary, no narrative egress, measurable shadow gaps."""

import asyncio
import json
import logging
from unittest.mock import Mock

import httpx
import pytest
from langchain_core.messages import HumanMessage
from relohome_agent.agents.guardrails.jev import JevClient, JevError, openrouter_key
from relohome_agent.agents.guardrails.projection import ProjectionPrivacyError, assessment_projection, plan_projection
from relohome_agent.agents.guardrails.shadow import ShadowGuardrail, build_guardrail
from relohome_agent.agents.models import AgentUsage, RequestKind
from relohome_agent.config import Settings

from tests.test_agents.helpers import fact
from tests.test_agents.test_jev_guardrails import envelope, plan_state, result_input


@pytest.mark.parametrize(
    "key",
    [
        "sk-proj-private",
        "sk-openai-private",
        "sk-or-v1-",
        "sk-or-v1-test\n",
        " sk-or-v1-test",
        "sk-or-v1-test extra",
        "Bearer sk-or-v1-test",
    ],
)
def test_invalid_explicit_key_never_constructs_http_client(key, monkeypatch, caplog):
    http = Mock(side_effect=AssertionError("No HTTP client may be constructed"))
    monkeypatch.setattr("relohome_agent.agents.guardrails.jev.httpx.AsyncClient", http)
    with pytest.raises(JevError, match=r"^invalid_credential$"):
        JevClient(key)
    # An invalid override may not hide behind a valid compatibility key.
    assert (
        build_guardrail(
            Settings(agent_guardrail_mode="shadow", openrouter_api_key=key, openai_api_key="sk-or-v1-valid")
        )
        is None
    )
    http.assert_not_called()
    assert key not in caplog.text
    assert "invalid_credential" in caplog.text


def test_compatibility_key_is_validated_and_explicit_key_wins():
    assert openrouter_key("", "sk-proj-private") == ""
    assert openrouter_key("", "sk-or-v1-") == ""
    assert openrouter_key("", "sk-or-v1-test") == "sk-or-v1-test"
    assert openrouter_key("sk-or-v1-override", "sk-or-v1-test") == "sk-or-v1-override"


def test_runtime_projection_never_exports_names_addresses_or_narrative_in_any_field():
    state, plan = plan_state(RequestKind.REFINE)
    private = "Nguyễn Văn Bí Mật, số 17 ngõ 42 đường Riêng Tư"
    state["messages"] = [HumanMessage(f"Tôi là {private}; cần tìm nhà")]
    state["intake"].user_confirmed_facts.update(
        {
            "near": fact(private, private),
            "from_address": fact(private, private),
            "max_price_vnd": fact(5_000_000, private),
        }
    )
    state["intake"].user_confirmed_facts["city"] = fact("Hà Nội", private)
    plan = plan.model_copy(
        update={
            "tasks": [
                plan.tasks[0].model_copy(
                    update={
                        "inputs": {
                            "city": "hanoi",
                            "near": private,
                            "must_have": [private, "air_conditioning"],
                            "soft_filters": {"district": private},
                            "max_price_vnd": 5_000_000,
                        }
                    }
                )
            ]
        }
    )
    projected = plan_projection(state, plan)
    exported = json.dumps(projected, ensure_ascii=False)
    assert private not in exported
    for text in ("Nguyễn", "Bí Mật", "Riêng Tư", "Hà Nội", "hanoi", "latest_user_request", '"evidence"'):
        assert text not in exported
    inputs = projected["proposed_plan"][0]["inputs"]
    assert inputs["near"] == projected["confirmed_facts"]["near"]["value"]
    assert inputs["city"] == projected["confirmed_facts"]["city"]["value"]
    assert inputs["max_price_vnd"] == 5_000_000
    assert inputs["must_have"][1] == "air_conditioning"
    assert projected["requested_domains"] == ["property"]
    assert projected["privacy_mode"] == "structured_only"
    assert projected["free_text_available"] is False


def test_narrative_assessment_is_not_misreported_as_clean_or_grounded():
    inp, result = result_input()
    with pytest.raises(ProjectionPrivacyError, match="assessment_text_omitted"):
        assessment_projection(inp, result)
    # Free text is explicit only in synthetic harness; never selected by runtime settings.
    assert "reason" in assessment_projection(inp, result, synthetic_text=True)["model_assessment"]


@pytest.mark.asyncio
async def test_privacy_and_deterministic_exclusions_do_not_call_jev_and_are_counted(caplog):
    calls = []

    def provider(request):
        calls.append(request)
        return httpx.Response(200, json=envelope())

    observer = ShadowGuardrail(JevClient("sk-or-v1-test", transport=httpx.MockTransport(provider)))
    caplog.set_level(logging.INFO, logger="relohome_agent.agents.guardrails.shadow")
    inp, result = result_input()
    observer.observe_assessment(inp, result)
    observer.observe_assessment(inp, result.model_copy(update={"usage": AgentUsage()}))
    point = observer.metrics_snapshot()["points"]["assessment"]
    assert point["counters"]["seen"] == 2
    assert point["counters"]["eligible"] == 1
    assert point["skip_reasons"] == {"privacy_insufficient_evidence": 1, "deterministic": 1}
    assert point["coverage_ratio"] == 0
    await observer.close()
    assert calls == []
    assert "jev_metrics" in caplog.text
    assert "private-thread" not in caplog.text


@pytest.mark.asyncio
async def test_completed_coverage_excludes_duplicates_and_tracks_overload_and_bad_projection():
    release = asyncio.Event()

    async def provider(request):
        await release.wait()
        return httpx.Response(200, json=envelope())

    observer = ShadowGuardrail(JevClient("sk-or-v1-test", transport=httpx.MockTransport(provider)), max_pending=1)
    state, plan = plan_state()
    observer.observe_plan(state, plan)
    observer.observe_plan(state, plan)
    observer.observe_plan({**state, "request_id": "overloaded"}, plan)
    release.set()
    await asyncio.gather(*observer._tasks)
    invalid = {**state, "request_id": "oversized", "messages": [HumanMessage("x" * 4_001)]}
    observer.observe_plan(invalid, plan)
    observer.observe_plan({**state, "request_id": ""}, plan)
    snapshot = observer.metrics_snapshot()["points"]["plan"]
    assert snapshot["counters"]["seen"] == 5
    assert snapshot["counters"]["eligible"] == 4
    assert snapshot["counters"]["submitted"] == snapshot["counters"]["completed"] == 1
    assert snapshot["skip_reasons"] == {"turn_limit": 1, "overload": 1, "projection_skipped": 1, "missing_scope": 1}
    assert snapshot["coverage_ratio"] == 0.25
    assert snapshot["in_flight"] == 0
    await observer.close()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "error",
    [
        "timeout",
        "connection_error",
        "provider_error",
        "invalid_response",
        "response_limit",
        "private-user arbitrary exception",
    ],
)
async def test_failure_reason_is_separate_and_never_leaks_arbitrary_exception(error, caplog):
    client = Mock()

    async def decide(*args):
        raise JevError(error)

    async def close():
        pass

    client.decide = decide
    client.close = close
    observer = ShadowGuardrail(client)
    caplog.set_level(logging.INFO, logger="relohome_agent.agents.guardrails.shadow")
    state, plan = plan_state()
    observer.observe_plan(state, plan)
    await asyncio.gather(*observer._tasks)
    snapshot = observer.metrics_snapshot()["points"]["plan"]
    expected = error if not error.startswith("private") else "unavailable"
    assert snapshot["counters"][expected] == 1
    assert snapshot["coverage_ratio"] == 0
    assert snapshot["counters"]["completed"] == 0
    assert "private-user" not in caplog.text
    await observer.close()


@pytest.mark.asyncio
async def test_cancel_before_network_start_and_final_metrics_balance(caplog):
    calls = []

    def provider(request):
        calls.append(request)
        return httpx.Response(200, json=envelope())

    observer = ShadowGuardrail(JevClient("sk-or-v1-test", transport=httpx.MockTransport(provider)))
    caplog.set_level(logging.INFO, logger="relohome_agent.agents.guardrails.shadow")
    state, plan = plan_state()
    observer.observe_plan(state, plan)
    await observer.close()
    snapshot = observer.metrics_snapshot()["points"]["plan"]
    assert calls == []
    assert snapshot["counters"]["cancelled"] == 1
    assert snapshot["in_flight"] == 0
    assert snapshot["counters"]["submitted"] == snapshot["counters"]["cancelled"]
    assert observer._metrics_task.done()
    assert "jev_metrics" in caplog.text


@pytest.mark.asyncio
async def test_periodic_metrics_export_covers_skip_only_traffic_without_network(monkeypatch, caplog):
    monkeypatch.setattr("relohome_agent.agents.guardrails.shadow.METRICS_INTERVAL_S", 0.01)
    observer = ShadowGuardrail(
        JevClient("sk-or-v1-test", transport=httpx.MockTransport(lambda _: pytest.fail("No network")))
    )
    caplog.set_level(logging.INFO, logger="relohome_agent.agents.guardrails.shadow")
    state, plan = plan_state()
    observer.observe_plan({**state, "request_id": ""}, plan)
    async with asyncio.timeout(5):
        while not any(r.getMessage().startswith("jev_metrics ") for r in caplog.records):
            await asyncio.sleep(0.005)
    records = [r.getMessage() for r in caplog.records if r.getMessage().startswith("jev_metrics ")]
    assert records
    metric = json.loads(records[-1].removeprefix("jev_metrics "))
    assert metric["points"]["plan"]["skip_reasons"] == {"missing_scope": 1}
    assert "private-thread" not in json.dumps(metric)
    assert metric["points"]["assessment"]["coverage_ratio"] is None
    await observer.close()


@pytest.mark.asyncio
async def test_outbound_plan_payload_contains_only_minimized_structure():
    payloads = []

    def provider(request):
        payloads.append(json.loads(request.content))
        return httpx.Response(200, json=envelope())

    observer = ShadowGuardrail(JevClient("sk-or-v1-test", transport=httpx.MockTransport(provider)))
    state, plan = plan_state()
    state["messages"] = [HumanMessage("Nguyễn Văn Bí Mật ở số 17 ngõ 42 đường Riêng Tư")]
    state["intake"].user_confirmed_facts["near"] = fact("số 17 ngõ 42 đường Riêng Tư", "Nguyễn Văn Bí Mật")
    observer.observe_plan(state, plan)
    await asyncio.gather(*observer._tasks)
    assert len(payloads) == 1
    exported = json.dumps(payloads, ensure_ascii=False)
    assert "Bí Mật" not in exported and "Riêng Tư" not in exported
    assert payloads[0]["state"]["free_text_available"] is False
    assert payloads[0]["state"]["requested_domains"] == ["property"]
    await observer.close()


@pytest.mark.asyncio
async def test_skip_cardinality_and_ledger_capacity_metrics_are_fixed(monkeypatch):
    monkeypatch.setattr("relohome_agent.agents.guardrails.shadow.MAX_TRACKED_TURNS", 1)
    observer = ShadowGuardrail(
        JevClient("sk-or-v1-test", transport=httpx.MockTransport(lambda _: pytest.fail("Cancelled before network")))
    )
    state, plan = plan_state()
    observer.observe_plan(state, plan)
    observer.observe_plan({**state, "request_id": "another-private-request"}, plan)
    snapshot = observer.metrics_snapshot()
    assert snapshot["points"]["plan"]["skip_reasons"] == {"ledger_full": 1}
    assert snapshot["points"]["plan"]["counters"]["eligible"] == 2
    assert "another-private-request" not in json.dumps(snapshot)
    await observer.close()
    observer.observe_plan(state, plan)
    assert observer.metrics_snapshot()["points"]["plan"]["skip_reasons"]["closed"] == 1
