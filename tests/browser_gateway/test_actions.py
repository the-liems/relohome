import httpx
import pytest
from fastapi import FastAPI
from relohome_agent.agents.common import utcnow
from relohome_agent.agents.graph import run_config
from relohome_agent.agents.models import (
    AgentName,
    Constraints,
    IntakeResult,
    Intent,
    Plan,
    Quote,
    RequestKind,
    Task,
    TaskResult,
    TaskStatus,
)
from relohome_agent.agents.wiring import AgentService
from relohome_agent.api.web_actions import router
from relohome_agent.config import Settings


@pytest.mark.asyncio
async def test_selection_is_grounded_owned_and_persisted_in_graph(monkeypatch):
    from relohome_agent.agents.deps import AgentRegistry
    from relohome_agent.agents.subagents.fake import FakeAgent

    monkeypatch.setattr(
        "relohome_agent.agents.deps.fake_registry", lambda: AgentRegistry({AgentName.PROPERTY: FakeAgent(AgentName.PROPERTY)})
    )
    service = AgentService.create(services=Settings(_env_file=None, agent_subagents="fake"))
    app = FastAPI()
    app.state.agent_service = service
    app.include_router(router)
    when = utcnow()
    result = TaskResult(
        task_id="t1",
        agent=AgentName.PROPERTY,
        plan_version=1,
        status="done",
        fetched_at=when,
        data={"candidates": [{"id": "a", "title": "Căn A"}, {"id": "b", "title": "Căn B"}]},
        quotes=[
            Quote(option_id="a", label="Căn A", amount_vnd=4000000, recurrence="monthly"),
            Quote(option_id="b", label="Căn B", amount_vnd=5000000, recurrence="monthly"),
        ],
    )
    config = run_config("thread-test", service.deps)
    await service.graph.aupdate_state(
        config,
        {
            "user_id": "alice",
            "thread_id": "thread-test",
            "intake": IntakeResult(
                kind=RequestKind.NEW_GOAL,
                intent=Intent(name="housing", domains=[AgentName.PROPERTY]),
                constraints=Constraints(),
            ),
            "plan": Plan(
                version=1,
                tasks=[
                    Task(id="t1", agent=AgentName.PROPERTY),
                    Task(id="t2", agent=AgentName.PROPERTY, depends_on=["t1"]),
                ],
            ),
            "task_results": {"t1": result, "t2": result.model_copy(update={"task_id": "t2"})},
            "task_status": {"t1": TaskStatus.DONE, "t2": TaskStatus.DONE},
        },
        as_node="respond",
    )
    body = {"kind": "select", "task_id": "t1", "plan_version": 1, "fetched_at": when.isoformat(), "entity_id": "b"}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        assert (
            await client.post("/ui/chat/thread-test/action", json=body, headers={"X-User-Id": "bob"})
        ).status_code == 404
        assert (
            await client.post(
                "/ui/chat/thread-test/action", json={**body, "entity_id": "invented"}, headers={"X-User-Id": "alice"}
            )
        ).status_code == 409
        assert (
            await client.post(
                "/ui/chat/thread-test/action", json={**body, "plan_version": 2}, headers={"X-User-Id": "alice"}
            )
        ).status_code == 409
        response = await client.post("/ui/chat/thread-test/action", json=body, headers={"X-User-Id": "alice"})
        assert response.status_code == 200, response.text
        state = (await service.graph.aget_state(config)).values
        assert state["intake"].user_confirmed_facts["selected:property"].value == "b"
        assert state["goal_selections"] == {"t1": "b"}
        assert state["cost_summary"].total_monthly_vnd == 5000000
        assert state["cost_summary"].selected["t1"] == "b"
        assert state["task_status"]["t2"] == TaskStatus.STALE
        assert "t2" not in state["cost_summary"].selected
        assert (
            await client.post(
                "/ui/chat/thread-test/action", json={**body, "task_id": "t2"}, headers={"X-User-Id": "alice"}
            )
        ).status_code == 409
        assert not state.get("committed")


@pytest.mark.asyncio
async def test_listing_explored_on_map_is_selectable_only_via_provider_record(monkeypatch):
    from relohome_agent.agents.deps import AgentRegistry
    from relohome_agent.agents.subagents.fake import FakeAgent

    class Location:
        async def call(self, tool, args):
            assert tool == "get_housing"
            if args["listing_id"] != "map-1":
                return None
            return {
                "listing_id": "map-1",
                "title": "Căn trên bản đồ",
                "price": {"amount": 6_000_000, "currency": "VND", "period": "month"},
                "address": {"street": "Lê Lợi", "district": "Quận 1", "city": "Hồ Chí Minh"},
                "location": {"lat": 10.77, "lng": 106.7},
                "location_accuracy": "approximate",
            }

    housing = FakeAgent(AgentName.PROPERTY)
    housing.client = Location()
    monkeypatch.setattr("relohome_agent.agents.deps.fake_registry", lambda: AgentRegistry({AgentName.PROPERTY: housing}))
    service = AgentService.create(services=Settings(_env_file=None, agent_subagents="fake"))
    app = FastAPI()
    app.state.agent_service = service
    app.include_router(router)
    when = utcnow()
    result = TaskResult(
        task_id="t1",
        agent=AgentName.PROPERTY,
        plan_version=1,
        status="done",
        fetched_at=when,
        data={"candidates": [{"id": "a", "title": "Căn A"}]},
        quotes=[Quote(option_id="a", label="Căn A", amount_vnd=4000000, recurrence="monthly")],
    )
    config = run_config("thread-map", service.deps)
    await service.graph.aupdate_state(
        config,
        {
            "user_id": "alice",
            "thread_id": "thread-map",
            "intake": IntakeResult(
                kind=RequestKind.NEW_GOAL,
                intent=Intent(name="housing", domains=[AgentName.PROPERTY]),
                constraints=Constraints(),
            ),
            "plan": Plan(version=1, tasks=[Task(id="t1", agent=AgentName.PROPERTY)]),
            "task_results": {"t1": result},
            "task_status": {"t1": TaskStatus.DONE},
        },
        as_node="respond",
    )
    body = {"kind": "select", "task_id": "t1", "plan_version": 1, "fetched_at": when.isoformat()}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        missing = await client.post(
            "/ui/chat/thread-map/action", json={**body, "entity_id": "nope"}, headers={"X-User-Id": "alice"}
        )
        assert missing.status_code == 409
        chosen = await client.post(
            "/ui/chat/thread-map/action", json={**body, "entity_id": "map-1"}, headers={"X-User-Id": "alice"}
        )
        assert chosen.status_code == 200, chosen.text
    state = (await service.graph.aget_state(config)).values
    assert state["intake"].user_confirmed_facts["selected:property"].value == "map-1"
    added = state["task_results"]["t1"]
    assert [c["id"] for c in added.data["candidates"]] == ["a", "map-1"]
    assert added.data["candidates"][1]["origin"] == "map_workspace"
    assert any(q.option_id == "map-1" for q in added.quotes)
    assert state["cost_summary"].total_monthly_vnd == 6000000
