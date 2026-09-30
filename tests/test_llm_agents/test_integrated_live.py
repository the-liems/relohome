"""Actual HTTP API -> OpenAI -> LangGraph -> running MCP -> real data/provider.

Opt in: RUN_LIVE_INTEGRATION=1. No fake services or transaction calls.
"""

import json
import os
import uuid
from pathlib import Path

import httpx
import pytest
from dotenv import dotenv_values

pytestmark = pytest.mark.skipif(os.getenv("RUN_LIVE_INTEGRATION") != "1", reason="Real services opt-in")
ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def client():
    env = dotenv_values(ROOT / "data/integration.env")
    with httpx.Client(
        base_url="http://127.0.0.1:8000/api/v1",
        timeout=240,
        headers={"Authorization": "Bearer " + env["AGENT_API_TOKEN"], "X-User-Id": "acceptance_" + uuid.uuid4().hex},
    ) as session:
        yield session


def ask(client, text, thread=None, **extra):
    response = client.post("/chat", json={"message": text, "thread_id": thread, **extra})
    assert response.status_code == 200, response.status_code
    return response.json()


def data_by_agent(payload):
    response = payload.get("response") or {}
    data = response.get("data") or {}
    return data


def test_auth_and_cross_user_thread(client):
    assert httpx.get("http://127.0.0.1:8000/api/v1/status").status_code == 401
    result = ask(client, "Xin chào")
    r = client.post(
        "/chat",
        headers={"X-User-Id": "different-owner"},
        json={"message": "Xin chào", "thread_id": result["thread_id"]},
    )
    assert r.status_code == 404


def test_housing_real_graph(client):
    result = ask(client, "Tìm phòng trọ tại Thành phố Hồ Chí Minh dưới 5 triệu đồng mỗi tháng")
    response = result.get("response") or {}
    assert response.get("kind") in {"ANSWER", "PARTIAL"}, response
    data = data_by_agent(result)
    assert "candidates" in str(data), response
    assert "fake" not in str(data) and "demo" not in str(data)


def test_flight_real_graph(client):
    result = ask(client, "Chỉ tìm chuyến bay từ Hà Nội đến Đà Nẵng ngày 15/11/2026 cho 1 người lớn, không đặt vé")
    response = result.get("response") or {}
    assert response.get("kind") in {"ANSWER", "PARTIAL"}, response
    data = data_by_agent(result)
    assert "offers" in str(data), response
    assert "demo" not in str(data)


def test_clarification_multiturn(client):
    first = ask(client, "Tôi muốn tìm phòng trọ")
    assert first["response"]["kind"] == "CLARIFY", first
    second = ask(client, "Tại Thành phố Hồ Chí Minh, dưới 5 triệu đồng mỗi tháng", first["thread_id"])
    assert second["thread_id"] == first["thread_id"]
    assert second["response"]["kind"] in {"ANSWER", "PARTIAL"}, second


def test_map_after_housing(client):
    result = ask(
        client, "Tìm phòng trọ tại Thành phố Hồ Chí Minh dưới 5 triệu đồng mỗi tháng và các bệnh viện gần các phòng đó"
    )
    response = result.get("response") or {}
    assert response.get("kind") in {"ANSWER", "PARTIAL"}, response
    results = data_by_agent(result).get("results", {})
    assert {r["agent"] for r in results.values()} >= {"property", "map"}, response


def test_moving_quote_graph(client):
    result = ask(
        client,
        "Chỉ báo giá chuyển đồ từ Chợ Bến Thành đến Bưu điện Trung tâm Sài Gòn tại Thành phố Hồ Chí Minh, ngày mai lúc 9 giờ sáng. Không đặt xe.",
    )
    response = result.get("response") or {}
    # Ambiguous or approximate locations must ask instead of inventing coordinates.
    assert response.get("kind") in {"ANSWER", "PARTIAL", "CLARIFY"}, response
    if response.get("kind") == "CLARIFY":
        assert response.get("questions"), response
    else:
        results = data_by_agent(result).get("results", {})
        moving = [r for r in results.values() if r["agent"] == "relocation"]
        assert moving and moving[0]["data"].get("quotes"), response
        assert moving[0]["source_kind"] == "sandbox"


def test_moving_confirmed_pins_quote(client):
    env = dotenv_values(ROOT / ".env")
    assert env.get("MOVING_LIVE_QUOTE_INPUTS"), "Configure the operator-approved real route first"
    route = json.loads(env["MOVING_LIVE_QUOTE_INPUTS"])
    pins = {
        "pickup": {"address": route["from_address"], **route["pickup_coordinate"], "confirmed": True},
        "destination": {"address": route["to_address"], **route["destination_coordinate"], "confirmed": True},
    }
    result = ask(
        client,
        f"Chỉ báo giá chuyển đồ từ {route['from_address']} đến {route['to_address']} ngày mai lúc 9 giờ sáng, dùng các điểm tôi xác nhận trên form. Không đặt xe.",
        moving_locations=pins,
    )
    response = result.get("response") or {}
    assert response.get("kind") in {"ANSWER", "PARTIAL"}, response
    moving = [r for r in data_by_agent(result).get("results", {}).values() if r["agent"] == "relocation"]
    assert moving and moving[0]["data"].get("quotes"), response
    assert all(q["price_vnd"] > 0 for q in moving[0]["data"]["quotes"])
    assert moving[0]["source_kind"] == "sandbox"
    assert result["status"] == "done"
