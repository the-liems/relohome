"""Opt-in real gateway/graph -> real Moving MCP -> AhaMove staging. No mocks.

MOVING_FORM_LIVE_INPUTS must contain operator-approved confirmed pickup/destination,
move_date, move_time and moving_options.service_id from the actual catalog.
Three tests make no model calls; SIU-auto requires an additional explicit paid opt-in.
The default suite skips these tests; it never substitutes invented provider results.
"""

import asyncio
import json
import os
import secrets
import socket
import subprocess
from copy import deepcopy
from datetime import timedelta
from pathlib import Path
from time import perf_counter
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio
from relohome_agent.agents.common import utcnow
from relohome_agent.agents.contracts import AgentTaskRequest
from relohome_agent.agents.graph import run_config
from relohome_agent.agents.models import (
    AgentBudget,
    AgentName,
    IntakeResult,
    Intent,
    Plan,
    RequestKind,
    Task,
    TaskStatus,
)
from relohome_agent.agents.subagents.base import to_task_result
from relohome_agent.agents.subagents.services.location import LocationSubagent
from relohome_agent.agents.wiring import AgentService
from relohome_agent.config import Settings
from relohome_agent.main import app

from tests import live

pytestmark = [
    pytest.mark.asyncio,
    pytest.mark.skipif(os.getenv("RUN_LIVE_MOVING_FORM") != "1", reason="Opt-in real staging form verification"),
]


@pytest_asyncio.fixture
async def runtime(tmp_path):
    settings = Settings(
        _env_file=None,
        agent_state_dir=str(tmp_path / "agent-runtime"),
        agent_subagents="live",
        agent_writes_enabled=False,
        agent_sandbox_payments_enabled=False,
        agent_allow_simulated_transactions=False,
        payment_simulation_enabled=False,
        flight_mcp_url="",
        payment_mcp_url="",
        moving_mcp_url=live.mcp_url("moving"),
        moving_mcp_auth_token=live.mcp_token("moving"),
        agent_api_token=secrets.token_urlsafe(32),
        openai_api_key=live.env_test("OPENAI_API_KEY", required=False),
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
    inputs = json.loads(live.env_test("MOVING_FORM_LIVE_INPUTS"))
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
    started = perf_counter()
    requote = await http.post(path, json=changed)
    assert requote.status_code == 200 and requote.json()["response"]["kind"] == "ANSWER", requote.text
    state = (await service.graph.aget_state(run_config(thread, service.deps))).values
    assert state["plan"].version == 2 and state["plan"].task(task.id)
    assert "selected:relocation" not in state["intake"].user_confirmed_facts
    assert state["task_results"][task.id].data["quote_id"] != result.data["quote_id"]
    assert state["intake"].constraints.values["move_time"] == changed["move_time"]
    assert not state["plan"].commit_actions and not state.get("committed")
    requoted = state["task_results"][task.id]
    assert requoted.usage.provider_calls == 1  # Fresh estimate; catalog reads hit the short-lived cache.
    assert requoted.usage.cached_calls >= 1
    print(
        json.dumps(
            {
                "case": "warm_requote",
                "elapsed_ms": round((perf_counter() - started) * 1000),
                "usage": requoted.usage.model_dump(),
                "agent_timing": requoted.data["agent_trace"]["timing"],
            }
        )
    )

    counts = await service.deps.usage.counts(thread)
    assert counts.llm_calls == counts.subagent_llm_calls == 0


async def test_real_catalog_cache_scope_expiry_and_detail_projection(runtime):
    from relohome_agent.agents.llm_context import model_json
    from relohome_agent.agents.subagents.services.moving_context import service_details_for_model

    service, http, body, _ = runtime
    moving = service.deps.agents.get(AgentName.RELOCATION)
    cache = moving.catalog_cache
    arguments = {k: body["pickup"][k] for k in ("lat", "lng")}
    catalog = await moving.moving.call("list_moving_services", arguments)
    assert catalog["services"]
    cache.put(arguments, catalog)
    returned = cache.get(arguments)
    returned["services"].clear()
    assert cache.get(arguments)["services"]  # Per-request mutation cannot poison another request.
    other_point = {k: body["destination"][k] for k in ("lat", "lng")}
    assert arguments != other_point and cache.get(other_point) is None
    assert cache.get({**arguments, "delivery_type": "TRUCK"}) is None
    response = await http.get("/api/v1/ui/moving/services", params=arguments)
    assert response.status_code == 200 and response.json()["services"]
    assert body["moving_options"]["service_id"] in {s["service_id"] for s in response.json()["services"]}
    cache.put(
        {**arguments, "delivery_type": "TRUCK"},
        await moving.moving.call("list_moving_services", {**arguments, "delivery_type": "TRUCK"}),
    )
    cache.invalidate(arguments)
    assert cache.get(arguments) is None and cache.get({**arguments, "delivery_type": "TRUCK"}) is None
    refreshed = await http.get("/api/v1/ui/moving/services", params={**arguments, "refresh": "true"})
    assert refreshed.status_code == 200 and cache.get(arguments)["services"]

    # Expiry uses actual monotonic time, not a substituted clock/provider result.
    cache.ttl_seconds = 0
    cache.clear()
    cache.put(arguments, catalog)
    assert cache.get(arguments) is None
    cache.ttl_seconds = 45
    observed = await moving.moving.call("get_moving_service", {"service_id": body["moving_options"]["service_id"]})
    original = deepcopy(observed)
    projection = service_details_for_model(observed)
    assert observed == original
    assert projection["service"]["service_id"] == observed["service"]["service_id"]
    assert "provider_data" not in projection["service"]
    assert len(projection["service"]["requests"]) == len(observed["service"]["requests"])
    for key, value in projection["service"].get("provider_constraints", {}).items():
        assert value == observed["service"]["provider_data"][key]
    before, after = len(model_json(observed).encode()), len(model_json(projection).encode())
    assert after < before
    print(
        json.dumps(
            {
                "case": "actual_detail_projection",
                "model_json_bytes_before": before,
                "model_json_bytes_after": after,
                "requests_preserved": len(projection["service"]["requests"]),
            }
        )
    )


async def test_real_gateway_authentication_quote_and_idempotent_replay(runtime):
    from relohome_gateway.server import create_app

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


@pytest.mark.skipif(os.getenv("RUN_LIVE_MOVING_BROWSER") != "1", reason="Separate real browser opt-in required")
async def test_real_browser_form_stays_open_and_retains_inputs(runtime, monkeypatch):
    import uvicorn
    from relohome_gateway.server import create_app

    service, _, _, tmp_path = runtime
    assert service.deps.agents.get(AgentName.RELOCATION).api_key == ""

    def free_port():
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            return sock.getsockname()[1]

    backend_port, gateway_port = free_port(), free_port()
    # The in-process gateway reads its backend URL and token from the environment.
    monkeypatch.setenv("LIFEFLOW_API_BASE_URL", f"http://127.0.0.1:{backend_port}/api/v1")
    monkeypatch.setenv("AGENT_API_TOKEN", service.settings.agent_api_token.get_secret_value())
    gateway = create_app(database=str(tmp_path / "browser.sqlite3"))
    servers = [
        uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=backend_port, lifespan="off", log_level="warning")),
        uvicorn.Server(uvicorn.Config(gateway, host="127.0.0.1", port=gateway_port, log_level="warning")),
    ]
    jobs = [asyncio.create_task(server.serve()) for server in servers]
    try:
        async with asyncio.timeout(20):
            while not all(server.started for server in servers):
                await asyncio.sleep(0.02)
        frontend = Path(__file__).resolve().parents[2] / "apps/web"
        env = {**os.environ, "MOVING_BROWSER_BASE_URL": f"http://127.0.0.1:{gateway_port}"}
        playwright_cli = subprocess.check_output(
            ["node", "-p", "require.resolve('@playwright/test/cli')"], cwd=frontend, text=True
        ).strip()
        result = await asyncio.to_thread(
            subprocess.run,
            [
                "node",
                playwright_cli,
                "test",
                "--config=playwright.live.config.ts",
            ],
            cwd=frontend,
            env=env,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=120,
        )
        print(result.stdout)
        assert result.returncode == 0, result.stderr + result.stdout
        for thread in gateway.state.store.all("SELECT id FROM threads"):
            counts = await service.deps.usage.counts(thread["id"])
            assert counts.llm_calls == counts.subagent_llm_calls == 0
    finally:
        for server in servers:
            server.should_exit = True
        await asyncio.gather(*jobs)


@pytest.mark.skipif(
    os.getenv("RUN_LIVE_MOVING_FORM_LLM") != "1", reason="Separate explicit paid LLM test budget required"
)
async def test_real_siu_vehicle_suggestion_at_most_two_model_calls(runtime):
    service, http, body, _ = runtime
    moving = service.deps.agents.get(AgentName.RELOCATION)
    moving.api_key = service.settings.openai_api_key.get_secret_value()
    moving.capability.default_budget.max_llm_calls = 2
    thread = "th_" + uuid4().hex
    request = {**body, "moving_options": {"remarks": "Vận chuyển vài thùng carton. Chỉ báo giá, chưa đặt đơn."}}
    started = perf_counter()
    response = await http.post(f"/api/v1/ui/chat/{thread}/moving/quote", json=request)
    state = (await service.graph.aget_state(run_config(thread, service.deps))).values
    task = next(t for t in state["plan"].tasks if t.agent == AgentName.RELOCATION)
    result = state["task_results"][task.id]
    print(
        json.dumps(
            {
                "case": "siu_auto",
                "http_status": response.status_code,
                "status": result.status,
                "elapsed_ms": round((perf_counter() - started) * 1000),
                "usage": result.usage.model_dump(),
                "agent_trace": result.data.get("agent_trace"),
                "error_code": result.error_code,
            },
            ensure_ascii=True,
        )
    )
    assert response.status_code == 200, response.text
    counts = await service.deps.usage.counts(thread)
    assert counts.llm_calls == 0  # No Intake/Planner calls.
    assert 1 <= counts.subagent_llm_calls <= 2
    assert 1 <= result.usage.llm_calls <= 2 and result.usage.tokens_in > 0
    assert result.status == "done", result.error
    assert response.json()["response"]["kind"] == "ANSWER"
    assert 1 <= len(result.data["quotes"]) <= 3
    assert all(item["id"] in result.source_refs and item["price_vnd"] > 0 for item in result.data["quotes"])
    assert result.data["agent_trace"]["mode"] == "structured-form"
    assert "finish" not in result.data["agent_trace"]["tools"]
    assert not state["plan"].commit_actions and not state.get("committed")
