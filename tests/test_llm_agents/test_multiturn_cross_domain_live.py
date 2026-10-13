"""Two real two-turn journeys spanning every MVP domain; no transaction writes."""

import json
import os
import sqlite3
import uuid
from pathlib import Path

import httpx
import pytest

from tests import live

pytestmark = pytest.mark.skipif(os.getenv("RUN_LIVE_INTEGRATION") != "1", reason="Real services opt-in")
ROOT = Path(__file__).resolve().parents[2]
BASE = live.api_url()


def client_for(user_id):
    return httpx.Client(
        base_url=BASE,
        timeout=300,
        headers={"Authorization": "Bearer " + live.api_token(), "X-User-Id": user_id},
    )


def turn(client, message, thread_id=None, **extra):
    response = client.post("/chat", json={"message": message, "thread_id": thread_id, **extra})
    assert response.status_code == 200
    payload = response.json()
    reply = payload.get("response") or {}
    state = client.get(f"/chat/{payload['thread_id']}/state").json()
    assert not payload.get("confirmation") and not state.get("committed")
    print("turn", reply.get("kind"), [t["agent"] for t in (state.get("plan") or {}).get("tasks", [])])
    assert reply.get("kind") in {"ANSWER", "PARTIAL"}, reply.get("text")
    return payload, state


def results(payload):
    return {r["agent"]: r for r in payload["response"]["data"]["results"].values()}


def test_housing_selection_to_route_and_flight():
    with client_for("journey_" + uuid.uuid4().hex) as client:
        first, _ = turn(client, "Tìm nhà có 2 phòng ngủ ở Quận 1, Thành phố Hồ Chí Minh dưới 10 triệu đồng mỗi tháng.")
        houses = results(first)["property"]["data"]["candidates"]
        assert houses and all(h["bedrooms"] == 2 for h in houses)
        second, state = turn(
            client,
            "Chọn căn số 1. Tính đường đi bộ từ căn đã chọn đến Takashimaya tại Thành phố Hồ Chí Minh; "
            "đồng thời tìm chuyến bay từ Hà Nội đến Đà Nẵng ngày 15/11/2026 cho 1 người lớn. "
            "Chỉ xem thông tin, không đặt vé.",
            first["thread_id"],
        )
        selected = state["intake"]["user_confirmed_facts"]["selected:property"]["value"]
        assert selected == houses[0]["id"]
        plan = state["plan"]["tasks"]
        map_task = next(t for t in plan if t["agent"] == "map")
        assert map_task["inputs"]["selected_listing_id"] == selected
        answer = results(second)
        assert answer["map"]["data"]["routing"]["route"]["distance_meters"] > 0
        assert answer["flight"]["data"]["offers"]
        assert all(r["data"].get("agent_trace", {}).get("model") == "gpt-6-luna" for r in answer.values())


def test_moving_time_change_and_owned_payment_status():
    db_path = (live.agent_state_dir() / "runtime.sqlite3").resolve()
    if not db_path.exists():
        pytest.skip("No existing runtime DB")
    with sqlite3.connect(db_path.as_uri() + "?mode=ro", uri=True) as db:
        payment = db.execute("SELECT id,data FROM records WHERE namespace='sandbox_payment_owners' LIMIT 1").fetchone()
    if not payment:
        pytest.skip("No owned real sandbox payment; never create a test payment")
    payment_id, owner = payment[0], json.loads(payment[1])["owner"]
    route = json.loads(live.env_test("MOVING_LIVE_QUOTE_INPUTS"))
    pins = {
        "pickup": {"address": route["from_address"], **route["pickup_coordinate"], "confirmed": True},
        "destination": {"address": route["to_address"], **route["destination_coordinate"], "confirmed": True},
    }
    with client_for(owner) as client:
        first, state = turn(
            client,
            f"Chỉ báo giá chuyển đồ từ {route['from_address']} đến {route['to_address']} ngày 2/10/2026 lúc 09:00. "
            "Dùng hai điểm tôi đã xác nhận trên form, không đặt xe.",
            moving_locations=pins,
        )
        assert results(first)["relocation"]["data"]["quotes"]
        assert state["intake"]["constraints"]["values"]["move_time"] == "09:00"
        second, state = turn(
            client,
            "Đổi giờ xe đến thành 10:00, giữ nguyên ngày và hai điểm. Đồng thời tra trạng thái thanh toán ZaloPay "
            + payment_id
            + ". Chỉ báo giá, không đặt xe và không tạo thanh toán.",
            first["thread_id"],
            moving_locations=pins,
        )
        answer = results(second)
        assert state["intake"]["constraints"]["values"]["move_time"] == "10:00"
        assert answer["relocation"]["data"]["quotes"]
        assert answer["payment"]["data"]["payment"]["payment_id"] == payment_id
        assert answer["payment"]["data"]["agent_trace"]["model"] == "gpt-6-luna"
