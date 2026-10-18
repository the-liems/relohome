"""`/chat/{id}/state` trả lựa chọn của người dùng đọc từ kết quả provider trong state, không từ client."""

import httpx
import pytest
from fastapi import FastAPI
from relohome_agent.agents.common import utcnow
from relohome_agent.agents.graph import run_config
from relohome_agent.agents.models import (
    AgentName,
    ConfirmedFact,
    Constraints,
    IntakeResult,
    Intent,
    RequestKind,
    TaskResult,
    TaskStatus,
)
from relohome_agent.agents.wiring import AgentService
from relohome_agent.api.routes import router
from relohome_agent.config import Settings


@pytest.mark.asyncio
async def test_state_exposes_the_chosen_home_from_provider_results():
    service = AgentService.create(services=Settings(_env_file=None, agent_subagents="fake"))
    app = FastAPI()
    app.state.agent_service = service
    app.include_router(router)
    home = {"id": "map-1", "title": "Căn trên bản đồ", "address": "255 Cầu Giấy, Hà Nội", "lat": 21.03, "lng": 105.8}
    facts = {"selected:property": ConfirmedFact(value="map-1", evidence="Chọn căn này", stated_at=utcnow())}
    await service.graph.aupdate_state(
        run_config("th-state", service.deps),
        {
            "user_id": "alice",
            "thread_id": "th-state",
            "intake": IntakeResult(
                kind=RequestKind.NEW_GOAL,
                intent=Intent(name="housing", domains=[AgentName.PROPERTY]),
                constraints=Constraints(),
                user_confirmed_facts=facts,
            ),
            "task_results": {
                "t1": TaskResult(
                    task_id="t1",
                    agent=AgentName.PROPERTY,
                    plan_version=1,
                    status="done",
                    fetched_at=utcnow(),
                    data={"candidates": [{"id": "other", "title": "Căn khác"}, home]},
                )
            },
            "task_status": {"t1": TaskStatus.DONE},
            "goal_tasks": {"t1": {"agent": AgentName.PROPERTY.value, "inputs": {}, "depends_on": []}},
            "goal_selections": {"t1": "map-1"},
        },
        as_node="respond",
    )
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        state = (await client.get("/chat/th-state/state", headers={"X-User-Id": "alice"})).json()
    assert state["selections"] == {"property": home}
    await service.graph.aupdate_state(
        run_config("th-state", service.deps),
        {
            "intake": IntakeResult(
                kind=RequestKind.NEW_GOAL,
                intent=Intent(name="flight", domains=[AgentName.FLIGHT]),
                constraints=Constraints(),
            ),
            "goal_selections": {"t1": "map-1"},
        },
        as_node="respond",
    )
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        after_flight = (await client.get("/chat/th-state/state", headers={"X-User-Id": "alice"})).json()
    assert after_flight["selections"] == {"property": home}
