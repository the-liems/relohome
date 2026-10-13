"""Live conversation regressions: actual API/LLM/MCP, no transaction writes."""

import os
import uuid

import httpx
import pytest

from tests import live

pytestmark = pytest.mark.skipif(os.getenv("RUN_LIVE_INTEGRATION") != "1", reason="Real services opt-in")
BASE_URL = live.api_url()


@pytest.fixture
def client():
    with httpx.Client(
        base_url=BASE_URL,
        timeout=240,
        headers={
            "Authorization": "Bearer " + live.api_token(),
            "X-User-Id": "multiturn_" + uuid.uuid4().hex,
        },
    ) as session:
        yield session


def turn(client, message, thread=None):
    response = client.post("/chat", json={"message": message, "thread_id": thread})
    assert response.status_code == 200
    result = response.json()
    state = client.get(f"/chat/{result['thread_id']}/state").json()
    print("response", result.get("response", {}).get("text"))
    print("constraints", (state.get("intake") or {}).get("constraints"))
    assert (result.get("response") or {}).get("kind") != "ERROR", result
    return result, state


def test_shared_map_search_and_housing_coordinate(client):
    found = client.get("/map/search", params={"text": "Bách khoa Hà Nội"})
    assert found.status_code == 200
    places = found.json()["results"]
    school = next(p for p in places if p["name"] == "Đại học Bách khoa Hà Nội")
    assert school["source"]["source_id"]
    pin = {"address": school["name"], **school["location"], "confirmed": True}
    reply = client.post("/chat", json={"message": "Tìm phòng gần " + school["name"], "housing_location": pin})
    assert reply.status_code == 200
    payload = reply.json()
    assert payload["response"]["kind"] in {"ANSWER", "PARTIAL"}, payload
    state = client.get(f"/chat/{payload['thread_id']}/state").json()
    assert state["intake"]["intent"]["domains"] == ["property"]
    assert state["intake"]["constraints"]["values"]["near_coordinate"] == school["location"]
    tasks = [t for t in state["plan"]["tasks"] if t["agent"] == "property"]
    assert tasks and tasks[0]["inputs"]["near_coordinate"] == school["location"]
    assert not state.get("committed")


def test_map_picker_rejects_invalid_input(client):
    assert client.get("/map/search", params={"text": "x"}).status_code == 422
    assert client.get("/map/search", params={"text": "   "}).status_code == 422
    assert httpx.get(BASE_URL + "/map/search", params={"text": "Hà Nội"}).status_code == 401
    assert (
        client.post(
            "/chat",
            json={
                "message": "Tìm nhà gần điểm này",
                "housing_location": {"address": "Hà Nội", "lat": 999, "lng": 0, "confirmed": True},
            },
        ).status_code
        == 422
    )


def test_housing_map_pin_is_invalidated_when_area_changes(client):
    found = client.get("/map/search", params={"text": "Bách khoa Hà Nội"}).json()
    school = next(p for p in found["results"] if p["name"] == "Đại học Bách khoa Hà Nội")
    reply = client.post(
        "/chat",
        json={
            "message": "Tìm phòng gần " + school["name"],
            "housing_location": {"address": school["name"], **school["location"], "confirmed": True},
        },
    ).json()
    assert reply["response"]["kind"] in {"ANSWER", "PARTIAL"}, reply
    _, state = turn(client, "Đổi sang tìm gần Bưu điện Trung tâm Sài Gòn, Thành phố Hồ Chí Minh", reply["thread_id"])
    assert "near_coordinate" not in state["intake"]["constraints"]["values"]
    assert "Bách khoa" not in state["intake"]["constraints"]["values"].get("near", "")
    assert not state.get("committed")


def test_moving_followups_keep_date_time_and_addresses(client):
    first, state = turn(client, "tôi muốn chuyển đồ ngày 2/10/2026, chiều 15 giờ từ kí túc xá khu B đến quận 1")
    values = state["intake"]["constraints"]["values"]
    assert values["move_date"] == "2026-10-02" and values["move_time"] == "15:00"
    second, state = turn(client, "Điểm giao là 12 Nguyễn Huệ, Quận 1, Thành phố Hồ Chí Minh", first["thread_id"])
    values = state["intake"]["constraints"]["values"]
    assert values["move_date"] == "2026-10-02" and values["move_time"] == "15:00"
    assert "khu b" in values["from_address"].lower()
    assert "12" in values["to_address"]
    assert not any(
        q["field"] in {"move_date", "move_time", "relocation.move_date", "relocation.move_time"}
        for q in (second.get("response") or {}).get("questions", [])
    )
    third, state = turn(client, "Đổi giờ thành 16 giờ, còn ngày và hai địa chỉ giữ nguyên", first["thread_id"])
    values = state["intake"]["constraints"]["values"]
    assert values["move_date"] == "2026-10-02" and values["move_time"] == "16:00"
    assert "12" in values["to_address"] and "khu b" in values["from_address"].lower()
    assert not state.get("committed")


def test_housing_refinement_selection_and_new_goal(client):
    first, state = turn(client, "Tìm nhà có 2 phòng ngủ ở Quận 1, Thành phố Hồ Chí Minh")
    second, state = turn(client, "Dưới 10 triệu một tháng nhé", first["thread_id"])
    values = state["intake"]["constraints"]["values"]
    assert values["max_price_vnd"] == 10000000
    assert values["min_bedrooms"] == values["max_bedrooms"] == 2
    assert values["district"].casefold() == "quận 1"
    third, state = turn(
        client, "Thôi bỏ tìm nhà, chỉ tìm chuyến bay từ Hà Nội đến Đà Nẵng ngày 15/11/2026", first["thread_id"]
    )
    assert set(state["intake"]["intent"]["domains"]) == {"flight"}
    assert "max_price_vnd" not in state["intake"]["constraints"]["values"]


def test_flight_followup_only_changes_date(client):
    first, _ = turn(client, "Chỉ tìm chuyến bay từ Hà Nội đến Đà Nẵng ngày 15/11/2026 cho 2 người lớn, không đặt vé")
    second, state = turn(client, "Đổi sang ngày 16/11/2026, vẫn hai người nhé", first["thread_id"])
    values = state["intake"]["constraints"]["values"]
    assert values["origin"] == "Hà Nội" and values["destination"] == "Đà Nẵng"
    assert values["flight_date"] == "2026-11-16" and values["passengers"] == 2
    assert not state.get("committed")


def test_selected_home_routes_with_real_listing_id(client):
    first, _ = turn(client, "Tìm nhà có 2 phòng ngủ ở Quận 1, Thành phố Hồ Chí Minh dưới 10 triệu")
    candidates = next(
        r["data"]["candidates"] for r in first["response"]["data"]["results"].values() if r["agent"] == "property"
    )
    assert candidates
    _, state = turn(client, "Chọn căn số 1", first["thread_id"])
    selected = state["intake"]["user_confirmed_facts"]["selected:property"]["value"]
    assert selected == candidates[0]["id"]
    reply, state = turn(
        client, "Tính đường đi bộ từ căn đã chọn đến Takashimaya tại Thành phố Hồ Chí Minh", first["thread_id"]
    )
    assert reply["response"]["kind"] in {"ANSWER", "PARTIAL"}, reply
    task = next(t for t in state["plan"]["tasks"] if t["agent"] == "map")
    assert task["inputs"]["selected_listing_id"] == selected
    assert task["inputs"]["route_from"] == "selected:property"
    routing = next(r["data"]["routing"] for r in reply["response"]["data"]["results"].values() if r["agent"] == "map")
    assert routing["profile"] == "walking" and routing["route"]["distance_meters"] > 0


def test_select_second_housing_option_uses_previous_results(client):
    first, _ = turn(client, "Tìm nhà có 2 phòng ngủ ở Quận 1, Thành phố Hồ Chí Minh dưới 10 triệu")
    candidates = next(
        r["data"]["candidates"] for r in first["response"]["data"]["results"].values() if r["agent"] == "property"
    )
    assert len(candidates) >= 2
    expected = candidates[1]["id"]
    second, state = turn(client, "Tôi chọn căn thứ 2 trong danh sách vừa rồi. Giá thuê bao nhiêu?", first["thread_id"])
    assert state["intake"]["user_confirmed_facts"]["selected:property"]["value"] == expected
    displayed = next(
        r["displayed_option_ids"] for r in second["response"]["data"]["results"].values() if r["agent"] == "property"
    )
    assert displayed == [expected]
    assert not state.get("committed")


def test_add_map_then_replace_goal_without_stale_results(client):
    first, _ = turn(client, "Tìm nhà có 2 phòng ngủ ở Quận 1, Thành phố Hồ Chí Minh dưới 10 triệu")
    second, state = turn(client, "Tìm thêm các bệnh viện quanh những căn đó", first["thread_id"])
    assert set(state["intake"]["intent"]["domains"]) == {"property", "map"}
    values = state["intake"]["constraints"]["values"]
    assert values["max_price_vnd"] == 10000000 and values["min_bedrooms"] == 2
    third, state = turn(
        client, "Bỏ yêu cầu trên. Bây giờ chỉ muốn chuyển đồ từ Hà Nội đến Đà Nẵng, chưa chọn ngày", first["thread_id"]
    )
    assert state["intake"]["intent"]["domains"] == ["relocation"]
    assert not (third.get("response") or {}).get("data", {}).get("results")
    assert state["plan"] is None
