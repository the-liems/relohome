"""Real, existing sandbox payment only. Never create or simulate a transaction."""

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
BASE_URL = live.api_url()


def test_existing_owned_payment_and_foreign_owner():
    path = (live.agent_state_dir() / "runtime.sqlite3").resolve()
    if not path.exists():
        pytest.skip("No real runtime database available")
    with sqlite3.connect(path.as_uri() + "?mode=ro", uri=True) as db:
        row = db.execute("SELECT id,data FROM records WHERE namespace='sandbox_payment_owners' LIMIT 1").fetchone()
    if not row:
        pytest.skip("No existing owned sandbox payment; this test does not create one")
    payment_id, record = row
    owner = json.loads(record)["owner"]
    with httpx.Client(
        base_url=BASE_URL, timeout=240, headers={"Authorization": "Bearer " + live.api_token()}
    ) as client:
        status = client.get("/status", headers={"X-User-Id": owner}).json()
        assert status["domain_agents"]["payment"]["uses_llm"]
        message = "Chỉ kiểm tra trạng thái thanh toán ZaloPay " + payment_id + ", không tạo hay thay đổi giao dịch."
        reply = client.post("/chat", headers={"X-User-Id": owner}, json={"message": message})
        assert reply.status_code == 200
        response = reply.json()["response"]
        assert response["kind"] in {"ANSWER", "PARTIAL"}, response
        result = next(r for r in response["data"]["results"].values() if r["agent"] == "payment")
        assert result["data"]["payment"]["payment_id"] == payment_id
        assert result["source_kind"] == "sandbox"
        assert result["data"]["agent_trace"]["tools"] == ["get_payment", "finish"]
        foreign_actor = "foreign_" + uuid.uuid4().hex
        foreign = client.post("/chat", headers={"X-User-Id": foreign_actor}, json={"message": message})
        assert foreign.status_code == 200
        results = (foreign.json().get("response") or {}).get("data", {}).get("results", {})
        assert not any(r.get("data", {}).get("payment") for r in results.values())
        assert all(r.get("usage", {}).get("provider_calls", 0) == 0 for r in results.values())
        state = client.get(f"/chat/{foreign.json()['thread_id']}/state", headers={"X-User-Id": foreign_actor}).json()
        tasks = [task for task in (state.get("plan") or {}).get("tasks", []) if task["agent"] == "payment"]
        assert tasks, "Ownership check must be exercised, not bypassed by an unrelated Intake failure"
        assert all(state["task_status"].get(task["id"]) == "failed" for task in tasks)
