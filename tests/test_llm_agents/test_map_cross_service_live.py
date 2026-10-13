"""Read-only journeys across Housing and Map with real data/providers."""

import os
import uuid

import httpx
import pytest

from tests import live

pytestmark = pytest.mark.skipif(os.getenv("RUN_LIVE_INTEGRATION") != "1", reason="Real services opt-in")


def test_selected_house_nearby_then_reverse_route():
    headers = {"Authorization": "Bearer " + live.api_token(), "X-User-Id": "map_" + uuid.uuid4().hex}
    with httpx.Client(base_url=live.api_url(), headers=headers, timeout=240) as client:
        thread = None

        def turn(message):
            nonlocal thread
            reply = client.post("/chat", json={"message": message, "thread_id": thread})
            reply.raise_for_status()
            payload = reply.json()
            thread = payload["thread_id"]
            state = client.get(f"/chat/{thread}/state").json()
            print(
                "turn",
                payload["response"]["kind"],
                [(t["agent"], t["id"]) for t in (state.get("plan") or {}).get("tasks", [])],
            )
            assert not payload.get("confirmation") and not state.get("committed")
            return payload, state

        first, _ = turn("Tìm nhà có đúng 2 phòng ngủ ở Quận 1, Thành phố Hồ Chí Minh dưới 10 triệu một tháng.")
        houses = next(
            r["data"]["candidates"] for r in first["response"]["data"]["results"].values() if r["agent"] == "property"
        )
        assert len(houses) >= 2
        _, state = turn("Tôi chọn căn thứ hai.")
        selected = state["intake"]["user_confirmed_facts"]["selected:property"]["value"]
        assert selected == houses[1]["id"]
        third, state = turn("Tìm bệnh viện và nhà thuốc quanh căn đã chọn trong bán kính 1000 mét.")
        assert third["response"]["kind"] in {"ANSWER", "PARTIAL"}, third["response"]["text"]
        map_task = next(t for t in state["plan"]["tasks"] if t["agent"] == "map")
        assert map_task["inputs"]["selected_listing_id"] == selected
        nearby = third["response"]["data"]["results"][map_task["id"]]["data"]
        assert selected in nearby["nearby"]
        assert all(p["distance_m"] <= 1000 for p in nearby["nearby"][selected])
        fourth, state = turn("Giờ tính đường đi bộ từ Takashimaya đến căn đó tại Thành phố Hồ Chí Minh.")
        assert fourth["response"]["kind"] in {"ANSWER", "PARTIAL"}, fourth["response"]["text"]
        route_task = next(
            t for t in state["plan"]["tasks"] if t["agent"] == "map" and t["inputs"].get("map_mode") == "route"
        )
        assert route_task["inputs"]["route_to"] == "selected:property"
        assert route_task["inputs"]["selected_listing_id"] == selected
        routing = fourth["response"]["data"]["results"][route_task["id"]]["data"]["routing"]
        assert routing["profile"] == "walking" and routing["route"]["distance_meters"] > 0
        fifth, state = turn("Không cần tính đường nữa. Chỉ tìm siêu thị quanh căn đó trong bán kính 500 mét.")
        assert fifth["response"]["kind"] in {"ANSWER", "PARTIAL"}, fifth["response"]["text"]
        nearby_task = next(
            t for t in state["plan"]["tasks"] if t["agent"] == "map" and t["inputs"].get("radius_m") == 500
        )
        assert nearby_task["inputs"]["selected_listing_id"] == selected
        assert nearby_task["inputs"]["categories"] == ["supermarket"]
        nearby_again = fifth["response"]["data"]["results"][nearby_task["id"]]["data"]
        assert all(p["distance_m"] <= 500 for p in nearby_again["nearby"][selected])


def test_ambiguous_post_office_route_does_not_guess():
    headers = {"Authorization": "Bearer " + live.api_token(), "X-User-Id": "map_" + uuid.uuid4().hex}
    with httpx.Client(base_url=live.api_url(), headers=headers, timeout=240) as client:
        reply = client.post(
            "/chat",
            json={
                "message": "Tính đường đi bộ từ Bưu điện Trung tâm Sài Gòn đến Takashimaya tại Thành phố Hồ Chí Minh."
            },
        )
        reply.raise_for_status()
        payload = reply.json()
        response = payload["response"]
        print("ambiguous", response["kind"], response["text"][:400])
        assert response["kind"] == "CLARIFY", response["text"]
        assert not any(r.get("data", {}).get("routing") for r in response["data"]["results"].values())
