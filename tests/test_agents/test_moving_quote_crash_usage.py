"""Offline quote graph regressions: real agent, fixture MCP, no model/provider writes."""

import asyncio
import json
import sqlite3
import traceback
from dataclasses import replace
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from relohome_agent.agents.common import utcnow
from relohome_agent.agents.deps import AgentRegistry, default_deps
from relohome_agent.agents.graph import build_graph, default_checkpointer, run_config
from relohome_agent.agents.llm_runtime import Invocation, capture_invocation_usage
from relohome_agent.agents.models import AgentName, AgentUsage, Constraints, Task
from relohome_agent.agents.subagents.base import AgentPolicy, run_with_policy
from relohome_agent.agents.subagents.services.moving import QuoteContact
from relohome_agent.agents.subagents.services.moving_llm import FormQuoteAgent, MovingLlmAgent
from relohome_agent.api.moving_quotes import quote_form
from relohome_agent.api.moving_quotes import router as moving_quote_router
from relohome_agent.services.adapters.fakes import InMemoryUsageMeter
from relohome_agent.services.adapters.mcp import ToolCallError
from relohome_agent.services.adapters.sqlite_runtime import SqliteUsageMeter
from relohome_contracts.schemas import MovingQuoteForm
from relohome_privacy import redact_pii

from tests.test_agents.test_moving_suggestion_efficiency import Responses
from tests.test_agents.test_service_subagents import moving_client


@pytest.fixture(params=["memory", "sqlite"])
def ledger(request, tmp_path):
    if request.param == "memory":
        meter = InMemoryUsageMeter()
        yield meter, lambda: [row.usage for row in meter.subagents]
    else:
        connection = sqlite3.connect(tmp_path / "usage.sqlite3")
        connection.execute("CREATE TABLE usage(thread,request,kind,llm,paid,details)")
        meter = SqliteUsageMeter(SimpleNamespace(connection=connection))

        def records():
            return [
                AgentUsage.model_validate(json.loads(row[0]))
                for row in connection.execute("SELECT details FROM usage WHERE kind='subagent'")
            ]

        try:
            yield meter, records
        finally:
            connection.close()


def form(version=0, auto_suggest=False):
    return MovingQuoteForm(
        plan_version=version,
        pickup={"address": "Fixture A", "lat": 21.03, "lng": 105.8, "confirmed": True},
        destination={"address": "Fixture B", "lat": 21.04, "lng": 105.81, "confirmed": True},
        move_date=(utcnow() + timedelta(days=2)).date(),
        move_time="14:00",
        moving_options={} if auto_suggest else {"service_id": "SGN-TRUCK-500"},
    )


def service(meter, auto_suggest=False):
    client = moving_client()
    client.endpoint = SimpleNamespace(service="moving")
    client.handlers["estimate_move"]["quote"]["expires_at"] = (utcnow() + timedelta(minutes=4)).isoformat()
    agent = MovingLlmAgent("", "unused", client, contact=QuoteContact("Fixture contact", "19001234"))
    if auto_suggest:
        agent.api_key = "configured-fixture-key"
        agent.client = SimpleNamespace(responses=Responses(args={"service_ids": ["SGN-TRUCK-500"]}))
    deps = default_deps()
    deps = replace(
        deps,
        usage=meter,
        settings=deps.settings.model_copy(update={"max_paid_calls_per_thread": 1}),
        moving_quote_agent=FormQuoteAgent(agent),
        agents=AgentRegistry(
            {name: agent if name == AgentName.RELOCATION else deps.agents.get(name) for name in deps.agents.names()}
        ),
    )
    return SimpleNamespace(deps=deps, graph=build_graph(deps, default_checkpointer()), locks={}), client


@pytest.mark.asyncio
async def test_http_form_graph_preserves_redacted_vehicle_notes_before_one_model_selection(ledger):
    meter, records = ledger
    runtime, client = service(meter, auto_suggest=True)
    runtime.mode = "fake"  # Isolated offline API/graph fixture, not a production auth assertion.
    responses = runtime.deps.moving_quote_agent.agent.client.responses
    requirement = "Cần xe có bửng nâng, không dùng xe thùng hở"
    raw_note = requirement + "; gọi 0901234567 hoặc fixture@example.test"
    body = form(auto_suggest=True).model_dump(mode="json")
    body["moving_options"] = {"remarks": raw_note}
    app = FastAPI()
    app.state.agent_service = runtime
    app.include_router(moving_quote_router)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://fixture") as http:
        response = await http.post(
            "/ui/chat/fixture-remarks/moving/quote", json=body, headers={"X-User-Id": "fixture-owner"}
        )
    assert response.status_code == 200 and response.json()["response"]["kind"] == "ANSWER"
    assert len(responses.calls) == 1
    context = json.loads(responses.calls[0]["input"][0]["content"])
    assert context.get("remarks") == redact_pii(raw_note)
    assert requirement not in context["goal"] and requirement not in context["user_request"]
    assert "0901234567" not in json.dumps(context) and "fixture@example.test" not in json.dumps(context)
    estimate = next(arguments for name, arguments in client.calls if name == "estimate_move")
    assert estimate["draft"]["remarks"] == redact_pii(raw_note)
    assert records() == [AgentUsage(llm_calls=1, tokens_in=700, tokens_out=30, provider_calls=2)]


@pytest.mark.asyncio
@pytest.mark.parametrize("catalog_kind", ["repeated", "trace-sized"])
async def test_http_form_graph_quotes_from_large_catalog_once_with_redacted_notes_and_safe_trace(ledger, catalog_kind):
    from relohome_agent.agents.subagents.services.moving_context import selection_catalog_for_model

    from tests.test_agents.test_moving_large_catalog import expand_catalog, install_catalog, install_trace_sized_catalog

    meter, records = ledger
    runtime, client = service(meter, auto_suggest=True)
    runtime.mode = "fake"
    services, selected = (
        install_trace_sized_catalog(client)
        if catalog_kind == "trace-sized"
        else install_catalog(client, 60, repeated_rules=True)
    )
    responses = runtime.deps.moving_quote_agent.agent.client.responses
    responses.output.output[0].arguments = json.dumps({"service_ids": [selected]})
    note = "Cần xe có bửng nâng, không dùng xe thùng hở; gọi 0901234567"
    body = form(auto_suggest=True).model_dump(mode="json")
    body["moving_options"] = {"remarks": note}
    app = FastAPI()
    app.state.agent_service = runtime
    app.include_router(moving_quote_router)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://fixture") as http:
        response = await http.post(
            "/ui/chat/fixture-large-catalog/moving/quote", json=body, headers={"X-User-Id": "fixture-owner"}
        )
    assert response.status_code == 200 and response.json()["response"]["kind"] == "ANSWER"
    assert len(responses.calls) == 1 and len(client.calls) == 2
    context = json.loads(responses.calls[0]["input"][0]["content"])
    assert expand_catalog(context) == selection_catalog_for_model({s["service_id"]: s for s in services})
    assert context["remarks"] == redact_pii(note)
    assert client.calls[-1][1]["services"] == [{"service_id": selected}]
    assert records() == [AgentUsage(llm_calls=1, tokens_in=700, tokens_out=30, provider_calls=2)]
    values = (await runtime.graph.aget_state(run_config("fixture-large-catalog", runtime.deps))).values
    result = next(iter(values["task_results"].values()))
    data = result.data if hasattr(result, "data") else result["data"]
    trace = data["agent_trace"]["catalog_selection"]
    assert trace["service_count"] == len(services) and trace["status"] == "ready"
    assert trace["request_bytes"] <= trace["request_byte_limit"]
    assert "0901234567" not in json.dumps(trace) and "district-" not in json.dumps(trace)
    assert not values.get("committed") and not values["plan"].commit_actions


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["missing_quote_id", "unexpected_runtime_error"])
@pytest.mark.parametrize("auto_suggest", [False, True])
async def test_crashed_quote_records_actual_usage_once_and_blocks_retry(ledger, failure, auto_suggest):
    meter, records = ledger
    runtime, client = service(meter, auto_suggest=auto_suggest)
    original = RuntimeError("fixture estimate crashed")
    if failure == "missing_quote_id":
        del client.handlers["estimate_move"]["quote"]["quote_id"]
        error_type = KeyError
    else:

        def crash(_):
            raise original

        client.handlers["estimate_move"] = crash
        error_type = RuntimeError
    thread = "th_" + uuid4().hex
    with pytest.raises(error_type) as error:
        await quote_form(thread, form(auto_suggest=auto_suggest), runtime, "fixture-owner")
    if failure == "unexpected_runtime_error":
        assert error.value is original
    else:
        assert error.value.args == ("quote_id",)
    assert "call" in [frame.name for frame in traceback.extract_tb(error.value.__traceback__)]
    assert [name for name, _ in client.calls] == ["list_moving_services", "estimate_move"]
    assert records() == [
        AgentUsage(provider_calls=2, llm_calls=1, tokens_in=700, tokens_out=30)
        if auto_suggest
        else AgentUsage(provider_calls=2)
    ]
    assert (await meter.counts(thread)).paid_calls == 1
    assert (await meter.counts(thread)).subagent_llm_calls == int(auto_suggest)
    values = (await runtime.graph.aget_state(run_config(thread, runtime.deps))).values
    assert values["plan"].version == 1
    assert not values["plan"].commit_actions and not values.get("committed")
    with pytest.raises(HTTPException) as retry:
        await quote_form(thread, form(version=1, auto_suggest=auto_suggest), runtime, "fixture-owner")
    assert retry.value.status_code == 429
    assert len(client.calls) == 2 and len(records()) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("outcome", ["success", "provider_error", "expired", "needs_input"])
async def test_normal_quote_results_keep_existing_usage_without_double_recording(ledger, outcome):
    meter, records = ledger
    runtime, client = service(meter)
    expected = "ANSWER"
    if outcome == "provider_error":

        def rejected(_):
            raise ToolCallError("UNAVAILABLE", "fixture unavailable", retryable=True)

        client.handlers["estimate_move"] = rejected
        expected = "ERROR"
    elif outcome == "expired":
        client.handlers["estimate_move"]["quote"]["expires_at"] = (utcnow() - timedelta(minutes=1)).isoformat()
        expected = "ERROR"
    elif outcome == "needs_input":
        client.handlers["list_moving_services"] = {"services": []}
        expected = "CLARIFY"
    thread = "th_" + uuid4().hex
    reply = await quote_form(thread, form(), runtime, "fixture-owner")
    assert reply.response["kind"] == expected
    assert records() == [AgentUsage(provider_calls=2)]
    assert (await meter.counts(thread)).subagent_llm_calls == 0
    values = (await runtime.graph.aget_state(run_config(thread, runtime.deps))).values
    assert values["moving_quote_context"] is None
    assert not values["plan"].commit_actions


def policy_input(thread="fixture-thread"):
    return dict(
        task=Task(id="moving", agent=AgentName.RELOCATION, inputs={}),
        allocated_llm_calls=3,
        user_id="fixture-owner",
        plan_version=1,
        attempt=1,
        request_id="fixture-request",
        thread_id=thread,
        constraints=Constraints(),
        goal="",
        user_request="",
        hints={},
        upstream={},
    )


@pytest.mark.asyncio
async def test_crash_keeps_original_exception_when_usage_sink_also_fails():
    runtime, _ = service(InMemoryUsageMeter())
    original = ValueError("fixture original cause")

    async def crash(req):
        invocation = Invocation()
        invocation.usage.provider_calls = 2
        invocation.usage.llm_calls = 1
        invocation.usage.tokens_in = 27
        invocation.usage.tokens_out = 9
        raise original

    record = AsyncMock(side_effect=RuntimeError("fixture ledger failure"))
    agent = SimpleNamespace(capability=runtime.deps.moving_quote_agent.capability, run=crash)
    with pytest.raises(ValueError) as error:
        await run_with_policy(
            agent, policy_input(), policy=AgentPolicy(raise_unexpected=True), clock=utcnow, record=record
        )
    assert error.value is original
    record.assert_awaited_once()
    assert record.await_args.args[1].usage == AgentUsage(provider_calls=2, llm_calls=1, tokens_in=27, tokens_out=9)


@pytest.mark.asyncio
async def test_chat_policy_still_converts_unexpected_errors_and_records_once():
    runtime, _ = service(InMemoryUsageMeter())

    async def crash(req):
        raise ValueError("fixture chat error")

    agent = SimpleNamespace(capability=runtime.deps.moving_quote_agent.capability, run=crash)
    record = AsyncMock()
    update = await run_with_policy(agent, policy_input(), policy=AgentPolicy(), clock=utcnow, record=record)
    assert update["task_results"]["moving"].status == "failed"
    assert update["task_results"]["moving"].error_code == "internal"
    record.assert_awaited_once()


@pytest.mark.asyncio
async def test_concurrent_crashes_capture_separate_child_task_counters():
    runtime, _ = service(InMemoryUsageMeter())
    records = []
    first_started, second_started = asyncio.Event(), asyncio.Event()

    async def crash(req):
        invocation = Invocation()
        first = req.thread_id == "first"
        invocation.usage.provider_calls = 2 if first else 5
        invocation.usage.llm_calls = 1 if first else 2
        invocation.usage.tokens_in = 10 if first else 20
        (first_started if first else second_started).set()
        await (second_started if first else first_started).wait()
        raise ValueError(req.thread_id)

    async def record(req, result, elapsed):
        records.append((req.thread_id, result.usage))

    agent = SimpleNamespace(capability=runtime.deps.moving_quote_agent.capability, run=crash)
    outputs = await asyncio.gather(
        *(
            run_with_policy(
                agent, policy_input(thread), policy=AgentPolicy(raise_unexpected=True), clock=utcnow, record=record
            )
            for thread in ("first", "second")
        ),
        return_exceptions=True,
    )
    assert all(isinstance(error, ValueError) for error in outputs)
    assert dict(records) == {
        "first": AgentUsage(provider_calls=2, llm_calls=1, tokens_in=10),
        "second": AgentUsage(provider_calls=5, llm_calls=2, tokens_in=20),
    }
    # A later invocation cannot append to a completed request's capture.
    Invocation().usage.provider_calls = 100
    assert dict(records)["first"].provider_calls == 2


def test_nested_usage_capture_restores_parent_and_returns_detached_snapshots():
    with capture_invocation_usage() as outer:
        first = Invocation()
        first.usage.provider_calls = 2
        with capture_invocation_usage() as inner:
            Invocation().usage.provider_calls = 9
        Invocation().usage.cached_calls = 3
        snapshot = outer.snapshot()
    assert snapshot == AgentUsage(provider_calls=2, cached_calls=3)
    assert inner.snapshot() == AgentUsage(provider_calls=9)
    first.usage.provider_calls = 20
    assert snapshot.provider_calls == 2
