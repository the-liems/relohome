"""Real multi-turn context regressions, with no booking or payment writes."""

import json
import os
import uuid
from datetime import datetime, timedelta, timezone

import httpx
import pytest

from tests import live

pytestmark = pytest.mark.skipif(os.getenv("RUN_LIVE_INTEGRATION") != "1", reason="Real services opt-in")


def client():
    return httpx.Client(
        base_url=live.api_url(),
        timeout=240,
        headers={"Authorization": "Bearer " + live.api_token(), "X-User-Id": "context_" + uuid.uuid4().hex},
    )


def ask(c, message, thread=None, **extra):
    r = c.post("/chat", json={"message": message, "thread_id": thread, **extra})
    r.raise_for_status()
    p = r.json()
    s = c.get(f"/chat/{p['thread_id']}/state").json()
    reply = p.get("response") or {}
    print("thread", p["thread_id"], "kind", reply.get("kind"), "text", reply.get("text", "")[:1400])
    assert not p.get("confirmation") and not s.get("committed")
    assert reply.get("kind") != "ERROR", reply.get("text")
    return p, s


def test_selected_house_as_moving_pickup_with_vague_time():
    with client() as c:
        first, _ = ask(c, "Tìm nhà có đúng 2 phòng ngủ ở Quận 1, Thành phố Hồ Chí Minh, dưới 10 triệu mỗi tháng.")
        candidates = next(
            r["data"]["candidates"] for r in first["response"]["data"]["results"].values() if r["agent"] == "property"
        )
        assert len(candidates) >= 2
        thread = first["thread_id"]
        _, chosen = ask(c, "Căn thứ hai nhé.", thread)
        selected = chosen["intake"]["user_confirmed_facts"]["selected:property"]["value"]
        assert selected == candidates[1]["id"]
        third, state = ask(
            c,
            "Tôi chuyển đồ từ chỗ đó đến Bưu điện Trung tâm Sài Gòn, Thành phố Hồ Chí Minh ngày 02/10/2026, "
            "tầm chiều. Chỉ xem giá trước.",
            thread,
        )
        values = state["intake"]["constraints"]["values"]
        assert values.get("from_address") == "selected:property", values.get("from_address")
        assert values.get("move_date") == "2026-10-02"
        assert not values.get("move_time"), "A vague afternoon must not become an invented exact time"
        assert any("move_time" in q["field"] for q in third["response"]["questions"])
        assert "selected:property" not in third["response"]["text"]
        fourth, state = ask(c, "15 giờ nhé, còn lại giữ nguyên.", thread)
        values = state["intake"]["constraints"]["values"]
        assert values["move_time"] == "15:00"
        assert values["from_address"] == "selected:property"
        assert values["move_date"] == "2026-10-02"
        task = next(t for t in state["plan"]["tasks"] if t["agent"] == "relocation")
        assert task["inputs"]["selected_listing_id"] == selected
        assert "selected:property" not in fourth["response"]["text"]
        # Approximate house coordinates must produce a focused pin question,
        # not be silently upgraded to rooftop accuracy for a vehicle booking.
        if candidates[1].get("location_accuracy") != "rooftop":
            assert any("from_address" in q["field"] for q in fourth["response"]["questions"])
            assert candidates[1]["address"] in fourth["response"]["text"]


def test_bad_date_then_correction_and_reverse_previous_points():
    route = json.loads(live.env_test("MOVING_LIVE_QUOTE_INPUTS"))
    pins = {
        "pickup": {"address": route["from_address"], **route["pickup_coordinate"], "confirmed": True},
        "destination": {"address": route["to_address"], **route["destination_coordinate"], "confirmed": True},
    }
    with client() as c:
        first, _ = ask(
            c,
            f"Tôi chuyển đồ từ {route['from_address']} đến {route['to_address']} ngày 31/11/2026 lúc 09 giờ. "
            "Chỉ xem báo giá, không đặt xe.",
            moving_locations=pins,
        )
        assert first["response"]["kind"] == "CLARIFY", "November 31 must require a date correction"
        thread = first["thread_id"]
        second, s = ask(c, "À nhầm, ngày 3/10/2026 nhé, còn lại như cũ.", thread)
        values = s["intake"]["constraints"]["values"]
        assert values["move_date"] == "2026-10-03"
        assert values["move_time"] == "09:00"
        assert second["response"]["kind"] == "ANSWER"
        assert s["task_status"] and "done" in s["task_status"].values(), second["response"]["text"]
        third, s = ask(
            c, "Đổi chiều nhé: lấy ở điểm giao vừa rồi, giao về điểm lấy cũ. Ngày giờ giữ nguyên, chỉ báo giá.", thread
        )
        values = s["intake"]["constraints"]["values"]
        assert values["from_address"] == route["to_address"]
        assert values["to_address"] == route["from_address"]
        assert values["pickup_coordinate"] == route["destination_coordinate"]
        assert values["destination_coordinate"] == route["pickup_coordinate"]
        assert values["move_date"] == "2026-10-03" and values["move_time"] == "09:00"
        assert third["response"]["kind"] == "ANSWER"
        moving = next(r["data"] for r in third["response"]["data"]["results"].values() if r["agent"] == "relocation")
        assert moving["route"]["pickup"]["lat"] == route["destination_coordinate"]["lat"]
        assert moving["route"]["destination"]["lat"] == route["pickup_coordinate"]["lat"]
        assert "done" in s["task_status"].values(), third["response"]["text"]
        fourth, _ = ask(c, "Thôi chỉ đổi giờ thành 25:00.", thread)
        assert fourth["response"]["kind"] == "CLARIFY", "An invalid hour must not reuse an old quote as success"
        assert any(q["field"] == "move_time" for q in fourth["response"]["questions"])
        fifth, s = ask(c, "15 giờ nhé.", thread)
        assert fifth["response"]["kind"] == "ANSWER", fifth["response"]["text"]
        assert s["intake"]["constraints"]["values"]["move_time"] == "15:00"
        assert s["intake"]["constraints"]["values"]["from_address"] == route["to_address"]
        assert "done" in s["task_status"].values(), fifth["response"]["text"]
        quoted = next(r["data"] for r in fifth["response"]["data"]["results"].values() if r["agent"] == "relocation")
        assert quoted["route"]["order_time"] == int(
            datetime(2026, 10, 3, 15, tzinfo=timezone(timedelta(hours=7))).timestamp()
        )


def test_unknown_reference_and_broad_destination_are_not_guessed():
    with client() as c:
        first, state = ask(c, "Báo giá chuyển đồ từ điểm đó về nhà tôi chiều mai.")
        assert first["response"]["kind"] == "CLARIFY"
        assert not state["intake"]["constraints"]["values"].get("pickup_coordinate")
        thread = first["thread_id"]
        second, _ = ask(
            c,
            "Lấy ở Chợ Bến Thành, Thành phố Hồ Chí Minh, giao trong Quận 1 của thành phố đó. "
            "Ngày 3/10/2026 lúc 15 giờ. Chỉ báo giá.",
            thread,
        )
        assert second["response"]["kind"] == "CLARIFY"
        third, state = ask(c, "Chưa có số nhà, cứ lấy giữa quận làm điểm giao đi.", thread)
        assert third["response"]["kind"] == "CLARIFY"
        assert not state["intake"]["constraints"]["values"].get("destination_coordinate")
        assert not any(r.get("data", {}).get("quotes") for r in third["response"]["data"]["results"].values())
