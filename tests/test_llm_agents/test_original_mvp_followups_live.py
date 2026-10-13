"""Four novel utterances on original/current full API, real providers only.

Imported fixture owns an isolated runtime/server. No fake conversations or
coordinates: selections are made exclusively from returned housing/map rows.
No booking, cancellation, payment or transaction approval is performed.
"""

import asyncio
import json
import os
from pathlib import Path

import pytest
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from relohome_agent.agents.graph import checkpoint_serde
from test_context_efficiency_live import actual_run  # noqa: F401


def test_four_new_linked_turns(actual_run):  # noqa: F811
    checks = []

    def record(case, message, thread=None, **selections):
        if case == "1-housing-cau-giay" and (resumed := os.getenv("RUN_EFFICIENCY_HOUSING_THREAD")):
            # Resume the actual successful first request after a harness interruption.
            # Do not spend credit repeating a query that already produced its result.
            state = actual_run.checkpoint(resumed)
            payload = {"thread_id": resumed, "response": state["response"].model_dump(mode="json")}
        else:
            payload, state = actual_run.turn(case, message, thread, allow_failure=True, **selections)
        facts = state["intake"].constraints.values if state.get("intake") else {}
        print(
            "FOLLOWUP_STATE "
            + json.dumps(
                {
                    "label": actual_run.label,
                    "case": case,
                    "kind": payload["response"]["kind"],
                    "text": payload["response"]["text"],
                    "constraints": {
                        k: v
                        for k, v in facts.items()
                        if k
                        in {
                            "city",
                            "district",
                            "max_price_vnd",
                            "limit",
                            "map_radius_m",
                            "map_categories",
                            "from_address",
                            "to_address",
                            "move_date",
                            "move_time",
                        }
                    },
                    "questions": [q.field for q in state["response"].questions],
                    "tasks": [
                        {
                            "agent": t.agent.value,
                            "required": t.required,
                            "depends_on": t.depends_on,
                            "inputs": {
                                k: v
                                for k, v in t.inputs.items()
                                if k
                                in {
                                    "radius_m",
                                    "categories",
                                    "limit",
                                    "move_date",
                                    "move_time",
                                    "max_price_vnd",
                                    "selected_listing_id",
                                    "from_address",
                                }
                            },
                        }
                        for t in state["plan"].tasks
                    ]
                    if state.get("plan")
                    else [],
                },
                ensure_ascii=True,
                default=str,
            ),
            flush=True,
        )
        checks.append((case, payload["response"]["kind"] not in {"ERROR", "UNSUPPORTED"}))
        return payload, state

    payload, state = record(
        "1-housing-cau-giay",
        "Tìm tối đa 6 căn nhà cho thuê ở quận Cầu Giấy, Hà Nội, giá không quá 7 triệu mỗi tháng. "
        "Chỉ xem thông tin, chưa đặt dịch vụ.",
    )
    thread = payload["thread_id"]
    housing = next(
        (
            r
            for r in state.get("task_results", {}).values()
            if r.agent.value == "property" and r.status == "done" and r.data.get("candidates")
        ),
        None,
    )
    assert housing is not None, "Cannot fabricate a selected house to continue the conversation"
    rows = housing.data["candidates"]
    checks.append(("housing-count-and-budget", len(rows) <= 6 and all(r["price_vnd"] <= 7_000_000 for r in rows)))
    homes = [r for r in rows if r.get("lat") is not None and r.get("lng") is not None]
    assert homes, "A real selectable geocoded listing is required"
    home = homes[0]
    selection = actual_run.client.post(
        f"/ui/chat/{thread}/action",
        json={
            "kind": "select",
            "task_id": housing.task_id,
            "plan_version": state["plan"].version,
            "fetched_at": housing.fetched_at.isoformat(),
            "entity_id": home["id"],
        },
    )
    selection.raise_for_status()

    _, state = record(
        "2-selected-pharmacy",
        "Quanh căn vừa chọn có nhà thuốc nào trong 800 mét? Giữ nguyên ngân sách tìm nhà, không tìm nhà lại.",
        thread,
    )
    maps = [t for t in state["plan"].tasks if t.agent.value == "map"]
    checks.append(
        (
            "map-selection-and-radius",
            bool(maps)
            and any(
                t.inputs.get("selected_listing_id") == home["id"]
                and t.inputs.get("radius_m") == 800
                and "pharmacy" in t.inputs.get("categories", [])
                for t in maps
            ),
        )
    )
    checks.append(
        (
            "no-unnecessary-housing-search",
            not any(
                r.agent.value == "property" and r.data.get("execution", {}).get("request_id") == state["request_id"]
                for r in state["task_results"].values()
            ),
        )
    )

    _, state = record(
        "3-moving-selected-home",
        "Nếu chuyển đồ từ căn đó đến Ga Hà Nội ngày 12/10/2026 lúc 14 giờ thì khoảng bao nhiêu tiền? "
        "Tôi chỉ hỏi giá, chưa đặt xe.",
        thread,
    )
    values = state["intake"].constraints.values
    checks.append(
        (
            "moving-reference-and-schedule",
            values.get("from_address") == "selected:property"
            and values.get("move_date") == "2026-10-12"
            and values.get("move_time") == "14:00",
        )
    )

    places = actual_run.client.get("/map/search", params={"text": "Ga Hà Nội"})
    places.raise_for_status()
    destinations = [
        r for r in places.json().get("results", []) if r.get("entity_type") == "place" and r.get("location")
    ]
    assert destinations, "Cannot invent a destination pin"
    destination = destinations[0]
    payload, state = record(
        "4-moving-change-time-and-pins",
        "Đổi sang 16 giờ 15 cùng ngày nhé. Tôi xác nhận hai điểm trên bản đồ; giữ tuyến đó, "
        "chỉ báo giá, không đặt xe và không thanh toán.",
        thread,
        moving_locations={
            "pickup": {"address": home["address"], "lat": home["lat"], "lng": home["lng"], "confirmed": True},
            "destination": {"address": destination["name"], **destination["location"], "confirmed": True},
        },
    )
    values = state["intake"].constraints.values
    checks.append(
        ("changed-time-retained-day", values.get("move_date") == "2026-10-12" and values.get("move_time") == "16:15")
    )
    relocation = [r for r in state.get("task_results", {}).values() if r.agent.value == "relocation"]
    # The real staging provider rejected this requested date during evaluation.
    # A correct recovery asks about the date without inventing quotes/changing it.
    # This is NOT a successful quote test. estimate -> ask is possible only after
    # a provider rejection in Moving's tool gate; no free-form model-only excuse.
    checks.append(("provider-refusal-recovery", any(refusal_recovery(r) for r in relocation)))
    print("FOLLOWUP_CHECKS " + json.dumps({"label": actual_run.label, "checks": checks}), flush=True)
    assert all(ok for _, ok in checks), checks


def refusal_recovery(result):
    tools = result.data.get("agent_trace", {}).get("tools", [])
    return (
        result.status == "needs_input"
        and not result.data.get("quotes")
        and "estimate_move" in tools
        and "ask_user" in tools
        and any(q.field == "move_date" for q in result.questions)
    )


@pytest.fixture(scope="module")
def recorded_states():
    """Only read actual persisted checkpoints; zero provider/model calls."""
    if os.getenv("RUN_FOLLOWUP_REPLAY") != "1":
        pytest.skip("Explicit real checkpoint replay opt-in")
    directory = Path(os.environ["RUN_EFFICIENCY_RUNTIME"])
    thread = os.environ["RUN_EFFICIENCY_HOUSING_THREAD"]

    async def read():
        states, requests = [], set()
        async with AsyncSqliteSaver.from_conn_string(str(directory / "checkpoints.sqlite3")) as saver:
            saver.serde = checkpoint_serde()
            async for saved in saver.alist({"configurable": {"thread_id": thread}}):
                state = saved.checkpoint["channel_values"]
                request = state.get("request_id")
                if request and request not in requests and state.get("response"):
                    requests.add(request)
                    states.append(state)
        return list(reversed(states))

    states = asyncio.run(read())
    assert len(states) == 4, "Require all four actual requests; never construct replacement state"
    assert all(not s.get("committed") for s in states)
    return states


def test_recorded_housing(recorded_states):
    result = next(r for r in recorded_states[0]["task_results"].values() if r.agent.value == "property")
    assert result.status == "done" and result.source_kind == "live"
    assert result.data["candidates"] and len(result.data["candidates"]) <= 6
    assert all(r["price_vnd"] <= 7_000_000 for r in result.data["candidates"])


def test_recorded_map_followup(recorded_states):
    state = recorded_states[1]
    selected = state["intake"].user_confirmed_facts["selected:property"].value
    task = next(t for t in state["plan"].tasks if t.agent.value == "map")
    assert task.inputs["selected_listing_id"] == selected
    assert task.inputs["radius_m"] == 800 and task.inputs["categories"] == ["pharmacy"]
    assert state["task_results"][task.id].status == "done"
    assert not any(
        r.agent.value == "property" and r.data.get("execution", {}).get("request_id") == state["request_id"]
        for r in state["task_results"].values()
    )


def test_recorded_moving_reference(recorded_states):
    state = recorded_states[2]
    values = state["intake"].constraints.values
    assert values["from_address"] == "selected:property"
    assert values["move_date"] == "2026-10-12" and values["move_time"] == "14:00"
    relocation = next(r for r in state["task_results"].values() if r.agent.value == "relocation")
    assert relocation.status == "needs_input"
    assert not {q.field for q in relocation.questions} & {"move_date", "move_time"}


def test_recorded_provider_refusal(recorded_states):
    state = recorded_states[3]
    values = state["intake"].constraints.values
    assert values["move_date"] == "2026-10-12" and values["move_time"] == "16:15"
    assert values["pickup_coordinate"] and values["destination_coordinate"]
    result = next(r for r in state["task_results"].values() if r.agent.value == "relocation")
    assert result.source_kind == "sandbox" and refusal_recovery(result)
