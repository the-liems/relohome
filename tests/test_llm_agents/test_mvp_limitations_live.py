"""Regression against live local graph/MCP only; no mocks or transaction writes."""

import asyncio
import os
import uuid
from pathlib import Path

import httpx
import pytest
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from relohome_agent.agents.graph import checkpoint_serde

from tests import live

pytestmark = pytest.mark.skipif(os.getenv("RUN_LIVE_INTEGRATION") != "1", reason="Real services opt-in")
ROOT = Path(__file__).resolve().parents[2]


def checkpoint(thread, full=False):
    async def read():
        async with AsyncSqliteSaver.from_conn_string(str(live.agent_state_dir() / "checkpoints.sqlite3")) as saver:
            saver.serde = checkpoint_serde()
            saved = await saver.aget_tuple({"configurable": {"thread_id": thread}})
            assert saved is not None
            if full:
                return saved.checkpoint["channel_values"]
            return {
                key: value.model_dump(mode="json")
                for key, value in saved.checkpoint["channel_values"].get("task_results", {}).items()
            }

    return asyncio.run(read())


@pytest.fixture
def client():
    resumed = (
        checkpoint(os.environ["RUN_LIVE_RESUME_THREAD"], full=True) if os.getenv("RUN_LIVE_RESUME_THREAD") else None
    )
    with httpx.Client(
        base_url=live.api_url(),
        headers={
            "Authorization": "Bearer " + live.api_token(),
            "X-User-Id": resumed["user_id"] if resumed else "limits_" + uuid.uuid4().hex,
        },
        timeout=180,
    ) as http:
        yield http


def turn(client, message, thread=None):
    response = client.post("/chat", json={"message": message, "thread_id": thread})
    response.raise_for_status()
    payload = response.json()
    state_response = client.get(f"/chat/{payload['thread_id']}/state")
    state_response.raise_for_status()
    state = state_response.json()
    state["task_results"] = checkpoint(payload["thread_id"])
    assert not payload.get("confirmation") and not state.get("committed")
    print("turn", payload["thread_id"], payload["response"]["kind"])
    return payload, state


def action(client, thread, task_id, state, kind, entity_id=None):
    result = state["task_results"][task_id]
    response = client.post(
        f"/ui/chat/{thread}/action",
        json={
            "kind": kind,
            "task_id": task_id,
            "plan_version": state["plan"]["version"],
            "fetched_at": result["fetched_at"],
            "entity_id": entity_id,
        },
    )
    assert response.status_code == 200, response.text
    response.raise_for_status()
    state = client.get(f"/chat/{thread}/state").json()
    state["task_results"] = checkpoint(thread)
    return state


def test_catalog_and_disabled_booking(client):
    reply, state = turn(client, "AhaMove hỗ trợ những thành phố nào? Chỉ tra phạm vi, không đặt xe.")
    assert reply["response"]["kind"] == "ANSWER", reply["response"]["text"]
    catalog = next(r for r in state["task_results"].values() if r["agent"] == "relocation")
    assert catalog["data"]["cities"] and catalog["data"]["agent_trace"]["tools"]
    assert not state["intake"]["blocking_missing"]
    denied, _ = turn(client, "Đặt xe chuyển đồ ngày mai lúc 15 giờ cho tôi.", reply["thread_id"])
    assert denied["response"]["kind"] == "CLARIFY"
    assert "chưa được bật" in denied["response"]["text"]
    assert "PLAN_INVALID" not in denied["response"]["text"]


def test_new_housing_map_selection_and_pagination(client):
    if os.getenv("RUN_LIVE_RESUME_THREAD"):
        thread = os.environ["RUN_LIVE_RESUME_THREAD"]
        saved = checkpoint(thread, full=True)
        state = client.get(f"/chat/{thread}/state").json()
        state["task_results"] = checkpoint(thread)
        reply = {"thread_id": thread, "response": saved["response"].model_dump(mode="json")}
    else:
        reply, state = turn(
            client,
            "Tìm nhà có đúng 2 phòng ngủ tại Quận 1, Thành phố Hồ Chí Minh dưới 10 triệu mỗi tháng; tìm bệnh viện quanh các căn tìm được trong bán kính 1000 mét. Không đặt gì.",
        )
    assert reply["response"]["kind"] in {"ANSWER", "PARTIAL"}, reply["response"]["text"]
    assert state["intake"]["constraints"]["values"].get("near") != "selected:property"
    property_task = next(t for t in state["plan"]["tasks"] if t["agent"] == "property")
    housing = state["task_results"][property_task["id"]]
    houses = housing["data"]["candidates"]
    assert len(houses) >= 2 and all(c["bedrooms"] == 2 for c in houses)
    map_task = next(t for t in state["plan"]["tasks"] if t["agent"] == "map")
    assert property_task["id"] in map_task["depends_on"]
    assert state["task_status"][map_task["id"]] == "done"
    thread = reply["thread_id"]
    state = action(client, thread, property_task["id"], state, "select", houses[0]["id"])
    next_reply, state = turn(client, "Chỉ tìm nhà thuốc quanh căn đã chọn trong bán kính 500 mét.", thread)
    assert next_reply["response"]["kind"] in {"ANSWER", "PARTIAL"}, next_reply["response"]["text"]
    bound = [t["id"] for t in state["plan"]["tasks"] if t["inputs"].get("selected_listing_id") == houses[0]["id"]]
    assert bound and all(state["task_status"][tid] == "done" for tid in bound)
    state = action(client, thread, property_task["id"], state, "select", houses[1]["id"])
    assert all(state["task_status"][tid] == "stale" for tid in bound)
    current = state["task_results"][property_task["id"]]
    if current["data"].get("next_cursor"):
        state = action(client, thread, property_task["id"], state, "more")
        expanded = state["task_results"][property_task["id"]]
        assert {c["id"] for c in expanded["data"]["candidates"]} <= set(expanded["source_refs"])


def test_scope_change_to_district_only(client):
    reply, _ = turn(client, "Tìm phòng gần Đại học Bách khoa Hà Nội dưới 6 triệu mỗi tháng.")
    assert reply["response"]["kind"] == "ANSWER", reply["response"]["text"]
    refined, state = turn(client, "Đổi sang tìm ở quận Hà Đông, giữ ngân sách cũ.", reply["thread_id"])
    assert refined["response"]["kind"] == "ANSWER", refined["response"]["text"]
    values = state["intake"]["constraints"]["values"]
    assert not values.get("near") and values["max_price_vnd"] == 6_000_000
    task = next(t for t in state["plan"]["tasks"] if t["agent"] == "property")
    assert task["inputs"].get("district") or task["inputs"].get("city")
    assert not task["inputs"].get("near")


def test_independent_map_with_abbreviated_housing_scope(client):
    reply, state = turn(
        client,
        "Tìm nhà có 2 phòng ngủ tại Quận 1, TP.HCM dưới 10 triệu mỗi tháng. Đồng thời tìm bệnh viện quanh Đại học Bách khoa Hà Nội trong 1000 mét. Đây là hai việc độc lập; không đặt gì.",
    )
    assert reply["response"]["kind"] in {"ANSWER", "CLARIFY", "PARTIAL"}, reply["response"]["text"]
    map_task = next(t for t in state["plan"]["tasks"] if t["agent"] == "map")
    house_task = next(t for t in state["plan"]["tasks"] if t["agent"] == "property")
    assert not map_task["depends_on"] and state["task_status"][map_task["id"]] == "done"
    assert "Bách khoa" in map_task["inputs"]["near"]
    assert not house_task["inputs"].get("near")
    assert map_task["id"] in reply["response"]["data"]["results"]


def test_unowned_payment_is_not_presented_as_transient_provider_failure(client):
    reply, state = turn(client, "Tra trạng thái thanh toán ZaloPay mã khong-ton-tai của tôi.")
    payment = next(r for r in state["task_results"].values() if r["agent"] == "payment")
    assert payment["error_code"] == "invalid_input"
    assert reply["response"]["kind"] == "ERROR"
    assert "thử lại sau" not in reply["response"]["text"]
    assert "chưa có quyền" in reply["response"]["text"]
