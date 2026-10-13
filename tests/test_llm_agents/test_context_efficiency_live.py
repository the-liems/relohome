"""Three new, real-provider A/B scenarios; no mocks and no transaction writes.

RUN_LIVE_INTEGRATION=1 opts into paid calls. RUN_EFFICIENCY_SOURCE_ROOT can point
to a source snapshot taken BEFORE editing, not to generated model responses.
Each run owns a separate HTTP server, actor, conversations and runtime database.
Housing results are reused for the Moving scenario to avoid another paid search.
"""

import asyncio
import json
import os
import secrets
import shutil
import socket
import sqlite3
import subprocess
import sys
import time
import uuid
from datetime import datetime, timedelta
from pathlib import Path

import httpx
import pytest
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from relohome_agent.agents.common import utcnow
from relohome_agent.agents.graph import checkpoint_serde
from test_domain_missions_live import ROOT

from tests import live

pytestmark = pytest.mark.skipif(os.getenv("RUN_LIVE_INTEGRATION") != "1", reason="Real providers and paid LLM opt-in")


class ActualRun:
    def __init__(self, client, directory, label):
        self.client, self.directory, self.label = client, directory, label

    def checkpoint(self, thread):
        async def load():
            async with AsyncSqliteSaver.from_conn_string(str(self.directory / "checkpoints.sqlite3")) as saver:
                saver.serde = checkpoint_serde()
                saved = await saver.aget_tuple({"configurable": {"thread_id": thread}})
                assert saved is not None
                return saved.checkpoint["channel_values"]

        return asyncio.run(load())

    def state(self, thread):
        response = self.client.get(f"/chat/{thread}/state")
        response.raise_for_status()
        return response.json()

    def preserve_seed(self, thread):
        """Real checkpoint copy for a matched baseline continuation, not fabricated history."""
        destination = ROOT / "data" / ("efficiency-seed-" + self.label + "-" + uuid.uuid4().hex)
        destination.mkdir()
        for name in ("runtime.sqlite3", "checkpoints.sqlite3"):
            with sqlite3.connect(self.directory / name) as source, sqlite3.connect(destination / name) as target:
                source.backup(target)
        shutil.copy2(self.directory / "pii.key", destination / "pii.key")
        print("EFFICIENCY_SEED " + json.dumps({"thread": thread, "directory": str(destination)}), flush=True)

    def turn(self, case, message, thread=None, *, allow_failure=False, **selection):
        started = time.perf_counter()
        response = self.client.post("/chat", json={"message": message, "thread_id": thread, **selection})
        elapsed = round(time.perf_counter() - started, 3)
        response.raise_for_status()
        payload = response.json()
        checkpoint = self.checkpoint(payload["thread_id"])
        with sqlite3.connect(self.directory / "runtime.sqlite3") as db:
            rows = db.execute(
                "SELECT llm,data FROM usage WHERE thread=? AND request=?",
                (payload["thread_id"], checkpoint["request_id"]),
            ).fetchall()
        usages = [json.loads(row[1]) for row in rows]
        fresh = {
            task: result
            for task, result in checkpoint.get("task_results", {}).items()
            if result.data.get("execution", {}).get("request_id") == checkpoint["request_id"]
        }
        measurement = {
            "label": self.label,
            "case": case,
            "thread_id": payload["thread_id"],
            "elapsed_s": elapsed,
            "kind": payload["response"]["kind"],
            "llm_calls": sum(row[0] for row in rows),
            "tokens_in": sum(u.get("tokens_in", 0) for u in usages),
            "tokens_out": sum(u.get("tokens_out", 0) for u in usages),
            "provider_calls": sum(u.get("provider_calls", 0) for u in usages),
            "fresh_tasks": {
                task: {
                    "agent": result.agent.value,
                    "status": result.status,
                    "tools": result.data.get("agent_trace", {}).get("tools", []),
                    "options": len(
                        result.data.get("candidates", result.data.get("offers", result.data.get("quotes", [])))
                    ),
                    "execution": result.data.get("execution", {}),
                }
                for task, result in fresh.items()
            },
        }
        print("EFFICIENCY_REAL " + json.dumps(measurement, ensure_ascii=False), flush=True)
        self.last_measurement = measurement
        assert not payload.get("confirmation") and not checkpoint.get("committed"), "Never transact"
        assert all(r.source_kind in {"live", "sandbox"} for r in fresh.values()), "No simulated provider data"
        if not allow_failure:
            assert payload["response"]["kind"] not in {"ERROR", "UNSUPPORTED"}, payload["response"]["text"]
        return payload, checkpoint

    def resolve_choice(self, case, payload, checkpoint, label_contains=None):
        """Act on real returned choices, like the user's map picker; never invent coordinates."""
        if payload["response"]["kind"] != "CLARIFY":
            return payload, checkpoint
        choices = [(q, c) for q in checkpoint["response"].questions for c in q.choices]
        if label_contains:
            choices = [(q, c) for q, c in choices if label_contains in c.label]
        assert choices, "Clarification must offer an actual selectable location"
        question, chosen = choices[0]
        return self.turn(
            case + "-choose-place",
            f"Tôi chọn {chosen.label}. Tiếp tục yêu cầu trước, không đổi các điều kiện.",
            payload["thread_id"],
            place_choice={"field": question.field.split(".")[-1], "place_id": chosen.id},
        )


@pytest.fixture(scope="module")
def actual_run():
    # Imported fixtures do not inherit this module's pytestmark. Guard here too
    # so collecting a different test module can never start a paid run silently.
    if os.getenv("RUN_LIVE_INTEGRATION") != "1":
        pytest.skip("Real providers and paid LLM require explicit opt-in")
    label = os.getenv("RUN_EFFICIENCY_LABEL", "after")
    source_root = Path(os.getenv("RUN_EFFICIENCY_SOURCE_ROOT", str(ROOT))).resolve()
    directory = Path(
        os.getenv("RUN_EFFICIENCY_RUNTIME", str(ROOT / "data" / ("efficiency-" + label + "-" + uuid.uuid4().hex)))
    )
    token = secrets.token_urlsafe(32)
    env = live.backend_environment(
        os.environ,
        AGENT_API_TOKEN=token,
        AGENT_STATE_DIR=str(directory),
        RELOHOME_RUNTIME_ROOT=str(source_root),
        FLIGHT_DB_PATH=str(ROOT / "data/integration-flights.db"),
    )
    if attempts := os.getenv("RUN_EFFICIENCY_MAX_ATTEMPTS"):
        # Identical opt-in evaluation budget on both versions; production config unchanged.
        env["AGENT_MAX_ATTEMPTS"] = attempts
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    process = subprocess.Popen(
        [
            os.getenv("RUN_EFFICIENCY_PYTHON", sys.executable),
            "-m",
            "uvicorn",
            os.getenv("RUN_EFFICIENCY_APP", "relohome_agent.main:app"),
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
        ],
        cwd=ROOT,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    client = httpx.Client(
        base_url=f"http://127.0.0.1:{port}/api/v1",
        timeout=240,
        headers={"Authorization": "Bearer " + token, "X-User-Id": "efficiency_" + uuid.uuid4().hex},
    )
    resumed = os.getenv("RUN_EFFICIENCY_HOUSING_THREAD")
    if resumed:
        client.headers["X-User-Id"] = ActualRun(client, directory, label).checkpoint(resumed)["user_id"]
    try:
        for _ in range(100):
            assert process.poll() is None, "Owned benchmark API exited during startup"
            try:
                if client.get("/health").status_code < 500:
                    break
            except httpx.TransportError:
                pass
            time.sleep(0.1)
        else:
            pytest.fail("Benchmark API did not start")
        print("EFFICIENCY_RUNTIME " + json.dumps({"label": label, "directory": str(directory)}), flush=True)
        yield ActualRun(client, directory, label)
    finally:
        client.close()
        process.terminate()
        process.wait(timeout=15)


@pytest.fixture(scope="module")
def selected_home(actual_run):
    resumed = os.getenv("RUN_EFFICIENCY_HOUSING_THREAD")
    if resumed:
        checkpoint = actual_run.checkpoint(resumed)
        payload = {"thread_id": resumed, "response": checkpoint["response"].model_dump(mode="json")}
    else:
        payload, checkpoint = actual_run.turn(
            "1-housing",
            "Tìm tối đa 8 nhà cho thuê dưới 6 triệu mỗi tháng trong bán kính 2,5 km quanh Đại học Xây dựng Hà Nội. "
            "Giữ đúng địa điểm và ngân sách; tôi chỉ xem, không đặt dịch vụ.",
        )
    if not any(r.agent.value == "property" and r.status == "done" for r in checkpoint.get("task_results", {}).values()):
        payload, checkpoint = actual_run.resolve_choice("1-housing", payload, checkpoint, "Phường Bạch Mai")
    housing = next(r for r in checkpoint["task_results"].values() if r.agent.value == "property")
    assert housing.status == "done" and housing.data["candidates"], (
        "Require actual housing, not fabricated replacements"
    )
    query = housing.data["search_request"]
    assert query["radius_m"] == 2500 and query["max_price"]["amount"] == 6_000_000
    assert all(row["price_vnd"] <= 6_000_000 for row in housing.data["candidates"])
    assert len(housing.data["candidates"]) <= 8
    chosen = housing.data["candidates"][0]["id"]
    existing = checkpoint["intake"].user_confirmed_facts.get("selected:property")
    if existing and existing.value == chosen:
        return payload["thread_id"], chosen, housing
    response = actual_run.client.post(
        f"/ui/chat/{payload['thread_id']}/action",
        json={
            "kind": "select",
            "task_id": housing.task_id,
            "plan_version": checkpoint["plan"].version,
            "fetched_at": housing.fetched_at.isoformat(),
            "entity_id": chosen,
        },
    )
    response.raise_for_status()
    return payload["thread_id"], chosen, housing


def test_new_housing_then_selected_map(actual_run, selected_home):
    thread, chosen, original = selected_home
    _, checkpoint = actual_run.turn(
        "1-map-followup",
        "Quanh nhà vừa chọn có quán cà phê nào trong 700 mét? Giữ nguyên yêu cầu tìm nhà, không tìm lại.",
        thread,
    )
    task = next(t for t in checkpoint["plan"].tasks if t.agent.value == "map")
    assert task.inputs["selected_listing_id"] == chosen
    assert task.inputs["radius_m"] == 700 and task.inputs["categories"] == ["cafe"]
    assert checkpoint["task_results"][original.task_id].fetched_at == original.fetched_at
    assert checkpoint["intake"].constraints.values["max_price_vnd"] == 6_000_000
    assert checkpoint["task_results"][task.id].status == "done"
    actual_run.preserve_seed(thread)


def test_new_independent_map_and_flight_overlap(actual_run):
    day = (utcnow() + timedelta(days=14)).date().isoformat()
    resumed = os.getenv("RUN_EFFICIENCY_PARALLEL_THREAD")
    if resumed:
        checkpoint = actual_run.checkpoint(resumed)
        payload = {"thread_id": resumed, "response": checkpoint["response"].model_dump(mode="json")}
    else:
        payload, checkpoint = actual_run.turn(
            "2-parallel",
            f"Tìm bệnh viện trong 1,2 km quanh Hồ Hoàn Kiếm ở Hà Nội; đồng thời tìm chuyến bay Đà Nẵng đến Hà Nội "
            f"ngày {day} cho 1 người lớn. Chỉ tra cứu, chưa đặt vé.",
        )
    initial = checkpoint
    payload, checkpoint = actual_run.resolve_choice("2-parallel", payload, checkpoint)
    tasks = [t for t in checkpoint["plan"].tasks if t.agent.value in {"map", "flight"}]
    assert {t.agent.value for t in tasks} == {"map", "flight"}
    assert all(not t.depends_on for t in tasks), "Independent goals must not be serialized"
    results = [checkpoint["task_results"][t.id] for t in tasks]
    assert all(r.status == "done" for r in results)
    assert next(r for r in results if r.agent.value == "flight").data["offers"], "Require real flight offers"
    spans = [r.data["execution"] for r in initial["task_results"].values() if r.agent.value in {"map", "flight"}]
    assert max(datetime.fromisoformat(s["started_at"]) for s in spans) < min(
        datetime.fromisoformat(s["finished_at"]) for s in spans
    ), "Actual provider executions must overlap, not just share a DAG layer"


def test_new_moving_reference_after_map(actual_run, selected_home):
    thread, chosen, _ = selected_home
    day = (utcnow() + timedelta(days=4)).date().isoformat()
    resume_pins = os.getenv("RUN_EFFICIENCY_RESUME_MOVING_PINS") == "1"
    if resume_pins:
        checkpoint = actual_run.checkpoint(thread)
        payload = {"response": checkpoint["response"].model_dump(mode="json")}
    else:
        payload, checkpoint = actual_run.turn(
            "3-moving-reference",
            f"Tôi muốn chuyển đồ từ căn nhà đã chọn đến Bảo tàng Dân tộc học Việt Nam tại Hà Nội ngày {day}, lúc 10 giờ 30. "
            "Chỉ lấy báo giá, chưa đặt xe hoặc thanh toán.",
            thread,
        )
    values = checkpoint["intake"].constraints.values
    if not resume_pins:
        assert values["from_address"] == "selected:property"
    assert values["move_date"] == day and values["move_time"] == "10:30"
    assert checkpoint["intake"].user_confirmed_facts["selected:property"].value == chosen
    relocation = next(r for r in checkpoint["task_results"].values() if r.agent.value == "relocation")
    if not resume_pins:
        assert relocation.status in {"done", "needs_input"}, relocation.error
    assert all(q.field not in {"move_date", "move_time", "selected:property"} for q in relocation.questions)
    if relocation.status == "needs_input" or resume_pins:
        housing = next(r for r in checkpoint["task_results"].values() if r.agent.value == "property")
        home = next(row for row in housing.data["candidates"] if row["id"] == chosen)
        places = actual_run.client.get("/map/search", params={"text": "Bảo tàng Dân tộc học Việt Nam"})
        places.raise_for_status()
        candidates = [
            r for r in places.json().get("results", []) if r.get("entity_type") == "place" and r.get("location")
        ]
        assert candidates, "Require actual destination map choices"
        destination = candidates[0]
        payload, checkpoint = actual_run.turn(
            "3-moving-confirm-pins",
            "Tôi xác nhận hai điểm trên bản đồ. Giữ nguyên ngày giờ chuyển, chỉ báo giá, không đặt.",
            thread,
            moving_locations={
                "pickup": {"address": home["address"], "lat": home["lat"], "lng": home["lng"], "confirmed": True},
                "destination": {"address": destination["name"], **destination["location"], "confirmed": True},
            },
        )
        relocation = next(r for r in checkpoint["task_results"].values() if r.agent.value == "relocation")
        assert relocation.status == "done", "Confirmed real map pins must allow a provider quote"
        assert checkpoint["intake"].constraints.values["move_time"] == "10:30"
    if relocation.status == "done":
        assert relocation.data["quotes"], "Require provider quotes if reporting completion"
        old_optional = {
            t.id
            for t in checkpoint["plan"].tasks
            if not t.required
            and t.id in checkpoint["task_results"]
            and checkpoint["task_results"][t.id].data.get("execution", {}).get("request_id") != checkpoint["request_id"]
        }
        assert not old_optional & set(payload["response"]["data"].get("limited_tasks", {})), (
            "Do not report unrelated old limitations"
        )
