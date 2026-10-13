"""Real multi-service requests: assert execution intervals, not just plan shape."""

import json
import os
import uuid
from datetime import datetime

import httpx
import pytest

from tests import live

pytestmark = pytest.mark.skipif(os.getenv("RUN_LIVE_INTEGRATION") != "1", reason="Real services opt-in")


def execute(message, **extra):
    with httpx.Client(
        base_url=live.api_url(),
        headers={"Authorization": "Bearer " + live.api_token(), "X-User-Id": "complex_" + uuid.uuid4().hex},
        timeout=300,
    ) as client:
        response = client.post("/chat", json={"message": message, **extra})
        assert response.status_code == 200
        payload = response.json()
        reply = payload.get("response") or {}
        assert reply.get("kind") in {"ANSWER", "PARTIAL"}, reply.get("text")
        state = client.get(f"/chat/{payload['thread_id']}/state").json()
        assert not state.get("committed") and not payload.get("confirmation")
        results = reply["data"]["results"]
        print(
            json.dumps(
                {
                    "thread_id": payload["thread_id"],
                    "tasks": [
                        {"id": t["id"], "agent": t["agent"], "depends_on": t["depends_on"]}
                        for t in state["plan"]["tasks"]
                    ],
                    "execution": {r["agent"]: r["data"]["execution"] for r in results.values()},
                    "llm_calls": {r["agent"]: r["usage"]["llm_calls"] for r in results.values()},
                },
                ensure_ascii=False,
            )
        )
        for result in results.values():
            own = result["data"]["execution"]
            assert result["usage"]["llm_calls"] <= own["allocated_llm_calls"]
            for dependency in own["depends_on"]:
                assert datetime.fromisoformat(own["started_at"]) >= datetime.fromisoformat(
                    results[dependency]["data"]["execution"]["finished_at"]
                )
        return {r["agent"]: r for r in results.values()}


def overlaps(a, b):
    a, b = a["data"]["execution"], b["data"]["execution"]
    return max(datetime.fromisoformat(a["started_at"]), datetime.fromisoformat(b["started_at"])) < min(
        datetime.fromisoformat(a["finished_at"]), datetime.fromisoformat(b["finished_at"])
    )


def test_housing_flight_parallel_then_map():
    results = execute(
        "Tìm nhà có 2 phòng ngủ tại Quận 1, Thành phố Hồ Chí Minh dưới 10 triệu đồng mỗi tháng, "
        "và tìm bệnh viện gần các căn tìm được trong bán kính 1500 mét. Đồng thời tìm chuyến bay "
        "từ Hà Nội đến Thành phố Hồ Chí Minh ngày 15/11/2026 cho 2 người lớn. Chỉ tìm kiếm, không đặt gì."
    )
    assert set(results) == {"property", "map", "flight"}
    assert overlaps(results["property"], results["flight"])
    assert results["map"]["data"]["execution"]["depends_on"]
    assert results["property"]["data"]["candidates"]
    assert all(c["bedrooms"] == 2 for c in results["property"]["data"]["candidates"])
    assert results["flight"]["data"]["offers"]


def test_moving_flight_route_independent():
    route = json.loads(live.env_test("MOVING_LIVE_QUOTE_INPUTS"))
    pins = {
        "pickup": {"address": route["from_address"], **route["pickup_coordinate"], "confirmed": True},
        "destination": {"address": route["to_address"], **route["destination_coordinate"], "confirmed": True},
    }
    results = execute(
        f"Làm 3 việc độc lập: (1) Chỉ báo giá chuyển đồ từ {route['from_address']} đến {route['to_address']} "
        "ngày mai lúc 9 giờ, dùng hai điểm đã xác nhận trên form; (2) Tìm chuyến bay Hà Nội đến Đà Nẵng "
        "ngày 15/11/2026 cho 1 người lớn; (3) Tính đường đi bộ từ Dinh Độc Lập Cafe đến Takashimaya "
        "tại Thành phố Hồ Chí Minh. Không đặt xe, không đặt vé, không thanh toán.",
        moving_locations=pins,
    )
    assert set(results) == {"relocation", "flight", "map"}
    assert all(not r["data"]["execution"]["depends_on"] for r in results.values())
    for a, b in [("relocation", "flight"), ("relocation", "map"), ("map", "flight")]:
        assert overlaps(results[a], results[b])
    assert results["relocation"]["data"]["quotes"]
    assert results["flight"]["data"]["offers"]
    assert results["map"]["data"]["routing"]["route"]["distance_meters"] > 0
