"""Five opt-in REAL read-only API turns; no fabricated providers, writes or mock clients.

Run: .venv/Scripts/python.exe scripts/measure-read-latency.py --live-llm
Catalog-only transport comparison: same command with --catalog instead.
Reports live in ignored data/. Each run gets a separate user/thread/runtime.
"""

import argparse
import asyncio
import json
import os
import re
import runpy
import sqlite3
import sys
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from time import perf_counter
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]


async def catalog_check():
    from relohome_agent.services.adapters.registry import ServiceRegistry

    client = ServiceRegistry.from_settings().flight.read_client()
    if not client:
        raise RuntimeError("Set FLIGHT_MCP_URL to the running Flight HTTP service.")
    observations = []
    for query in ("Hà Nội", "Đà Nẵng", "SGN"):
        started = perf_counter()
        airports = await client.call("search_airports", {"query": query, "limit": 5})
        observations.append({"query": query, "http_ms": round((perf_counter() - started) * 1000, 2),
                             "codes": [row["code"] for row in airports]})
    print(json.dumps({"catalog": observations, "llm_calls": 0}, ensure_ascii=False))


async def measure_live():
    import httpx
    from relohome_agent.agents.common import utcnow
    from relohome_agent.agents.contracts import AgentTaskRequest
    from relohome_agent.agents.models import AgentBudget, AgentName
    from relohome_agent.agents.subagents.services.domain_tools import DomainToolSession
    from relohome_agent.agents.subagents.services.location import LocationSubagent
    from relohome_agent.config import Settings
    from relohome_agent.main import app
    from relohome_agent.services.adapters.registry import ServiceRegistry

    run_id = uuid.uuid4().hex[:10]
    run_date = datetime.now(ZoneInfo("Asia/Ho_Chi_Minh")).strftime("%Y%m%d")
    folder = ROOT / "data" / ("read-latency-" + run_date + "-" + run_id)
    os.environ["AGENT_STATE_DIR"] = str(folder / "runtime")
    actor = "read-latency-" + run_id
    settings = Settings()
    flight_date = (datetime.now(ZoneInfo("Asia/Ho_Chi_Minh")).date() + timedelta(days=15))
    cases = [
        ("housing", "housing_simple", "Tôi muốn tìm tối đa 5 nhà ở Cầu Giấy, thành phố Hà Nội, giá dưới 6 triệu/tháng. Chỉ tìm và liệt kê."),
        ("housing", "housing_multiturn", "Vẫn khu vực đó, giảm xuống dưới 4,5 triệu/tháng, tối đa 5 căn thôi."),
        ("flight", "flight_simple", f"Tìm chuyến bay từ Hà Nội đến Đà Nẵng ngày {flight_date:%d/%m/%Y}, một người lớn. Chỉ tra cứu, chưa đặt vé."),
        ("flight", "flight_multiturn", f"Giữ nguyên tuyến và một người lớn, đổi sang ngày {flight_date + timedelta(days=2):%d/%m/%Y}. Chỉ tìm chuyến."),
        ("parallel", "independent_housing_flight", f"Tìm tối đa 5 nhà ở Hải Châu, Đà Nẵng dưới 6 triệu/tháng, đồng thời tìm chuyến từ Hà Nội đến Đà Nẵng ngày {flight_date:%d/%m/%Y} cho một người lớn. Chỉ tra cứu, chưa đặt gì."),
    ]
    headers = {"Authorization": "Bearer " + settings.agent_api_token.get_secret_value(), "X-User-Id": actor}
    observations = []
    async with app.router.lifespan_context(app):
        # Real adapters + real DB. Prove the compound tool preserves ordinary
        # search facts and stops at ambiguity; no LLM is called for this check.
        location = ServiceRegistry.from_settings(settings).location.read_client()
        request = AgentTaskRequest(
            request_id=run_id, thread_id=actor, task_id="property-check", plan_version=1,
            attempt=1, agent=AgentName.PROPERTY,
            inputs={"city": "Hà Nội", "district": "Cầu Giấy", "max_price_vnd": 6000000, "limit": 5},
            budget=AgentBudget(max_llm_calls=2, max_provider_calls=8, deadline_at=utcnow() + timedelta(seconds=50)),
        )
        sessions = [DomainToolSession(request, LocationSubagent(location, AgentName.PROPERTY)) for _ in range(2)]
        await sessions[0].execute("search_housing", {"limit": 5})
        _, terminal = await sessions[1].execute("search_housing_and_return", {"limit": 5})
        assert terminal
        assert sessions[0].result.status == sessions[1].result.status
        assert sessions[0].result.data.get("candidates") == sessions[1].result.data.get("candidates")
        if sessions[1].result.status == "done":
            assert sessions[1].result.data["agent_completion"]["model_assessed"] is False

        async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://local-test", timeout=240) as client:
            threads = {}
            for conversation, name, message in cases:
                started = perf_counter()
                response = await client.post("/api/v1/chat", headers=headers, json={"message": message, "thread_id": threads.get(conversation)})
                elapsed = round(perf_counter() - started, 3)
                response.raise_for_status()
                payload = response.json()
                threads[conversation] = payload["thread_id"]
                answer = payload.get("response") or {}
                domains = {}
                for tid, result in (answer.get("data", {}).get("results") or {}).items():
                    data = result.get("data") or {}
                    domains[tid] = {
                        "agent": result.get("agent"), "source_kind": result.get("source_kind"),
                        "count": len(data.get("candidates", data.get("offers", []))),
                        "trace": data.get("agent_trace"), "completion": data.get("agent_completion"),
                        "execution": data.get("execution"),
                    }
                with sqlite3.connect(folder / "runtime/runtime.sqlite3") as db:
                    usage = [(kind, calls, json.loads(raw)) for kind, calls, raw in db.execute(
                        "SELECT kind,llm,data FROM usage WHERE thread=?", (payload["thread_id"],)
                    )]
                observed = {"case": name, "message": message, "elapsed_s": elapsed,
                            "kind": answer.get("kind"), "text": answer.get("text"),
                            "domains": domains, "conversation_usage_cumulative": usage}
                observations.append(observed)
                # Print only safe summary; no keys, contact info or raw provider payloads.
                print(json.dumps({k: observed[k] for k in ("case", "elapsed_s", "kind", "domains")}, ensure_ascii=False), flush=True)
                (folder / "report.json").write_text(json.dumps(observations, ensure_ascii=False, indent=2), encoding="utf-8")
    print("Report: " + str(folder / "report.json"))


async def measure_ui(report_path):
    """Reopen ONLY this script's real test threads. Never invokes a chat/LLM route."""
    import httpx

    folder = report_path.resolve().parent
    if folder.parent != ROOT / "data" or not re.fullmatch(r"read-latency-\d{8}-[a-f0-9]{10}", folder.name):
        raise ValueError("Use a report from this script's own ignored data directory.")
    os.environ["AGENT_STATE_DIR"] = str(folder / "runtime")
    from relohome_agent.agents.graph import run_config
    from relohome_agent.config import Settings
    from relohome_agent.main import app

    reports = json.loads(report_path.read_text(encoding="utf-8"))
    settings = Settings()
    actor = "read-latency-" + folder.name.rsplit("-", 1)[1]
    headers = {"Authorization": "Bearer " + settings.agent_api_token.get_secret_value(), "X-User-Id": actor}
    output = []
    async with app.router.lifespan_context(app):
        service = app.state.agent_service
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://local-test") as client:
            for case in reports:
                if case["case"] not in {"housing_multiturn", "flight_multiturn"}:
                    continue
                tid, observed = next(iter(case["domains"].items()))
                request_id = observed["execution"]["request_id"]
                with sqlite3.connect(folder / "runtime/runtime.sqlite3") as db:
                    thread = db.execute("SELECT thread FROM usage WHERE request=? LIMIT 1", (request_id,)).fetchone()[0]
                    before = db.execute("SELECT count(*) FROM usage").fetchone()[0]
                state = (await service.graph.aget_state(run_config(thread, service.deps))).values
                result = state["task_results"][tid]
                key = "candidates" if observed["agent"] == "property" else "offers"
                chosen = result.data[key][0]["id"]
                resource = "housing" if key == "candidates" else "flight"
                started = perf_counter()
                detail = await client.get(f"/api/v1/ui/{resource}/{chosen}", headers=headers)
                output.append({"action": resource + "_detail", "status": detail.status_code, "elapsed_ms": round((perf_counter() - started) * 1000, 2)})
                body = {"kind": "select", "task_id": tid, "plan_version": state["plan"].version,
                        "fetched_at": result.fetched_at.isoformat(), "entity_id": chosen}
                started = perf_counter()
                selection = await client.post(f"/api/v1/ui/chat/{thread}/action", headers=headers, json=body)
                output.append({"action": resource + "_select", "status": selection.status_code, "elapsed_ms": round((perf_counter() - started) * 1000, 2)})
                if resource == "housing" and result.data.get("next_cursor"):
                    started = perf_counter()
                    more = await client.post(f"/api/v1/ui/chat/{thread}/action", headers=headers, json={**body, "kind": "more", "entity_id": None})
                    output.append({"action": "housing_more", "status": more.status_code, "elapsed_ms": round((perf_counter() - started) * 1000, 2)})
                with sqlite3.connect(folder / "runtime/runtime.sqlite3") as db:
                    after = db.execute("SELECT count(*) FROM usage").fetchone()[0]
                assert before == after, "Structured UI actions must not call Intake/Planner/domain LLMs."
                if resource == "housing":
                    assert detail.status_code == selection.status_code == 200
                    assert state["plan"].task(tid).inputs["max_price_vnd"] == 4500000
                    assert "district" in state["plan"].task(tid).inputs
    (folder / "ui-report.json").write_text(json.dumps({"actions": output, "llm_calls": 0}, indent=2), encoding="utf-8")
    print(json.dumps({"actions": output, "llm_calls": 0}))


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--live-llm", action="store_true", help="Explicit opt-in: five live LLM/provider read turns.")
    group.add_argument("--catalog", action="store_true", help="Real catalog comparison only; no LLM/provider billing.")
    group.add_argument("--ui-report", type=Path, help="Inspect/select existing real test results; zero LLM calls.")
    args = parser.parse_args()
    os.environ.update(runpy.run_path(str(ROOT / "scripts/local-integration.py"))["environment"]("api"))
    asyncio.run(measure_live() if args.live_llm else measure_ui(args.ui_report) if args.ui_report else catalog_check())


if __name__ == "__main__":
    main()
