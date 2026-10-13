import json
from datetime import timedelta

import httpx
import pytest
from relohome_agent.agents.common import utcnow
from relohome_agent.agents.models import (
    AgentName,
    CommitAction,
    CommitActionKind,
    Plan,
    Quote,
    Receipt,
    RequestKind,
    Task,
    TaskResult,
    TaskStatus,
)
from relohome_agent.agents.nodes.cost_summary import build_summary
from relohome_gateway.server import create_app

from tests.test_agents.helpers import intake_result


def test_costs_separate_recurring_selected_and_committed_amounts():
    now = utcnow()
    plan = Plan(
        version=1,
        tasks=[Task(id="home", agent=AgentName.PROPERTY), Task(id="move", agent=AgentName.RELOCATION)],
        commit_actions=[CommitAction(id="book", kind=CommitActionKind.MOVING_BOOKING, source_task_id="move")],
    )
    results = {
        "home": TaskResult(
            task_id="home",
            agent=AgentName.PROPERTY,
            plan_version=1,
            status="done",
            fetched_at=now,
            quotes=[Quote(option_id="home-1", label="Rent", amount_vnd=9_000_000, recurrence="monthly")],
        ),
        "move": TaskResult(
            task_id="move",
            agent=AgentName.RELOCATION,
            plan_version=1,
            status="done",
            fetched_at=now,
            quotes=[Quote(option_id="truck-1", label="Truck", amount_vnd=250_000, recurrence="one_time")],
        ),
    }
    intake = intake_result(RequestKind.NEW_GOAL, [AgentName.PROPERTY, AgentName.RELOCATION])

    def summarize(committed, statuses):
        return build_summary(
            plan,
            statuses,
            results,
            intake,
            committed,
            {},
            now,
            timedelta(minutes=5),
            {CommitActionKind.MOVING_BOOKING: 0.05},
        )

    summary = summarize({}, {"home": TaskStatus.DONE, "move": TaskStatus.DONE})
    assert summary.total_monthly_vnd == 9_000_000
    assert summary.total_one_time_vnd == 250_000
    assert summary.total_one_time_max_vnd == 262_500
    committed = {
        "book": Receipt(
            receipt_id="order",
            action_id="book",
            kind=CommitActionKind.MOVING_BOOKING,
            provider="ahamove",
            amount_vnd=250_000,
            source_kind="sandbox",
            status="confirmed",
            created_at=now,
        )
    }
    assert summarize(committed, {"home": TaskStatus.DONE, "move": TaskStatus.DONE}).total_one_time_vnd == 0
    assert summarize({}, {"home": TaskStatus.DONE, "move": TaskStatus.STALE}).total_one_time_vnd == 0


@pytest.mark.asyncio
async def test_payment_qr_requires_owned_pending_payment(tmp_path):
    app = create_app(tmp_path / "web.db")
    headers = {"X-SIU-Request": "1"}
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers=headers) as client,
    ):
        await client.post(
            "/web/api/auth/register", json={"name": "Test", "email": "a@example.test", "password": "long-test-password"}
        )
        thread = (await client.post("/web/api/threads")).json()["id"]
        path = f"/web/api/threads/{thread}/payment/qr.svg"
        assert (await client.get(path)).status_code == 404
        state = {"pending": {"type": "payment_required", "qr_code": "https://example.test/pay/test"}}
        app.state.store.write("UPDATE threads SET state=? WHERE id=?", (json.dumps(state), thread))
        response = await client.get(path)
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("image/svg+xml")
        assert "<svg" in response.text
        await client.post(
            "/web/api/auth/register",
            json={"name": "Other", "email": "b@example.test", "password": "long-test-password"},
        )
        assert (await client.get(path)).status_code == 404
