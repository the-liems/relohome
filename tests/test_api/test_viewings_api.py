"""HTTP: chọn nhiều căn không đổi căn của kế hoạch; chốt mới đặt căn; mở lại thì gỡ (housing-viewing-design)."""

from __future__ import annotations

import sqlite3
from dataclasses import replace
from datetime import datetime, timedelta

import pytest
import pytest_asyncio
from relohome_agent.agents.intake import ScriptedIntake
from relohome_agent.agents.models import AgentName, RequestKind
from relohome_agent.agents.planning import TemplatePlanner
from relohome_agent.agents.wiring import AgentService
from relohome_agent.checkout.store import CheckoutStore
from relohome_agent.checkout.viewing import ViewingService, ViewingSettings
from relohome_agent.config import Settings

from tests.test_agents.helpers import intake_result

HEADERS = {"X-User-Id": "u1"}


class Clock:
    def __init__(self, now):
        self.now = now

    def __call__(self):
        return self.now


@pytest_asyncio.fixture
async def api(api_client_factory, monkeypatch):
    service = AgentService.create(
        ScriptedIntake([intake_result(RequestKind.NEW_GOAL, [AgentName.PROPERTY], values={"city": "HCM"})]),
        TemplatePlanner(),
        Settings(_env_file=None, agent_subagents="fake"),
    )
    settings = ViewingSettings.from_services(Settings(_env_file=None, housing_viewing_lead_minutes=0))
    clock = Clock(datetime.now(settings.timezone))
    service.viewing = ViewingService(
        store=CheckoutStore(sqlite3.connect(":memory:", isolation_level=None)), settings=settings, clock=clock
    )

    async def reread(_service, listing_id):  # tin còn trên Location
        return {"id": listing_id, "lat": 10.76, "lng": 106.70}

    monkeypatch.setattr("relohome_agent.api.web_actions.explored_listing", reread)
    async with api_client_factory(service) as client:
        yield client, service, clock


async def search(client):
    body = (await client.post("/api/v1/chat", json={"message": "Tìm phòng ở HCM"}, headers=HEADERS)).json()
    thread_id = body["thread_id"]
    state = (await client.get(f"/api/v1/chat/{thread_id}/state", headers=HEADERS)).json()
    task_id = next(t["id"] for t in state["plan"]["tasks"] if t["agent"] == "property")
    result = body["response"]["data"]["results"][task_id]
    return thread_id, state["plan"]["version"], task_id, result["fetched_at"]


async def select(client, thread_id, version, task_id, fetched_at, listing_id):
    return await client.post(
        f"/api/v1/ui/chat/{thread_id}/action",
        headers=HEADERS,
        json={
            "kind": "select",
            "task_id": task_id,
            "plan_version": version,
            "fetched_at": fetched_at,
            "entity_id": listing_id,
        },
    )


@pytest.mark.asyncio
async def test_select_many_then_decide_after_visit_then_reopen(api):
    client, service, clock = api
    thread_id, version, task_id, fetched_at = await search(client)
    for listing in ("lst_001", "lst_002", "lst_003"):
        assert (await select(client, thread_id, version, task_id, fetched_at, listing)).status_code == 200
    state = (await client.get(f"/api/v1/chat/{thread_id}/state", headers=HEADERS)).json()
    assert "selected:property" not in state["intake"]["user_confirmed_facts"]
    assert [i["listing_id"] for i in state["viewing"]["items"]] == ["lst_001", "lst_002", "lst_003"]

    slots = state["viewing"]["slots"]
    url = f"/api/v1/ui/chat/{thread_id}/viewings"
    r = await client.post(url + "/schedule", headers=HEADERS, json={"listing_id": "lst_002", "slot": slots[0]})
    assert r.status_code == 200, r.text
    r = await client.post(url + "/schedule", headers=HEADERS, json={"listing_id": "lst_003", "slot": slots[0]})
    assert r.status_code == 409 and r.json()["code"] == "overlap"
    later = next(s for s in slots if datetime.fromisoformat(s) >= datetime.fromisoformat(slots[0]) + timedelta(hours=3))
    assert (
        await client.post(url + "/schedule", headers=HEADERS, json={"listing_id": "lst_003", "slot": later})
    ).status_code == 200

    decide = {"listing_id": "lst_002", "rent_vnd": 5_800_000, "deposit_vnd": 5_800_000, "decision_key": "d" * 20}
    r = await client.post(url + "/decide", headers=HEADERS, json=decide)
    assert r.status_code == 409 and r.json()["code"] == "not_visited"

    clock.now = datetime.fromisoformat(slots[0]) + timedelta(minutes=31)
    r = await client.post(url + "/visit", headers=HEADERS, json={"listing_id": "lst_002", "outcome": "met_agreed"})
    assert r.status_code == 200
    r = await client.post(url + "/decide", headers=HEADERS, json={**decide, "keep_listing_ids": ["lst_003"]})
    assert r.status_code == 200, r.text
    state = (await client.get(f"/api/v1/chat/{thread_id}/state", headers=HEADERS)).json()
    assert state["intake"]["user_confirmed_facts"]["selected:property"]["value"] == "lst_002"
    statuses = {i["listing_id"]: i["status"] for i in state["viewing"]["items"]}
    assert statuses == {"lst_002": "agreed", "lst_003": "backup"}
    again = await client.post(url + "/decide", headers=HEADERS, json={**decide, "keep_listing_ids": ["lst_003"]})
    assert again.status_code == 200  # cùng khóa: không làm lại

    r = await client.post(url + "/reopen", headers=HEADERS)
    assert r.status_code == 200
    state = (await client.get(f"/api/v1/chat/{thread_id}/state", headers=HEADERS)).json()
    assert "selected:property" not in state["intake"]["user_confirmed_facts"]
    statuses = {i["listing_id"]: i["status"] for i in state["viewing"]["items"]}
    assert statuses == {"lst_002": "visited", "lst_003": "viewing_scheduled"}


@pytest.mark.asyncio
async def test_other_user_and_moving_mode(api):
    client, service, _ = api
    thread_id, *_ = await search(client)
    other = await client.get(f"/api/v1/ui/chat/{thread_id}/viewings", headers={"X-User-Id": "u2"})
    assert other.status_code == 404
    r = await client.post(
        f"/api/v1/ui/chat/{thread_id}/viewings/moving-mode", headers=HEADERS, json={"mode": "wait_for_home"}
    )
    assert r.status_code == 200 and r.json()["moving_mode"] == "wait_for_home"


@pytest.mark.asyncio
async def test_disabled_keeps_single_selection(api_client_factory):
    service = AgentService.create(
        ScriptedIntake([intake_result(RequestKind.NEW_GOAL, [AgentName.PROPERTY], values={"city": "HCM"})]),
        TemplatePlanner(),
        Settings(_env_file=None, agent_subagents="fake"),
    )
    async with api_client_factory(service) as client:
        thread_id, version, task_id, fetched_at = await search(client)
        assert (await select(client, thread_id, version, task_id, fetched_at, "lst_001")).status_code == 200
        state = (await client.get(f"/api/v1/chat/{thread_id}/state", headers=HEADERS)).json()
        assert state["intake"]["user_confirmed_facts"]["selected:property"]["value"] == "lst_001"
        assert state["viewing"] is None
        assert (await client.get(f"/api/v1/ui/chat/{thread_id}/viewings", headers=HEADERS)).status_code == 404


@pytest.mark.asyncio
async def test_landlord_proposal_slots_follow_the_configured_window(api):
    client, service, clock = api
    for days in (7, 3):
        service.viewing.settings = replace(service.viewing.settings, proposal_days=days)
        r = await client.get("/api/v1/ui/viewings/slots", headers=HEADERS)
        assert r.status_code == 200
        body = r.json()
        assert body["days"] == days and body["slots"]
        assert all(datetime.fromisoformat(s) <= clock.now + timedelta(days=days) for s in body["slots"])
