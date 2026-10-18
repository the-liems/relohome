"""Issue #84: actual Location MCP, LangGraph checkpoints and API, no mocked provider.

Opt in RUN_HOUSING_VIEWING_LIVE=1 with configuration injected by the live-test command.
Uses an isolated temporary state database; no LLM, booking or payment calls.
Only scheduling/decision records in that private database are written.
"""

import asyncio
import os
import secrets
from dataclasses import replace
from datetime import datetime
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from relohome_agent.agents.common import utcnow
from relohome_agent.agents.graph import run_config
from relohome_agent.agents.models import (
    AgentName,
    IntakeResult,
    Intent,
    Plan,
    RequestKind,
    Task,
    TaskResult,
    TaskStatus,
)
from relohome_agent.agents.subagents.services.location import to_candidate
from relohome_agent.agents.wiring import AgentService
from relohome_agent.api import routes, viewings, web_actions
from relohome_agent.config import Settings

from tests import live

pytestmark = pytest.mark.skipif(
    os.getenv("RUN_HOUSING_VIEWING_LIVE") != "1", reason="Opt-in real Location MCP and isolated graph state"
)


@pytest.mark.asyncio
async def test_real_api_decision_retry_concurrency_and_paid_protection(tmp_path):
    settings = Settings(
        agent_subagents="live",
        agent_state_dir=str(tmp_path / "runtime"),
        agent_writes_enabled=False,
        agent_sandbox_payments_enabled=False,
        agent_allow_simulated_transactions=False,
        payment_simulation_enabled=False,
        app_payment_demo_enabled=False,
        housing_viewing_enabled=True,
        location_mcp_url=live.mcp_url("location"),
        location_mcp_auth_token=live.mcp_token("location"),
        # This isolated runtime owns its API token; the shell's token is never used.
        agent_api_token=secrets.token_urlsafe(32),
    )
    service = await AgentService.open(settings)
    try:
        raw = await web_actions.client_for(service, AgentName.PROPERTY).call(
            "search_housing", {"price_period": "month", "currency": "VND", "pagination": {"limit": 20, "cursor": None}}
        )
        candidates = [to_candidate(row, [])[0] for row in raw["results"]]
        candidates = [c for c in candidates if c.get("price_vnd") and c.get("address")][:2]
        assert len(candidates) == 2, "Need two actual eligible listings; never substitute fake data"
        thread, user, task_id = "review84_" + uuid4().hex, "review84", "housing"
        fetched_at = utcnow()
        result = TaskResult(
            task_id=task_id,
            agent=AgentName.PROPERTY,
            plan_version=1,
            status="done",
            data={"candidates": candidates},
            source="lifeflow-location",
            source_kind="live",
            source_refs=[c["id"] for c in candidates],
            fetched_at=fetched_at,
        )
        await service.graph.aupdate_state(
            run_config(thread, service.deps),
            {
                "user_id": user,
                "thread_id": thread,
                "request_id": uuid4().hex,
                "intake": IntakeResult(
                    kind=RequestKind.NEW_GOAL, intent=Intent(name="housing", domains=[AgentName.PROPERTY])
                ),
                "plan": Plan(version=1, tasks=[Task(id=task_id, agent=AgentName.PROPERTY, goal="View actual homes")]),
                "task_status": {task_id: TaskStatus.DONE},
                "task_results": {task_id: result},
            },
            as_node="respond",
        )
        app = FastAPI()
        app.state.agent_service = service
        for router in (routes.router, web_actions.router, viewings.router):
            app.include_router(router, prefix="/api/v1")
        headers = {"Authorization": "Bearer " + settings.agent_api_token.get_secret_value(), "X-User-Id": user}
        base = f"/api/v1/ui/chat/{thread}"
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://isolated") as client:

            async def post(path, payload):
                return await client.post(base + path, headers=headers, json=payload)

            for candidate in candidates:
                response = await post(
                    "/action",
                    {
                        "kind": "select",
                        "task_id": task_id,
                        "plan_version": 1,
                        "fetched_at": fetched_at.isoformat(),
                        "entity_id": candidate["id"],
                    },
                )
                assert response.status_code == 200, response.text
            listing_id = candidates[0]["id"]
            slot = service.viewing.slots()[0]
            response = await post("/viewings/schedule", {"listing_id": listing_id, "slot": slot})
            assert response.status_code == 200, response.text
            # Explicit test-only time bypass in this isolated runtime, not the real application's configuration.
            service.viewing.settings = replace(service.viewing.settings, visit_anytime=True)
            response = await post("/viewings/visit", {"listing_id": listing_id, "outcome": "met_agreed"})
            assert response.status_code == 200, response.text
            payload = {
                "listing_id": listing_id,
                "rent_vnd": candidates[0]["price_vnd"],
                "deposit_vnd": candidates[0].get("deposit_vnd") or candidates[0]["price_vnd"],
                "decision_key": uuid4().hex,
                "keep_listing_ids": [candidates[1]["id"]],
            }
            # Both actual HTTP handlers start together. One owns the entire thread until completion.
            responses = await asyncio.gather(
                post("/viewings/decide", payload),
                post("/viewings/decide", payload),
                post("/viewings/unselect", {"listing_id": candidates[1]["id"]}),
            )
            assert sorted(r.status_code for r in responses) == [200, 409, 409], [r.text for r in responses]
            replay = await post("/viewings/decide", payload)
            assert replay.status_code == 200, replay.text
            changed = await post("/viewings/decide", {**payload, "deposit_vnd": payload["deposit_vnd"] + 1})
            assert changed.status_code == 409 and changed.json()["code"] == "decision_payload_mismatch"
            snapshot = await service.graph.aget_state(run_config(thread, service.deps))
            assert snapshot.values["intake"].user_confirmed_facts["selected:property"].value == listing_id
            assert service.viewing._item(user, thread, listing_id).status == "agreed"
            for outcome in ("missed", "met_rejected"):
                response = await post("/viewings/visit", {"listing_id": listing_id, "outcome": outcome})
                assert response.status_code == 409 and response.json()["code"] == "visit_state_conflict"
            response = await post("/viewings/reopen", {})
            assert response.status_code == 200, response.text
            response = await post("/viewings/decide", payload)
            assert response.status_code == 409 and response.json()["code"] == "decision_stale"
            payload["decision_key"] = uuid4().hex
            response = await post("/viewings/decide", payload)
            assert response.status_code == 200, response.text
            response = await post(
                "/viewings/paid", {"amount_vnd": payload["deposit_vnd"], "paid_on": datetime.now().date().isoformat()}
            )
            assert response.status_code == 200, response.text
            response = await post("/viewings/visit", {"listing_id": listing_id, "outcome": "missed"})
            assert response.status_code == 409 and response.json()["code"] == "visit_state_conflict"
            assert service.viewing._item(user, thread, listing_id).status == "reported_paid"
    finally:
        await service.close()
