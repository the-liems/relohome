"""Offline contract/privacy/lifecycle and graph-boundary regressions; no provider calls."""

import asyncio
import json
import logging
from contextvars import ContextVar
from dataclasses import replace
from unittest.mock import Mock

import httpx
import pytest
from langchain_core.messages import HumanMessage
from pydantic import ValidationError
from relohome_agent.agents.common import utcnow
from relohome_agent.agents.deps import test_deps
from relohome_agent.agents.graph import make_agent_node
from relohome_agent.agents.guardrails.jev import ENDPOINT, MODEL, JevClient, JevError, parse_decision
from relohome_agent.agents.guardrails.policy import PLAN_QUESTIONS
from relohome_agent.agents.guardrails.projection import (
    ProjectionLimitError,
    assessment_projection,
    plan_projection,
    safe_text,
    safe_value,
)
from relohome_agent.agents.guardrails.shadow import ShadowGuardrail, build_guardrail
from relohome_agent.agents.models import (
    AgentName,
    AgentUsage,
    Plan,
    PrefilledValue,
    RequestKind,
    SessionContext,
    Task,
    TaskResult,
)
from relohome_agent.agents.nodes.orchestrator import make_orchestrator
from relohome_agent.agents.planning import FixedPlanner
from relohome_agent.config import Settings

from tests.test_agents.helpers import fact, intake_result


def envelope(questions=PLAN_QUESTIONS, choice="supported"):
    return {
        "model": "typesafe/jev-1.13-20260917",
        "answers": {
            name: {
                "type": "choice",
                "choice": choice,
                "confidence": 0.9,
                "probabilities": {key: float(key == choice) for key in question["criteria"]},
            }
            for name, question in questions.items()
        },
        "usage": {"input_tokens": 321, "output_tokens": 22, "cost": 0.0001},
    }


def plan_state(kind=RequestKind.NEW_GOAL):
    plan = Plan(version=2, tasks=[Task(id="private-task", agent=AgentName.PROPERTY, inputs={"city": "hanoi"})])
    state = {
        "thread_id": "private-thread",
        "request_id": "private-request",
        "user_id": "private-user",
        "messages": [HumanMessage("Tìm nhà ở Hà Nội")],
        "intake": intake_result(kind, [AgentName.PROPERTY], facts={"city": fact("hanoi", "Hà Nội")}),
        "plan": plan,
        "session": SessionContext(),
    }
    return state, plan


def result_input(llm_calls=1, domain=AgentName.PROPERTY):
    state, plan = plan_state()
    inp = {**state, "task": plan.tasks[0], "user_request": "so sánh căn này"}
    result = TaskResult(
        task_id="private-task",
        agent=domain,
        plan_version=2,
        status="done",
        fetched_at=utcnow(),
        usage=AgentUsage(llm_calls=llm_calls),
        source_kind="live",
        data={
            "candidates": [{"title": "Phòng A", "price_vnd": 4_000_000}],
            "agent_assessment": {"reason": "Phòng A giá 4 triệu", "satisfaction": "fulfilled"},
        },
    )
    return inp, result


@pytest.mark.asyncio
async def test_exact_decisions_endpoint_and_batch_contract():
    calls = []

    async def provider(request):
        calls.append(json.loads(request.content))
        assert str(request.url) == ENDPOINT
        assert request.headers["Authorization"] == "Bearer sk-or-v1-test"
        return httpx.Response(200, json=envelope())

    client = JevClient("sk-or-v1-test", transport=httpx.MockTransport(provider))
    try:
        result = await client.decide({"request": "synthetic"}, PLAN_QUESTIONS)
        assert result.input_tokens == 321
        assert calls == [{"model": MODEL, "state": {"request": "synthetic"}, "questions": PLAN_QUESTIONS}]
    finally:
        await client.close()


@pytest.mark.parametrize(
    "mutation",
    [
        lambda value: value["answers"].pop("scope"),
        lambda value: value["answers"].update(extra={}),
        lambda value: value["answers"]["scope"].update(choice="publish"),
        lambda value: value["answers"]["scope"].update(type="noul"),
        lambda value: value["answers"]["scope"].update(confidence=float("nan")),
        lambda value: value["answers"]["scope"].update(confidence=True),
        lambda value: value["answers"]["scope"]["probabilities"].update(supported=0.1),
        lambda value: value["answers"]["scope"]["probabilities"].update(unsupported=-0.1),
        lambda value: value["usage"].update(input_tokens=True),
        lambda value: value["usage"].update(cost=float("inf")),
        lambda value: value.pop("usage"),
        lambda value: value.update(model="other-model"),
        lambda value: value.update(model="typesafe/jev-1.13-private-secret"),
    ],
)
def test_rejects_malformed_or_nonfinite_response(mutation):
    raw = envelope()
    mutation(raw)
    with pytest.raises(JevError, match="invalid_response"):
        parse_decision(raw, PLAN_QUESTIONS)


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [301, 401, 429, 500])
async def test_errors_never_echo_provider_body_or_follow_redirect(status):
    def provider(request):
        return httpx.Response(status, text="Bearer private-token", headers={"location": "https://malicious.invalid"})

    client = JevClient("sk-or-v1-test", transport=httpx.MockTransport(provider))
    try:
        with pytest.raises(JevError, match=r"^provider_error$"):
            await client.decide({}, PLAN_QUESTIONS)
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_timeout_has_no_retry_and_safe_code():
    calls = []

    async def provider(request):
        calls.append(request)
        await asyncio.sleep(1)

    client = JevClient("sk-or-v1-test", timeout_s=0.01, transport=httpx.MockTransport(provider))
    try:
        with pytest.raises(JevError, match=r"^timeout$"):
            await client.decide({}, PLAN_QUESTIONS)
        assert len(calls) == 1
    finally:
        await client.close()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "body,code",
    [(b"{", "invalid_response"), (b"x" * 64_001, "response_limit")],
    ids=["invalid-json", "oversized-response"],
)
async def test_invalid_json_and_reply_size_limit(body, code):
    client = JevClient("sk-or-v1-test", transport=httpx.MockTransport(lambda request: httpx.Response(200, content=body)))
    try:
        with pytest.raises(JevError, match=code):
            await client.decide({}, PLAN_QUESTIONS)
    finally:
        await client.close()


def test_plan_projection_omits_identity_contacts_coordinates_and_old_goal():
    state, plan = plan_state()
    state["messages"] = [HumanMessage("Tìm Hà Nội, liên hệ 0901234567 a@example.com Bearer abc-private")]
    state["intake"].user_confirmed_facts["phone"] = fact("0901234567", "0901234567")
    plan = plan.model_copy(
        update={
            "tasks": [
                plan.tasks[0].model_copy(
                    update={
                        "inputs": {
                            "city": "hanoi",
                            "near_coordinate": {"lat": 21.0123, "lng": 105.0123},
                            "token": "private-token",
                        }
                    }
                )
            ]
        }
    )
    output = plan_projection(state, plan)
    text = json.dumps(output)
    assert output["previous_plan"] == []
    for private in (
        "private-user",
        "private-task",
        "private-thread",
        "0901234567",
        "a@example.com",
        "abc-private",
        "21.0123",
    ):
        assert private not in text
    assert output["proposed_plan"][0]["omitted_input_count"] == 2


def test_followup_preserves_provenance_and_soft_preferences_not_consent():
    state, plan = plan_state(RequestKind.REFINE)
    state["intake"].prefilled["max_price_vnd"] = PrefilledValue(
        value=5_000_000, source="preference", last_confirmed_at=utcnow()
    )
    output = plan_projection(state, plan)
    assert output["previous_plan"]
    assert "evidence" not in output["confirmed_facts"]["city"]
    assert output["confirmed_facts"]["city"]["value"] == output["proposed_plan"][0]["inputs"]["city"]
    assert output["soft_preferences"] == {"max_price_vnd": 5_000_000}
    assert "max_price_vnd" not in output["confirmed_facts"]


@pytest.mark.parametrize(
    "text",
    [
        "Bearer abc-secret",
        "sk-or-v1-private",
        "token=private-token",
        "CF_Authorization=private-token",
        "https://example.com/?token=secret",
    ],
)
def test_scrubs_embedded_credentials_and_urls(text):
    assert "secret" not in safe_text(text)
    assert "private-token" not in safe_text(text)


def test_oversized_inputs_skip_not_silently_truncate():
    with pytest.raises(ProjectionLimitError):
        safe_text("x" * 4_001)
    with pytest.raises(ProjectionLimitError):
        safe_value([1] * 41, frozenset())
    with pytest.raises(ProjectionLimitError):
        safe_value(10**400, frozenset())


def test_cookie_header_is_redacted_as_a_whole():
    text = safe_text("Cookie: siu_session=private-cookie; CF_AppSession=private-app; cf_clearance=private-clearance")
    assert "private" not in text


def test_real_flight_and_housing_fact_fields_survive_projection():
    inp, result = result_input(domain=AgentName.FLIGHT)
    result.data = {
        "offers": [
            {
                "fare_vnd": 2_000_000,
                "depart_at": "2026-11-15T08:00:00",
                "baggage_kg": None,
                "carrier": "Synthetic Airlines",
            }
        ],
        "agent_assessment": {"reason": "Chưa biết hành lý"},
    }
    assert assessment_projection(inp, result, synthetic_text=True)["provider_facts"]["offers"] == result.data["offers"]
    inp, result = result_input()
    result.data["comparison"] = {
        "rows": [
            {
                "known_move_in_vnd": 8_000_000,
                "cost_basis": "rent_plus_deposit_only_not_final_total",
                "unknown_cost_fields": ["electricity", "water"],
            }
        ],
        "fees_verified": False,
    }
    assert assessment_projection(inp, result, synthetic_text=True)["provider_facts"]["comparison"] == result.data["comparison"]


@pytest.mark.asyncio
async def test_background_does_not_inherit_private_request_context():
    private_context = ContextVar("private_actor", default=None)
    token = private_context.set("private-user")
    observed = []

    def provider(request):
        observed.append(private_context.get())
        return httpx.Response(200, json=envelope())

    observer = ShadowGuardrail(JevClient("sk-or-v1-test", transport=httpx.MockTransport(provider)))
    try:
        state, plan = plan_state()
        observer.observe_plan(state, plan)
        await asyncio.gather(*observer._tasks)
        assert observed == [None]
    finally:
        private_context.reset(token)
        await observer.close()


@pytest.mark.asyncio
async def test_ledger_capacity_skips_without_eviction_or_cross_thread_reuse(monkeypatch):
    monkeypatch.setattr("relohome_agent.agents.guardrails.shadow.MAX_TRACKED_TURNS", 1)
    observer = ShadowGuardrail(JevClient("sk-or-v1-test"))
    state, plan = plan_state()
    observer.observe_plan(state, plan)
    observer.observe_plan({**state, "thread_id": "another-owner-thread"}, plan)
    assert observer.counts["submitted"] == 1
    assert observer.counts["ledger_full"] == 1
    assert len(observer._turns) == 1
    await observer.close()


def test_assessment_projection_restricts_evidence_and_excludes_raw_payload():
    inp, result = result_input()
    result.data.update(
        {
            "provider_data": {"token": "private-token"},
            "geometry": "map-secret",
            "details": {"private-provider-id": {"title": "A", "phone": "0901234567", "price_vnd": 4_000_000}},
        }
    )
    output = assessment_projection(inp, result, synthetic_text=True)
    assert output["provider_facts"]["details"] == [{"title": "A", "price_vnd": 4_000_000}]
    assert "private-provider-id" not in json.dumps(output)
    assert "private-token" not in json.dumps(output)
    assert "map-secret" not in json.dumps(output)


@pytest.mark.asyncio
async def test_shadow_submission_does_not_await_model_and_close_cancels():
    event = asyncio.Event()

    async def provider(request):
        event.set()
        await asyncio.Event().wait()

    observer = ShadowGuardrail(JevClient("sk-or-v1-test", transport=httpx.MockTransport(provider)))
    state, plan = plan_state()
    observer.observe_plan(state, plan)
    assert observer.counts["submitted"] == 1
    assert not event.is_set()  # Submission returned before the network task even started.
    await event.wait()
    await observer.close()
    assert observer.counts["cancelled"] == 1
    observer.observe_plan(state, plan)
    assert observer.counts["submitted"] == 1
    assert not observer._tasks and not observer._turns


@pytest.mark.asyncio
async def test_turn_limit_concurrency_cap_and_typed_ui_zero_calls(monkeypatch):
    # Admission contract independently of privacy exclusion of current narrative assessments.
    monkeypatch.setattr("relohome_agent.agents.guardrails.shadow.assessment_projection", lambda *_: {})
    observer = ShadowGuardrail(JevClient("sk-or-v1-test"), max_pending=2)
    state, plan = plan_state()
    inp, result = result_input()
    observer.observe_assessment(inp, result.model_copy(update={"usage": AgentUsage()}))
    assert observer.counts["submitted"] == 0
    observer.observe_plan(state, plan)
    observer.observe_plan(state, plan.model_copy(update={"version": 3}))
    observer.observe_assessment(inp, result)
    observer.observe_assessment(inp, result)
    observer.observe_plan({**state, "request_id": "second-turn"}, plan)
    assert observer.counts["submitted"] == 2
    assert observer.counts["turn_limit"] == 2
    assert observer.counts["overload"] == 1
    await observer.close()  # Cancel before any real network execution.


@pytest.mark.asyncio
async def test_audit_never_logs_input_or_private_scope(caplog):
    observer = ShadowGuardrail(
        JevClient("sk-or-v1-test", transport=httpx.MockTransport(lambda request: httpx.Response(200, json=envelope())))
    )
    state, plan = plan_state()
    caplog.set_level(logging.INFO, logger="relohome_agent.agents.guardrails.shadow")
    observer.observe_plan(state, plan)
    await asyncio.gather(*observer._tasks)
    assert "jev_shadow" in caplog.text
    for private in ("private-thread", "private-request", "private-user", "secret", "Hà Nội"):
        assert private not in caplog.text
    assert observer.counts["completed"] == 1
    await observer.close()


@pytest.mark.asyncio
async def test_unavailable_shadow_does_not_modify_plan_or_grant_permissions():
    observer = ShadowGuardrail(JevClient("sk-or-v1-test", transport=httpx.MockTransport(lambda request: httpx.Response(503))))
    state, plan = plan_state()
    planner = FixedPlanner(plan)
    planner.uses_llm = True
    deps = test_deps(Mock(), planner, guardrail=observer)
    output = await make_orchestrator(deps)(state)
    assert output["plan"].tasks == plan.tasks
    assert output["plan"].commit_actions == []
    await asyncio.gather(*observer._tasks)
    assert observer.counts["unavailable"] == 1
    await observer.close()


@pytest.mark.asyncio
async def test_invalid_and_non_llm_plans_never_submit():
    state, plan = plan_state()
    observer = Mock()
    planner = FixedPlanner(plan)
    deps = test_deps(Mock(), planner, guardrail=observer)
    await make_orchestrator(deps)(state)
    observer.observe_plan.assert_not_called()
    planner.uses_llm = True
    invalid = Plan(version=0, tasks=[plan.tasks[0].model_copy(update={"depends_on": ["missing-task"]})])
    invalid_planner = FixedPlanner(invalid)
    invalid_planner.uses_llm = True
    output = await make_orchestrator(replace(deps, planner=invalid_planner))(state)
    assert output["outcome"].code.name == "PLAN_INVALID"
    observer.observe_plan.assert_not_called()


@pytest.mark.asyncio
async def test_graph_agent_observer_is_after_llm_execution_and_readonly(monkeypatch):
    inp, result = result_input()
    inp.update({"allocated_llm_calls": 3, "attempt": 1, "plan_version": 2})
    observer = Mock()
    deps = test_deps(Mock(), FixedPlanner(plan_state()[1]), guardrail=observer)
    deps.agents.get(AgentName.PROPERTY).capability.uses_llm = True

    async def run(*args, **kwargs):
        return {"task_results": {result.task_id: result}}

    monkeypatch.setattr("relohome_agent.agents.execution.run_with_policy", run)
    output = await make_agent_node(deps, AgentName.PROPERTY)(inp)
    observer.observe_assessment.assert_called_once_with(inp, result)
    assert output["task_results"][result.task_id] is result


def test_flags_are_opt_in_and_openai_key_never_forwarded():
    assert build_guardrail(Settings(openai_api_key="sk-openai-private")) is None
    assert build_guardrail(Settings(agent_guardrail_mode="shadow", openai_api_key="sk-openai-private")) is None
    with pytest.raises(ValidationError):
        Settings(agent_guardrail_mode="enforce")
    with pytest.raises(ValidationError):
        Settings(agent_guardrail_timeout_s=60)


@pytest.mark.asyncio
async def test_openrouter_key_compatibility_and_explicit_override():
    for fields in (
        {"openai_api_key": "sk-or-v1-test"},
        {"openrouter_api_key": "sk-or-v1-test", "openai_api_key": "sk-openai-private"},
    ):
        observer = build_guardrail(Settings(agent_guardrail_mode="shadow", **fields))
        assert observer.client.http.headers["Authorization"] == "Bearer sk-or-v1-test"
        await observer.close()


def test_compose_routes_optional_secrets_to_backend_only():
    from pathlib import Path

    import yaml

    compose = yaml.safe_load((Path(__file__).resolve().parents[2] / "compose.coolify.yaml").read_text())
    assert compose["services"]["backend"]["environment"]["AGENT_GUARDRAIL_MODE"] == "${AGENT_GUARDRAIL_MODE:-off}"
    for name, service in compose["services"].items():
        if name != "backend":
            assert "OPENROUTER_API_KEY" not in service.get("environment", {})
