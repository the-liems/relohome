"""Xoá hội thoại ở Agent API: checkpoint và bộ nhớ có nguồn từ hội thoại đó, đúng chủ sở hữu."""

import httpx
import pytest
from fastapi import FastAPI
from relohome_agent.agents.graph import run_config
from relohome_agent.agents.models import MemoryUpdate
from relohome_agent.agents.wiring import AgentService
from relohome_agent.api.routes import router
from relohome_agent.config import Settings


@pytest.mark.asyncio
async def test_delete_thread_drops_checkpoint_and_its_memory_only():
    service = AgentService.create(services=Settings(_env_file=None, agent_subagents="fake"))
    app = FastAPI()
    app.state.agent_service = service
    app.include_router(router)
    for thread in ("th-a", "th-b"):
        await service.graph.aupdate_state(
            run_config(thread, service.deps), {"user_id": "alice", "thread_id": thread}, as_node="respond"
        )
    session = service.deps.session
    await session.save("alice", "th-a", [MemoryUpdate(group="preferences", key="city", value="Hà Nội")])
    await session.save("alice", "th-b", [MemoryUpdate(group="preferences", key="budget_max", value=6_000_000)])

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.delete("/chat/th-a", headers={"X-User-Id": "bob"})).status_code == 404
        response = await client.delete("/chat/th-a", headers={"X-User-Id": "alice"})
        assert response.status_code == 200 and response.json()["deleted"] is True
        assert not (await service.graph.aget_state(run_config("th-a", service.deps))).values
        assert (await service.graph.aget_state(run_config("th-b", service.deps))).values["user_id"] == "alice"
        memory = await session.load("alice")
        assert "city" not in memory.preferences and "budget_max" in memory.preferences
        again = await client.delete("/chat/th-a", headers={"X-User-Id": "alice"})
        assert again.status_code == 200 and again.json()["deleted"] is False

        assert (await client.delete("/memory", headers={"X-User-Id": "alice"})).status_code == 200
        assert (await session.load("alice")).preferences == {}
