"""Mission-driven domain regression against actual MCP/API/LLM, never fixtures.

Opt in RUN_LIVE_INTEGRATION=1. No booking, payment creation or production writes.
The tool-session test uses the running Location service and zero LLM calls.
"""

import asyncio
import os
import uuid
from datetime import timedelta
from pathlib import Path

import httpx
import pytest
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from relohome_agent.agents.common import utcnow
from relohome_agent.agents.contracts import AgentTaskRequest
from relohome_agent.agents.graph import checkpoint_serde
from relohome_agent.agents.models import AgentBudget, AgentName, IntakeResult, Plan, RequestKind, Task, TaskStatus
from relohome_agent.agents.nodes.respond import compose
from relohome_agent.agents.nodes.validator import decide
from relohome_agent.agents.subagents.base import to_task_result
from relohome_agent.agents.subagents.services.domain_tools import DomainToolSession
from relohome_agent.agents.subagents.services.location import LocationSubagent, _meters
from relohome_agent.services.adapters.mcp import McpEndpoint, McpToolClient
from relohome_agent.services.adapters.registry import LOCATION_READ_TOOLS

from tests import live

pytestmark = pytest.mark.skipif(os.getenv("RUN_LIVE_INTEGRATION") != "1", reason="Actual local services opt-in")
ROOT = Path(__file__).resolve().parents[2]


def test_grounded_tools_with_real_location_and_no_llm():
    async def run():
        mcp = McpToolClient(
            McpEndpoint(
                service="location",
                url=live.mcp_url("location"),
                token=live.mcp_token("location"),
                allowed_tools=LOCATION_READ_TOOLS,
            )
        )
        req = AgentTaskRequest(
            request_id=uuid.uuid4().hex,
            thread_id="live_tool_policy",
            task_id="housing",
            plan_version=1,
            attempt=1,
            agent=AgentName.PROPERTY,
            goal="Tìm phòng gần Đại học Bách khoa Hà Nội, không tự đổi ngân sách",
            inputs={
                "city": "Hà Nội",
                "near": "Đại học Bách khoa Hà Nội",
                "max_price_vnd": 5_000_000,
                "search_radius_m": 2000,
            },
            budget=AgentBudget(max_llm_calls=0, max_provider_calls=12),
        )
        session = DomainToolSession(req, LocationSubagent(mcp, AgentName.PROPERTY))
        names = {t["name"] for t in session.available()}
        assert {"resolve_location", "search_areas", "search_housing", "ask_user"} <= names
        assert not names & {"create_payment", "create_move_order", "confirm_booking"}
        with pytest.raises(ValueError):
            await session.execute("resolve_location", {"field": "invented_place"})
        assert session.tools.calls == 0
        await session.execute("search_areas", {"field": "city"})
        assert session.result is None, "Real city must be resolved, not replaced with test coordinates"
        await session.execute("resolve_location", {"field": "near"})
        assert session.result is None, "Data coverage is a real failure, not a mocked pass"
        center = session.anchors["near"]["location"]
        await session.execute("search_housing", {"limit": None})
        result = session.result
        assert result.status == "done" and result.source_kind == "live"
        assert result.data["search_request"]["center"] == center
        assert result.data["search_request"]["radius_m"] == 2000
        assert result.data["radius_is_default"] is False
        assert result.data["map_context"]["viewport"]
        assert result.data["candidates"], "No real listings found; do not manufacture replacements"
        for row in session.rows:
            assert row["price_vnd"] <= 5_000_000
            assert row["id"] in result.source_refs
            if row["lat"] is not None and row["lng"] is not None:
                assert _meters(center, {"lat": row["lat"], "lng": row["lng"]}) <= 2010
        before = session.tools.calls
        with pytest.raises(ValueError):
            await session.execute("get_housing", {"id": "unobserved_identifier"})
        assert session.tools.calls == before
        identifier = session.rows[0]["id"]
        await session.execute("get_housing", {"id": identifier})
        assert result.data["details"][identifier]["id"] == identifier
        cursor = result.data.get("next_cursor")
        if cursor:
            first_ids = set(session.ids)
            await session.execute("search_housing", {"cursor": cursor})
            assert first_ids <= session.ids
            assert set(result.data["map_context"]["listing_ids"]) == session.ids
            assert {q.option_id for q in result.quotes} <= session.ids
        await session.execute(
            "finish",
            {
                "option_ids": [identifier],
                "satisfaction": "fulfilled",
                "reason": "Đã đọc dữ liệu Location thật",
                "next_step": "Người dùng chọn căn",
            },
        )
        assert result.data["candidates"][0]["id"] == identifier
        assert session.tools.cached_calls > 0
        assert session.tools.calls <= req.budget.max_provider_calls
        # Exercise semantic feedback on this actual provider result, not fake listings.
        await session.execute(
            "request_replan",
            {
                "reason": "Cần thêm kết quả đường đi để đánh giá thời gian tới trường.",
                "suggested_next_step": "Tra đường đi bằng Map trước khi kết luận thời gian.",
            },
        )
        plan = Plan(version=req.plan_version, tasks=[Task(id=req.task_id, agent=req.agent, inputs=req.inputs)])
        actual = to_task_result(result, req)
        args = {
            "statuses": {req.task_id: TaskStatus.DONE},
            "results": {req.task_id: actual},
            "attempts": {req.task_id: 1},
            "intake": IntakeResult(kind=RequestKind.NEW_GOAL),
            "capabilities": {req.task_id: session.adapter.capability},
            "ttl_s": {req.task_id: 21600},
            "now": utcnow(),
            "max_attempts": 2,
            "replans_left": True,
        }
        report = decide(plan=plan, **args)
        assert report.action == "REPLAN" and any(i.code == "V5" for i in report.issues)
        assert decide(plan=plan.model_copy(update={"version": plan.version + 1}), **args).action == "NONE"
        assert req.inputs["max_price_vnd"] == 5_000_000 and req.inputs["search_radius_m"] == 2000
        second_attempt = DomainToolSession(req.model_copy(update={"attempt": 2}), session.adapter)
        second_attempt.result = result
        assert "request_replan" not in {t["name"] for t in second_attempt.available()}

    asyncio.run(run())


@pytest.fixture
def client():
    resumed = os.getenv("RUN_LIVE_MISSION_RESUME_THREAD")
    actor = saved_state(resumed)["user_id"] if resumed else "mission_" + uuid.uuid4().hex
    with httpx.Client(
        base_url=live.api_url(),
        timeout=240,
        headers={"Authorization": "Bearer " + live.api_token(), "X-User-Id": actor},
    ) as http:
        yield http


def saved_state(thread):
    """Resume a real checkpoint to avoid paying for an already-passed search."""

    async def load():
        async with AsyncSqliteSaver.from_conn_string(str(live.agent_state_dir() / "checkpoints.sqlite3")) as saver:
            saver.serde = checkpoint_serde()
            saved = await saver.aget_tuple({"configurable": {"thread_id": thread}})
            assert saved is not None, "Resume thread must be an existing real conversation"
            return saved.checkpoint["channel_values"]

    return asyncio.run(load())


def ask(client, message, thread=None):
    response = client.post("/chat", json={"message": message, "thread_id": thread})
    response.raise_for_status()
    payload = response.json()
    assert not payload.get("confirmation"), "Read-only case must never request a transaction"
    assert payload["response"]["kind"] in {"ANSWER", "PARTIAL"}, payload["response"]["text"]
    return payload


def domain_result(payload, domain):
    return next(r for r in payload["response"]["data"]["results"].values() if r["agent"] == domain)


def test_housing_selection_then_map_exploration_preserves_filters(client):
    resumed = os.getenv("RUN_LIVE_MISSION_RESUME_THREAD")
    first = (
        {"thread_id": resumed, "response": saved_state(resumed)["response"].model_dump(mode="json")}
        if resumed
        else ask(
            client, "Tìm phòng dưới 5 triệu trong bán kính 2 km quanh Đại học Bách khoa Hà Nội. Chỉ tìm, không đặt."
        )
    )
    housing = domain_result(first, "property")
    assert housing["data"]["agent_trace"]["policy"] == "mission-driven-v2"
    assert housing["data"]["agent_assessment"]["kind"] == "model_assessment_not_provider_fact"
    assert housing["data"]["search_request"]["radius_m"] == 2000
    assert housing["data"]["candidates"] and housing["data"]["map_context"]["viewport"]
    state = client.get(f"/chat/{first['thread_id']}/state").json()
    task = next(t for t in state["plan"]["tasks"] if t["agent"] == "property")
    chosen = housing["data"]["candidates"][0]["id"]
    selection = client.post(
        f"/ui/chat/{first['thread_id']}/action",
        json={
            "kind": "select",
            "task_id": task["id"],
            "plan_version": state["plan"]["version"],
            "fetched_at": housing["fetched_at"],
            "entity_id": chosen,
        },
    )
    selection.raise_for_status()
    second = ask(client, "Quanh căn tôi vừa chọn có nhà thuốc nào trong 1 km? Không tìm lại phòng.", first["thread_id"])
    mapped = domain_result(second, "map")
    assert mapped["data"]["agent_trace"]["policy"] == "mission-driven-v2"
    assert "find_nearby_places" in mapped["data"]["agent_trace"]["tools"]
    state2 = client.get(f"/chat/{first['thread_id']}/state").json()
    map_task = next(t for t in state2["plan"]["tasks"] if t["agent"] == "map")
    assert map_task["inputs"]["selected_listing_id"] == chosen
    assert map_task["inputs"]["categories"] == ["pharmacy"] and map_task["inputs"]["radius_m"] == 1000
    assert domain_result(second, "property")["data"]["search_request"] == housing["data"]["search_request"]
    assert not state2["committed"]


def test_independent_nearby_and_real_flight_in_parallel(client):
    date = (utcnow() + timedelta(days=10)).date().isoformat()
    payload = ask(
        client,
        f"Tìm nhà thuốc trong 1 km quanh Đại học Bách khoa Hà Nội; đồng thời tìm chuyến bay Hà Nội đến Đà Nẵng ngày {date}, ưu tiên giá thấp. Không đặt vé.",
    )
    mapped, flight = domain_result(payload, "map"), domain_result(payload, "flight")
    assert mapped["data"]["nearby"]
    assert flight["data"]["offers"], "SerpApi must return real offers"
    assert flight["source_kind"] == "live"
    for result in (mapped, flight):
        assert result["data"]["agent_trace"]["policy"] == "mission-driven-v2"
        assert "finish" in result["data"]["agent_trace"]["tools"]
        assert result["usage"]["llm_calls"] <= 6
    state = client.get(f"/chat/{payload['thread_id']}/state").json()
    assert all(not t["depends_on"] for t in state["plan"]["tasks"])
    # Verify actual execution overlap, not just two boxes at the same DAG level.
    from datetime import datetime

    execution = [r["data"]["execution"] for r in (mapped, flight)]
    assert max(datetime.fromisoformat(e["started_at"]) for e in execution) < min(
        datetime.fromisoformat(e["finished_at"]) for e in execution
    )


def test_real_checkpoint_limited_assessment_is_visible_without_llm():
    thread = os.getenv("RUN_LIVE_MISSION_RESUME_THREAD")
    if not thread:
        pytest.skip("Supply an actual completed thread with a model limited assessment; no manufactured result")
    state = saved_state(thread)
    from relohome_agent.agents.models import Outcome, OutcomeCode

    assert state["outcome"].code == OutcomeCode.ANSWER
    limited = {
        task.id: state["task_results"][task.id].data["agent_assessment"]
        for task in state["plan"].tasks
        if state["task_results"][task.id].data.get("agent_assessment", {}).get("satisfaction") == "limited"
    }
    if not limited:
        pytest.skip("Actual model did not report a limitation; do not invent one to pass")
    state["outcome"] = Outcome(node="cost_summary", code=OutcomeCode.ANSWER)
    response = compose(state, None)  # compose does not access graph dependencies or perform IO.
    assert response.kind == "PARTIAL"
    assert response.data["limited_tasks"] == limited
    assert "không phải xác nhận từ nhà cung cấp" in response.text
    for task_id, assessment in limited.items():
        assert assessment["reason"] in response.text
        assert response.data["results"][task_id]["source_refs"] == state["task_results"][task_id].source_refs
