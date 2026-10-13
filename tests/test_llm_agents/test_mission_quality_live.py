"""Bounded quality checks on actual models/providers and an actual Git baseline.

No provider fixtures, mock clients, bookings or payments. The A/B test isolates
the domain loop: same current grounded adapter, filters, model and real database.
It is not a historical full-product benchmark or a statistical accuracy estimate.
"""

import asyncio
import copy
import json
import os
import subprocess
import time
import types
import uuid
from datetime import timedelta

import httpx
import pytest
from relohome_agent.agents.common import utcnow
from relohome_agent.agents.contracts import AgentTaskRequest
from relohome_agent.agents.models import AgentBudget, AgentName
from relohome_agent.agents.subagents.services.location import LocationSubagent
from relohome_agent.agents.subagents.services.read_llm import ReadLlmAgent
from relohome_agent.services.adapters.mcp import McpEndpoint, McpToolClient
from relohome_agent.services.adapters.registry import LOCATION_READ_TOOLS
from test_domain_missions_live import ROOT, saved_state

from tests import live

pytestmark = pytest.mark.skipif(os.getenv("RUN_LIVE_INTEGRATION") != "1", reason="Actual services and paid LLM opt-in")
BASELINE_COMMIT = "b18fb4b944e2a9cacc34a3e73cd8ade7b055fdf9"


def baseline_module(path):
    """Load real old implementation without checking out or editing the worktree."""
    source = subprocess.run(
        ["git", "show", BASELINE_COMMIT + ":" + path],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    ).stdout
    module = types.ModuleType("mission_quality_actual_git_baseline")
    exec(compile(source, "git:" + BASELINE_COMMIT + "/" + path, "exec"), module.__dict__)
    return module


def test_real_ab_pagination_mission():
    async def run():
        client = McpToolClient(
            McpEndpoint(
                service="location",
                url=live.mcp_url("location"),
                token=live.mcp_token("location"),
                allowed_tools=LOCATION_READ_TOOLS,
            )
        )
        inputs = {"city": "Hà Nội", "near": "Đại học Bách khoa Hà Nội", "max_price_vnd": 5_000_000, "limit": 5}
        mission = (
            "Tìm phòng gần Đại học Bách khoa Hà Nội dưới 5 triệu/tháng. Tôi cần xem tối đa 10 căn để so sánh: "
            "đọc trang tiếp nếu có, tối đa hai trang, không chỉ dừng ở trang 5 căn đầu. "
            "Không nới ngân sách hoặc đổi địa điểm, không đặt. Nếu không đủ kết quả thì nói rõ."
        )
        metrics = {}
        results = {}
        for name, cls in (
            ("old", baseline_module("src/agents/subagents/services/read_llm.py").ReadLlmAgent),
            ("new", ReadLlmAgent),
        ):
            adapter = LocationSubagent(client, AgentName.PROPERTY)
            agent = cls(
                live.env_test("OPENAI_API_KEY"),
                live.env_test("AGENT_HOUSING_MODEL", required=False) or "gpt-6-luna",
                adapter,
            )
            request = AgentTaskRequest(
                request_id=uuid.uuid4().hex,
                thread_id="quality_ab_" + uuid.uuid4().hex,
                task_id="housing",
                plan_version=1,
                attempt=1,
                agent=AgentName.PROPERTY,
                inputs=copy.deepcopy(inputs),
                goal=mission,
                user_request=mission,
                budget=AgentBudget(
                    max_llm_calls=6, max_provider_calls=9, deadline_at=utcnow() + timedelta(seconds=100)
                ),
            )
            started = time.perf_counter()
            try:
                result = await agent.run(request)
            finally:
                await agent.close()
            results[name] = result
            metrics[name] = {
                "status": result.status,
                "candidates": len(result.data.get("candidates", [])),
                "tools": result.data.get("agent_trace", {}).get("tools"),
                "usage": result.usage.model_dump(),
                "elapsed_s": round(time.perf_counter() - started, 2),
                "assessment": result.data.get("agent_assessment", {}).get("satisfaction"),
                "error_code": result.error.code if result.error else None,
            }
        print("AB_REAL " + json.dumps(metrics))
        old, new = results["old"], results["new"]
        assert old.status == new.status == "done", metrics
        if not old.data.get("has_more"):
            pytest.skip("Actual database has no next page; cannot demonstrate pagination improvement")
        assert len(old.data["candidates"]) <= 5
        assert len(new.data["candidates"]) > len(old.data["candidates"]), metrics
        assert len(new.data["candidates"]) <= 10, "Respect the user's two-page limit"
        assert new.data["search_request"] == old.data["search_request"], (
            "Compare identical hard query, not looser search"
        )
        for result in (old, new):
            assert result.source_kind == "live"
            assert {r["id"] for r in result.data["candidates"]} <= set(result.source_refs)
            assert all(r["price_vnd"] <= inputs["max_price_vnd"] for r in result.data["candidates"])
        assert new.data["agent_trace"]["tools"].count("search_housing") == 2
        assert new.data["agent_assessment"]["kind"] == "model_assessment_not_provider_fact"

    asyncio.run(run())


@pytest.fixture
def resumed_client():
    thread = os.getenv("RUN_LIVE_MISSION_RESUME_THREAD")
    if not thread:
        pytest.skip("Supply an existing real selected-home conversation; no fabricated history")
    state = saved_state(thread)
    assert state["intake"].user_confirmed_facts.get("selected:property"), "Select a real home before this test"
    with httpx.Client(
        base_url=live.api_url(),
        timeout=240,
        headers={"Authorization": "Bearer " + live.api_token(), "X-User-Id": state["user_id"]},
    ) as client:
        yield client, thread, state


def live_turn(client, thread, message):
    reply = client.post("/chat", json={"thread_id": thread, "message": message})
    reply.raise_for_status()
    payload = reply.json()
    state_reply = client.get(f"/chat/{thread}/state")
    state_reply.raise_for_status()
    state = state_reply.json()
    assert not payload.get("confirmation") and not state.get("committed")
    print(
        "LIVE_TURN "
        + json.dumps(
            {
                "thread": thread,
                "kind": payload["response"]["kind"],
                "domains": [t["agent"] for t in state["plan"]["tasks"]],
            }
        )
    )
    return payload, state


def test_more_turns_amenities_then_moving_preserve_selected_home(resumed_client):
    client, thread, before = resumed_client
    chosen = before["intake"].user_confirmed_facts["selected:property"].value
    previous = next(r for r in before["task_results"].values() if r.agent == AgentName.PROPERTY)
    after_moving = os.getenv("RUN_LIVE_QUALITY_RESUME_AFTER_MOVING") == "1"
    if after_moving or os.getenv("RUN_LIVE_QUALITY_RESUME_AFTER_MAP") == "1":
        response = client.get(f"/chat/{thread}/state")
        response.raise_for_status()
        reply, state = {"response": before["response"].model_dump(mode="json")}, response.json()
    else:
        reply, state = live_turn(
            client,
            thread,
            "Chuyển sang xem siêu thị trong 800 mét quanh căn đó, vẫn giữ ngân sách tìm phòng trước đây. Không tìm lại nhà, không đặt dịch vụ.",
        )
    assert reply["response"]["kind"] in {"ANSWER", "PARTIAL"}, reply["response"]["text"]
    task = next(t for t in state["plan"]["tasks"] if t["agent"] == "map" and t["inputs"].get("map_mode") != "route")
    assert task["inputs"]["categories"] == ["supermarket"] and task["inputs"]["radius_m"] == 800
    assert task["inputs"]["selected_listing_id"] == chosen
    # A Map-only response need not re-display Housing. Its verified result must
    # remain in shared state, unchanged and not fetched again.
    checkpoint = saved_state(thread)
    mapped = checkpoint["task_results"][task["id"]]
    retained = checkpoint["task_results"][previous.task_id]
    assert retained.fetched_at == previous.fetched_at
    assert retained.data["search_request"] == previous.data["search_request"]
    assert retained.data["execution"]["request_id"] != checkpoint["request_id"]
    assert mapped.data["agent_trace"]["tools"][-1] == "finish"
    assert state["intake"]["constraints"]["values"]["max_price_vnd"] == 5_000_000
    day = (utcnow() + timedelta(days=2)).date().isoformat()
    if after_moving:
        moving_reply, moving_state = reply, state
    else:
        moving_reply, moving_state = live_turn(
            client,
            thread,
            f"Tôi muốn chuyển đồ từ căn đó đến Đại học Bách khoa Hà Nội ngày {day} lúc 16 giờ. Chỉ báo giá, chưa đặt.",
        )
    assert moving_reply["response"]["kind"] in {"ANSWER", "PARTIAL", "CLARIFY"}, moving_reply["response"]["text"]
    values = moving_state["intake"]["constraints"]["values"]
    assert values["move_date"] == day and values["move_time"] == "16:00"
    assert moving_state["intake"]["user_confirmed_facts"]["selected:property"]["value"] == chosen
    assert values["from_address"] == "selected:property", (
        "Resolve the reference, do not request the chosen address again"
    )
    moving = next(r for r in saved_state(thread)["task_results"].values() if r.agent == AgentName.RELOCATION)
    assert moving.status in {"done", "needs_input"}, moving.status
    for question in moving.questions:
        assert question.field not in {"move_date", "move_time", "selected:property"}, (
            "Do not ask again for known fields"
        )
    assert moving.source_kind in {"live", "sandbox"}


def test_old_optional_review_does_not_downgrade_fresh_completed_request():
    """Known response-scoping regression on an actual completed Moving thread."""
    thread = os.getenv("RUN_LIVE_MISSION_RESUME_THREAD")
    if not thread:
        pytest.skip("Requires an actual completed multi-turn checkpoint, not generated state")
    state = saved_state(thread)
    current_request = state["request_id"]
    fresh = [
        r for r in state["task_results"].values() if r.data.get("execution", {}).get("request_id") == current_request
    ]
    if not fresh or not all(r.status == "done" for r in fresh):
        pytest.skip("Thread has no completed current request suitable for this comparison")
    if any(r.data.get("agent_assessment", {}).get("satisfaction") == "limited" for r in fresh):
        pytest.skip("A fresh task actually reported a limitation; PARTIAL may be correct")
    assert state["response"].data.get("results"), "Actual response must expose provider data"
    optional_old = {
        t.id
        for t in state["plan"].tasks
        if not t.required
        and t.id in state["task_results"]
        and state["task_results"][t.id].data.get("execution", {}).get("request_id") != current_request
    }
    if not optional_old:
        pytest.skip("Thread has no carried optional task; do not manufacture one")
    from relohome_agent.agents.nodes.respond import compose

    baseline_response = baseline_module("src/agents/nodes/respond.py").compose(state, None)
    current_response = compose(state, None)
    print(
        "RESPONSE_AB "
        + json.dumps(
            {"old": baseline_response.kind, "new": current_response.kind, "optional_old_tasks": sorted(optional_old)}
        )
    )
    assert baseline_response.kind == "ANSWER", "Comparison assumes a fully completed current request in baseline"
    assert not optional_old & set(current_response.data.get("limited_tasks", {})), (
        "Completed current request is downgraded by an old optional task assessment; scope reply to current work"
    )
