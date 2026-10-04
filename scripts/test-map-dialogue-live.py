"""Opt-in live gateway dialogue; saves evidence locally, never books/pays."""

import argparse
import json
import os
import secrets
import uuid
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "data/map-dialogue-live-20261002.json"
CASES = {
    "restore-housing": "Tìm phòng trọ dưới 5 triệu gần Trường Đại học Bách khoa, Đại học Quốc gia Thành phố Hồ Chí Minh. Chỉ tìm nhà.",
    "flight-date": "Tôi bay ngày 12/10/2026, một người lớn, chỉ tìm vé trước nhé, chưa đặt gì.",
    "nearby": "Quanh căn tôi vừa chọn trên bản đồ có nhà thuốc nào trong 500 mét? Giữ nguyên lựa chọn nhà và thông tin chuyến bay.",
    "independent-map": "Chỉ tìm bệnh viện gần Bưu điện Trung tâm Sài Gòn trong 1000 mét. Không thay căn nhà tôi đã chọn.",
    "return-map": "Bây giờ chỉ tìm nhà thuốc quanh căn nhà đã chọn trong 700 mét, không phải quanh bưu điện nữa.",
    "moving": "Tôi muốn chuyển đồ từ Bưu điện Trung tâm Sài Gòn đến căn nhà đã chọn ngày 13/10/2026. Chỉ báo giá, không đặt xe.",
    "time": "Khoảng 16 giờ nhé. Địa điểm và ngày giữ nguyên.",
    "change-time": "Đổi giờ chuyển đồ thành 17 giờ, các thông tin khác giữ nguyên.",
    "correct-pickup": "Đổi điểm lấy thành Trường Đại học Bách khoa, Đại học Quốc gia Thành phố Hồ Chí Minh; vẫn giao tới căn nhà đã chọn. Giữ nguyên ngày giờ.",
    "disabled-flight-booking": "Đặt vé máy bay từ Hà Nội vào thành phố Hồ Chí Minh ngày 12/10/2026 cho một người lớn. Đồng thời tìm nhà thuốc quanh căn nhà tôi đã chọn trong 500 mét.",
    "wrong-date": "Đổi ngày chuyển đồ sang 31/02/2027, giờ giữ nguyên.",
    "correct-date": "Vậy chuyển ngày 05/10/2026, giờ và hai điểm giữ như đã xác nhận. Chỉ lấy báo giá.",
    "repair-date-and-time": "À nhầm, ngày 05/10/2026. Đổi giờ thành 17 giờ, hai điểm giữ nguyên. Chỉ lấy báo giá.",
}


def verify(saved):
    """Check recorded real responses; no fixture substitution or provider calls."""
    turns = saved["turns"]

    def by_case(name):
        return [t["snapshot"] for t in turns if t.get("message") == CASES[name]][-1]

    def reply(snapshot):
        return snapshot["messages"][-1]["content"]["response"]

    for turn in turns:
        snapshot = turn["snapshot"]
        assert not snapshot["state"].get("committed")
        assert not snapshot["messages"][-1]["content"].get("confirmation")
        assert not (snapshot["state"].get("plan") or {}).get("commit_actions")
    first = reply(turns[0]["snapshot"])
    assert sum(q["field"] == "flight.flight_date" for q in first["questions"]) == 1
    assert next(q for q in first["questions"] if q["field"] == "near")["choices"]
    selected = next(
        t["snapshot"]["state"]["selections"]["property"]
        for t in turns
        if t.get("action") == "browser-map-house-selection"
    )
    assert selected["origin"] == "map_workspace" and selected["price_vnd"] <= 5_000_000
    flight = by_case("flight-date")
    assert flight["state"]["selections"]["property"]["id"] == selected["id"]
    assert flight["state"]["intake"]["constraints"]["values"]["max_price_vnd"] == 5_000_000
    result = next(r for r in reply(flight)["data"]["results"].values() if r["agent"] == "flight")
    assert result["source_kind"] == "live" and result["data"]["offers"]
    for case, radius in [("nearby", 500), ("return-map", 700)]:
        snapshot = by_case(case)
        task = next(t for t in snapshot["state"]["plan"]["tasks"] if t["agent"] == "map")
        assert task["inputs"]["selected_listing_id"] == selected["id"]
        assert task["inputs"]["radius_m"] == radius
        assert snapshot["state"]["task_status"][task["id"]] == "done"
        assert not snapshot["state"]["intake"]["constraints"]["values"].get("map_near")
    moving = by_case("moving")
    assert moving["state"]["selections"]["property"]["id"] == selected["id"]
    assert {q["field"] for q in reply(moving)["questions"]} == {"relocation.move_time"}
    time = by_case("time")["state"]["intake"]["constraints"]["values"]
    assert time["move_date"] == "2026-10-13" and time["move_time"] == "16:00"
    quoted = by_case("correct-date")
    result = next(r for r in reply(quoted)["data"]["results"].values() if r["agent"] == "relocation")
    assert reply(quoted)["kind"] == "ANSWER" and result["source_kind"] == "sandbox"
    assert len(result["data"]["quotes"]) >= 2
    old = quoted["state"]["intake"]["constraints"]["values"]
    assert old["destination_coordinate"] == {"lat": selected["lat"], "lng": selected["lng"]}
    invalid = reply(by_case("wrong-date"))
    assert invalid["kind"] == "CLARIFY" and any(q["field"] == "move_date" for q in invalid["questions"])
    changed = by_case("repair-date-and-time")
    new = changed["state"]["intake"]["constraints"]["values"]
    assert reply(changed)["kind"] == "ANSWER" and new["move_time"] == "17:00"
    assert all(new[key] == old[key] for key in ("move_date", "pickup_coordinate", "destination_coordinate"))
    disabled = by_case("disabled-flight-booking")
    assert "flight_booking" in disabled["state"]["intake"]["unavailable_commit_requested"]
    assert reply(disabled)["kind"] == "ANSWER" and "flight_booking" in reply(disabled)["data"]["unavailable_actions"]
    assert {r["agent"] for r in reply(disabled)["data"]["results"].values()} >= {"map", "flight"}
    print(
        f"Verified real evidence across {len(turns)} interactions (including recorded pre-fix failures). No LLM calls."
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["start", "turn", "state", "verify"])
    parser.add_argument("--message")
    parser.add_argument("--case", choices=CASES)
    args = parser.parse_args()
    saved = json.loads(EVIDENCE.read_text(encoding="utf-8")) if EVIDENCE.exists() else {}
    if args.mode == "verify":
        verify(saved)
        return
    if args.mode in {"start", "turn"} and os.getenv("RUN_LIVE_INTEGRATION") != "1":
        parser.error("Set RUN_LIVE_INTEGRATION=1: these modes call paid real services.")
    with httpx.Client(
        base_url="http://127.0.0.1:8503/web/api",
        timeout=240,
        headers={"x-siu-request": "1"},
        cookies={} if args.mode == "start" else saved.get("cookies", {}),
    ) as client:
        if args.mode == "start":
            r = client.post(
                "/auth/register",
                json={
                    "email": f"live-{uuid.uuid4().hex}@example.invalid",
                    "password": secrets.token_urlsafe(24),
                    "name": "Live Map QA",
                },
            )
            r.raise_for_status()
            r = client.post("/threads")
            r.raise_for_status()
            previous_runs = saved.get("previous_runs", []) + (
                [{k: saved[k] for k in ("thread", "turns")}] if saved else []
            )
            saved = {
                "thread": r.json()["id"],
                "cookies": dict(client.cookies),
                "turns": [],
                "previous_runs": previous_runs,
            }
        if args.mode != "state":
            # Do not enqueue a message during a local API restart.
            client.get("/status").raise_for_status()
            message = (
                args.message
                or CASES.get(args.case)
                or "tìm phòng trọ dướ 5 triệu ở gần trường đại học bách khoa thành phố Hồ Chí Minh và đặt vé máy bay từ Hà Nội vào đó để tôi xem phòng."
            )
            r = client.post(
                f"/threads/{saved['thread']}/chat", json={"request_id": uuid.uuid4().hex, "message": message}
            )
            r.raise_for_status()
            snapshot = r.json()
            saved["turns"].append({"message": message, "snapshot": snapshot})
        else:
            r = client.get(f"/threads/{saved['thread']}")
            r.raise_for_status()
            snapshot = r.json()
        EVIDENCE.write_text(json.dumps(saved, ensure_ascii=False, indent=2), encoding="utf-8")
        # Only public answer/state; never print authentication cookies.
        state = snapshot.get("state", {})
        reply = snapshot.get("messages", [])[-1:]
        response = reply[0]["content"].get("response", {}) if reply else {}
        print(
            json.dumps(
                {
                    "thread": saved["thread"],
                    "reply": {k: response.get(k) for k in ("kind", "text", "questions")},
                    "constraints": (state.get("intake") or {}).get("constraints"),
                    "plan": state.get("plan"),
                    "task_status": state.get("task_status"),
                    "selections": state.get("selections"),
                },
                ensure_ascii=False,
                indent=2,
            )
        )


if __name__ == "__main__":
    main()
