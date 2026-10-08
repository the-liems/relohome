"""Issue #70: actual MCP/PostGIS and multi-turn LLM reads, without mocked tools.

Opt in RUN_WORKSPACE_REPAIRS_LIVE=1. Never book, pay or publish roommate profiles.
The API must run the checked-out source (default local port 8000).
"""

import asyncio
import importlib.util
import json
import os
from pathlib import Path
from time import perf_counter
from uuid import uuid4

import httpx
import pytest
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from src.agents.contracts import AgentTaskRequest
from src.agents.graph import checkpoint_serde
from src.agents.models import AgentBudget, AgentName
from src.agents.subagents.services.domain_tools import DomainToolSession
from src.agents.subagents.services.location import LocationSubagent
from src.services.adapters.mcp import McpEndpoint, McpToolClient
from src.services.adapters.registry import LOCATION_READ_TOOLS

pytestmark = pytest.mark.skipif(os.getenv("RUN_WORKSPACE_REPAIRS_LIVE") != "1", reason="Opt-in actual read services")
ROOT = Path(__file__).resolve().parents[2]


def environment():
    spec = importlib.util.spec_from_file_location("workspace_runner", ROOT / "scripts/local-integration.py")
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    return runner.environment("api")


def test_comparison_reads_exact_real_ids_without_new_search():
    async def run():
        env = environment()
        client = McpToolClient(
            McpEndpoint(
                service="location",
                url=env["LOCATION_MCP_URL"],
                token=env["LOCATION_MCP_AUTH_TOKEN"],
                allowed_tools=LOCATION_READ_TOOLS,
            )
        )
        req = AgentTaskRequest(
            request_id=uuid4().hex,
            thread_id="issue70_tools",
            task_id="housing",
            plan_version=1,
            attempt=1,
            agent=AgentName.PROPERTY,
            goal="Đọc dữ kiện nhà thật",
            inputs={"city": "Hà Nội", "max_price_vnd": 6_000_000, "limit": 4},
            budget=AgentBudget(max_llm_calls=0, max_provider_calls=12),
        )
        adapter = LocationSubagent(client, AgentName.PROPERTY)
        first = await adapter.run(req)
        assert first.status == "done" and len(first.data["candidates"]) == 4
        ids = [c["id"] for c in first.data["candidates"]]
        session = DomainToolSession(
            req.model_copy(update={"inputs": {"housing_mode": "compare", "listing_ids": ids}}), adapter
        )
        assert "compare_housing" in {t["name"] for t in session.available()}
        assert not {"search_housing", "search_housing_and_return"} & {t["name"] for t in session.available()}
        await session.execute("compare_housing", {"limit": None})
        result = session.result
        assert result.status == "done" and result.source_refs == ids
        assert session.read_ids == set(ids) and session.tools.calls == 4
        for row in result.data["comparison"]["rows"]:
            assert row["id"] in ids and row["unknown_cost_fields"]
            assert row["known_move_in_vnd"] == (
                row["rent_vnd"] + row["deposit_vnd"]
                if row["rent_vnd"] is not None and row["deposit_vnd"] is not None
                else None
            )
        before = session.tools.calls
        with pytest.raises(ValueError):
            await session.execute("get_housing", {"id": "not_an_observed_listing"})
        assert session.tools.calls == before

    asyncio.run(run())


def test_real_multiturn_comparison_preserves_ids_and_missing_costs():
    env = environment()
    resume = os.getenv("WORKSPACE_REPAIRS_RESUME_THREAD")

    async def load():
        async with AsyncSqliteSaver.from_conn_string(str(ROOT / "data/agent-runtime/checkpoints.sqlite3")) as saver:
            saver.serde = checkpoint_serde()
            checkpoint = await saver.aget_tuple({"configurable": {"thread_id": resume}})
            assert checkpoint, "Resume only an existing actual test conversation"
            return checkpoint.checkpoint["channel_values"]

    saved = asyncio.run(load()) if resume else None
    with httpx.Client(
        base_url=os.getenv("WORKSPACE_REPAIRS_API", "http://127.0.0.1:8000/api/v1"),
        timeout=240,
        headers={
            "Authorization": "Bearer " + env["AGENT_API_TOKEN"],
            "X-User-Id": saved["user_id"] if saved else "issue70_" + uuid4().hex,
        },
    ) as http:

        def ask(message, thread=None):
            started = perf_counter()
            response = http.post("/chat", json={"message": message, "thread_id": thread})
            response.raise_for_status()
            payload = response.json()
            print(
                json.dumps(
                    {
                        "elapsed_ms": round((perf_counter() - started) * 1000),
                        "thread": payload["thread_id"],
                        "kind": payload["response"]["kind"],
                        "text": payload["response"]["text"],
                    },
                    ensure_ascii=True,
                )
            )
            assert not payload.get("confirmation")
            assert payload["response"]["kind"] in {"ANSWER", "PARTIAL"}
            return payload

        first = (
            {"thread_id": resume, "response": saved["response"].model_dump(mode="json")}
            if saved
            else ask("Tìm 4 phòng trọ tại Hà Nội dưới 6 triệu đồng/tháng. Chỉ tìm, không đặt.")
        )
        result = next(r for r in first["response"]["data"]["results"].values() if r["agent"] == "property")
        assert len(result["data"]["candidates"]) >= 3
        ids = [c["id"] for c in result["data"]["candidates"][:3]]
        second = ask(
            "So sánh 3 căn đầu trong danh sách vừa tìm về giá thuê, tiền cọc, diện tích và tiện nghi; nêu rõ khoản phí nào chưa biết. Không chọn nhà thay tôi.",
            first["thread_id"],
        )
        comparison = next(r for r in second["response"]["data"]["results"].values() if r["data"].get("comparison"))
        assert comparison["source_kind"] == "live" and set(comparison["source_refs"]) == set(ids)
        assert len(comparison["data"]["comparison"]["rows"]) == 3
        assert comparison["data"]["agent_assessment"]["kind"] == "model_assessment_not_provider_fact"
        assert "compare_housing" in comparison["data"]["agent_trace"]["tools"]
        state = http.get(f"/chat/{first['thread_id']}/state").json()
        assert not state["committed"] and not state["plan"]["commit_actions"]


def test_real_selected_home_survives_three_then_four_way_comparison():
    """Read original search identities after selecting, then expanding a comparison."""
    env = environment()
    resume = os.getenv("WORKSPACE_REPAIRS_RESUME_THREAD")

    async def load():
        async with AsyncSqliteSaver.from_conn_string(str(ROOT / "data/agent-runtime/checkpoints.sqlite3")) as saver:
            saver.serde = checkpoint_serde()
            checkpoint = await saver.aget_tuple({"configurable": {"thread_id": resume}})
            assert checkpoint, "Resume only an existing actual test conversation"
            return checkpoint.checkpoint["channel_values"]

    saved = asyncio.run(load()) if resume else None
    with httpx.Client(
        base_url=os.getenv("WORKSPACE_REPAIRS_API", "http://127.0.0.1:8000/api/v1"),
        timeout=240,
        headers={
            "Authorization": "Bearer " + env["AGENT_API_TOKEN"],
            "X-User-Id": saved["user_id"] if saved else "issue70_" + uuid4().hex,
        },
    ) as http:
        thread = None

        def ask(message):
            nonlocal thread
            started = perf_counter()
            reply = http.post("/chat", json={"message": message, "thread_id": thread})
            reply.raise_for_status()
            payload = reply.json()
            thread = payload["thread_id"]
            print(
                json.dumps(
                    {
                        "thread": thread,
                        "kind": payload["response"]["kind"],
                        "elapsed_ms": round((perf_counter() - started) * 1000),
                    },
                    ensure_ascii=True,
                )
            )
            assert payload["response"]["kind"] in {"ANSWER", "PARTIAL"}
            assert not payload.get("confirmation")
            return payload

        continuing = bool(saved and saved["intake"].constraints.values.get("housing_mode") == "compare")
        first = (
            {"response": saved["response"].model_dump(mode="json")}
            if saved
            else ask("Tìm đúng 4 phòng trọ tại Hà Nội dưới 6 triệu đồng/tháng để tôi so sánh, chỉ tìm không đặt.")
        )
        thread = resume or thread
        task_id, result = next(
            (tid, r) for tid, r in first["response"]["data"]["results"].items() if r["agent"] == "property"
        )
        ids = (
            [o["option_id"] for o in saved["last_housing_search_options"]]
            if continuing
            else [c["id"] for c in result["data"]["candidates"]]
        )
        assert len(ids) == 4
        state = http.get(f"/chat/{thread}/state").json()
        choice = (
            None
            if continuing
            else http.post(
                f"/ui/chat/{thread}/action",
                json={
                    "kind": "select",
                    "task_id": task_id,
                    "plan_version": state["plan"]["version"],
                    "fetched_at": result["fetched_at"],
                    "entity_id": ids[0],
                },
            )
        )
        if choice is not None:
            choice.raise_for_status()
        for count, message in (
            (3, "So sánh 3 căn đầu của danh sách ban đầu về giá, cọc và diện tích, không thay đổi căn đã chọn."),
            (4, "Thêm căn thứ tư ban đầu vào bảng so sánh luôn nhé, vẫn giữ căn tôi đã chọn và không đặt gì."),
        ):
            if continuing and count == 3:
                continue  # Already completed against real providers; do not pay to repeat it.
            response = ask(message)
            comparison = next(
                r for r in response["response"]["data"]["results"].values() if r["data"].get("comparison")
            )
            assert set(comparison["source_refs"]) == set(ids[:count])
            assert len(comparison["data"]["comparison"]["rows"]) == count
            state = http.get(f"/chat/{thread}/state").json()
            assert state["selections"]["property"]["id"] == ids[0]
            assert not state["committed"] and not state["plan"]["commit_actions"]
