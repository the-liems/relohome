"""Opt-in real gateway/graph -> real Moving MCP -> AhaMove staging. No model calls or mocks.

MOVING_FORM_LIVE_INPUTS must contain operator-approved confirmed pickup/destination,
move_date, move_time and moving_options.service_id from the actual catalog.
The default suite skips these tests; it never substitutes invented provider results.
"""

import json
import os
import secrets
from copy import deepcopy
from datetime import timedelta
from time import perf_counter
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio

from src.agents.common import utcnow
from src.agents.contracts import AgentTaskRequest
from src.agents.graph import run_config
from src.agents.models import AgentBudget, AgentName, IntakeResult, Intent, Plan, RequestKind, Task, TaskStatus
from src.agents.subagents.base import to_task_result
from src.agents.subagents.services.location import LocationSubagent
from src.agents.wiring import AgentService
from src.main import app
from src.services.adapters.registry import ServiceSettings

pytestmark = [
    pytest.mark.asyncio,
    pytest.mark.skipif(os.getenv("RUN_LIVE_MOVING_FORM") != "1", reason="Opt-in real staging form verification"),
]


@pytest_asyncio.fixture
async def runtime(tmp_path):
    settings = ServiceSettings(
        _env_file=None,
        agent_state_dir=str(tmp_path / "agent-runtime"),
        agent_subagents="live",
        agent_writes_enabled=False,
        agent_sandbox_payments_enabled=False,
        agent_allow_simulated_transactions=False,
        payment_simulation_enabled=False,
        flight_mcp_stdio=False,
        flight_mcp_url="",
        payment_mcp_stdio=False,
        payment_mcp_url="",
    )
    assert settings.moving_environment == "staging"
    async with httpx.AsyncClient() as http:
        base = settings.moving_mcp_url.removesuffix("/mcp")
        health = await http.get(base + "/health")
        assert health.is_success and health.json()["environment"] == "staging"
        assert (await http.get(base + "/ready")).is_success
    service = await AgentService.open(settings)
    moving = service.deps.agents.get(AgentName.RELOCATION)
    # Empty domain key prevents even an accidental model decision from spending credits.
    # Intake/Planner are not invoked by this typed route; the usage ledger verifies that.
    moving.api_key = ""
    previous = getattr(app.state, "agent_service", None)
    app.state.agent_service = service
    headers = {"Authorization": "Bearer " + settings.agent_api_token.get_secret_value(), "X-User-Id": uuid4().hex}
    inputs = json.loads(os.environ["MOVING_FORM_LIVE_INPUTS"])
    assert inputs["moving_options"]["service_id"], "Explicit observed service choice required"
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://backend", headers=headers
        ) as client:
            yield service, client, {**inputs, "plan_version": 0}, tmp_path
    finally:
        app.state.agent_service = previous
        await service.close()


async def test_real_form_quote_selection_requote_and_rejections(runtime):
    service, http, body, _ = runtime
    thread = "th_" + uuid4().hex
    path = f"/api/v1/ui/chat/{thread}/moving/quote"
    started = perf_counter()
    response = await http.post(path, json=body)
    assert response.status_code == 200, response.text
    assert response.json()["response"]["kind"] == "ANSWER", response.text
    state = (await service.graph.aget_state(run_config(thread, service.deps))).values
    task = next(t for t in state["plan"].tasks if t.agent == AgentName.RELOCATION)
    result = state["task_results"][task.id]
    assert result.status == "done" and result.source_kind == "sandbox"
    assert len(result.data["quotes"]) == 1 and result.source_refs
    assert result.data["quotes"][0]["service_id"] == body["moving_options"]["service_id"]
    assert result.data["quotes"][0]["price_vnd"] > 0
    assert result.usage.llm_calls == result.usage.tokens_in == result.usage.tokens_out == 0
    assert result.usage.provider_calls in {2, 3}  # Catalog may need the separate TRUCK query.
    assert result.data["agent_trace"]["uses_llm"] is False
    assert not state["plan"].commit_actions and not state.get("committed")
    elapsed = round((perf_counter() - started) * 1000)
    print(
        json.dumps(
            {
                "case": "explicit_service",
                "elapsed_ms": elapsed,
                "agent_timing": result.data["agent_trace"]["timing"],
                "llm_calls": 0,
            }
        )
    )
    initial_counts = await service.deps.usage.counts(thread)
    assert initial_counts.llm_calls == initial_counts.subagent_llm_calls == 0

    selected = await http.post(
        f"/api/v1/ui/chat/{thread}/action",
        json={
            "kind": "select",
            "task_id": task.id,
            "plan_version": 1,
            "fetched_at": result.fetched_at.isoformat(),
            "entity_id": result.data["quotes"][0]["id"],
        },
    )
    assert selected.status_code == 200, selected.text
    state = (await service.graph.aget_state(run_config(thread, service.deps))).values
    assert "selected:relocation" in state["intake"].user_confirmed_facts

    # All of these rejections must happen before a new provider or model call.
    stale = await http.post(path, json=body)
    assert stale.status_code == 409
    wrong_owner = await http.post(path, json={**body, "plan_version": 1}, headers={"X-User-Id": uuid4().hex})
    assert wrong_owner.status_code == 404
    no_auth = await http.post(path, json=body, headers={"Authorization": ""})
    assert no_auth.status_code == 401
    for invalid in (
        {**body, "plan_version": 1, "move_date": (utcnow() - timedelta(days=1)).date().isoformat()},
        {**body, "plan_version": 1, "approval_id": uuid4().hex},
        {**body, "plan_version": 1, "pickup": {**body["pickup"], "confirmed": False}},
        {**body, "plan_version": 1, "destination_listing_id": uuid4().hex},
    ):
        rejected = await http.post(path, json=invalid)
        assert rejected.status_code in {409, 422}, rejected.text
    assert await service.deps.usage.counts(thread) == initial_counts

    changed = deepcopy(body)
    changed.update(plan_version=1, move_time="11:00" if body["move_time"] != "11:00" else "12:00")
    requote = await http.post(path, json=changed)
    assert requote.status_code == 200 and requote.json()["response"]["kind"] == "ANSWER", requote.text
    state = (await service.graph.aget_state(run_config(thread, service.deps))).values
    assert state["plan"].version == 2 and state["plan"].task(task.id)
    assert "selected:relocation" not in state["intake"].user_confirmed_facts
    assert state["task_results"][task.id].data["quote_id"] != result.data["quote_id"]
    assert state["intake"].constraints.values["move_time"] == changed["move_time"]
    assert not state["plan"].commit_actions and not state.get("committed")

    counts = await service.deps.usage.counts(thread)
    assert counts.llm_calls == counts.subagent_llm_calls == 0


async def test_real_gateway_authentication_quote_and_idempotent_replay(runtime):
    from Frontend.server import create_app

    service, _, body, tmp_path = runtime
    gateway = create_app(database=str(tmp_path / "web.sqlite3"), transport=httpx.ASGITransport(app=app))
    async with gateway.router.lifespan_context(gateway):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=gateway), base_url="http://gateway", headers={"X-SIU-Request": "1"}
        ) as browser:
            credentials = {
                "name": "Moving verification",
                "email": uuid4().hex + "@example.invalid",
                "password": secrets.token_urlsafe(24),
            }
            registered = await browser.post("/web/api/auth/register", json=credentials)
            assert registered.status_code == 200
            thread = (await browser.post("/web/api/threads")).json()["id"]
            path = f"/web/api/threads/{thread}/moving/quote"
            payload = {**body, "request_id": uuid4().hex}
            csrf = await browser.post(path, json=payload, headers={"X-SIU-Request": "0"})
            assert csrf.status_code == 403
            response = await browser.post(path, json=payload)
            assert response.status_code == 200, response.text
            snapshot = response.json()
            assert snapshot["state"]["plan"]["version"] == 1
            assert snapshot["messages"][-1]["content"]["response"]["kind"] == "ANSWER"
            counts = await service.deps.usage.counts(thread)
            replay = await browser.post(path, json=payload)
            assert replay.status_code == 200
            assert await service.deps.usage.counts(thread) == counts
            assert counts.llm_calls == counts.subagent_llm_calls == 0
            conflict = await browser.post(path, json={**payload, "move_time": "12:00"})
            assert conflict.status_code == 409


async def test_form_preserves_real_housing_result_and_selection(runtime):
    """Seed the checkpoint with an actual Location read, not a fabricated listing/price.

    This isolates checkpoint preservation without rerunning the paid Housing LLM.
    It is not evidence for conversational Housing -> Moving interpretation.
    """
    service, http, body, _ = runtime
    thread = "th_" + uuid4().hex
    owner = http.headers["X-User-Id"]
    location_client = service.deps.agents.get(AgentName.PROPERTY).client
    task = Task(
        id="housing-" + uuid4().hex[:12],
        agent=AgentName.PROPERTY,
        inputs={
            "near": body["destination"]["address"],
            "near_coordinate": {k: body["destination"][k] for k in ("lat", "lng")},
            "search_radius_m": 20000,
            "limit": 5,
        },
    )
    request = AgentTaskRequest(
        request_id=uuid4().hex,
        thread_id=thread,
        task_id=task.id,
        plan_version=1,
        attempt=1,
        agent=AgentName.PROPERTY,
        inputs=task.inputs,
        budget=AgentBudget(max_llm_calls=0, max_provider_calls=8),
    )
    observed = await LocationSubagent(location_client, AgentName.PROPERTY).run(request)
    assert observed.status == "done" and observed.data.get("candidates")
    result = to_task_result(observed, request)
    assert result.source_kind == "live" and result.source_refs
    intake = IntakeResult(kind=RequestKind.NEW_GOAL, intent=Intent(name="housing", domains=[AgentName.PROPERTY]))
    await service.graph.aupdate_state(
        run_config(thread, service.deps),
        {
            "thread_id": thread,
            "user_id": owner,
            "request_id": request.request_id,
            "plan": Plan(version=1, tasks=[task]),
            "intake": intake,
            "task_results": {task.id: result},
            "task_status": {task.id: TaskStatus.DONE},
        },
        as_node="respond",
    )
    house = result.data["candidates"][0]
    selected = await http.post(
        f"/api/v1/ui/chat/{thread}/action",
        json={
            "kind": "select",
            "task_id": task.id,
            "plan_version": 1,
            "fetched_at": result.fetched_at.isoformat(),
            "entity_id": house["id"],
        },
    )
    assert selected.status_code == 200, selected.text
    before = (await service.graph.aget_state(run_config(thread, service.deps))).values
    response = await http.post(f"/api/v1/ui/chat/{thread}/moving/quote", json={**body, "plan_version": 1})
    assert response.status_code == 200 and response.json()["response"]["kind"] == "ANSWER", response.text
    after = (await service.graph.aget_state(run_config(thread, service.deps))).values
    assert after["plan"].task(task.id) == before["plan"].task(task.id)
    assert after["task_results"][task.id] == before["task_results"][task.id]
    assert after["task_status"][task.id] == TaskStatus.DONE
    assert (
        after["intake"].user_confirmed_facts["selected:property"]
        == before["intake"].user_confirmed_facts["selected:property"]
    )
    assert after["plan"].version == 2 and len(after["plan"].tasks) == 2
    assert (await service.deps.usage.counts(thread)).subagent_llm_calls == 0
