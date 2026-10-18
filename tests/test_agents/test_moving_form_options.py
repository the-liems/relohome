"""Moving form -> provider quote -> private approval -> re-estimate, with explicit offline fixtures."""

import json
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI
from pydantic import ValidationError
from relohome_agent.agents.common import utcnow
from relohome_agent.agents.contracts import AgentTaskRequest
from relohome_agent.agents.llm_runtime import Invocation
from relohome_agent.agents.models import AgentBudget, AgentName, SessionContext
from relohome_agent.agents.planner_llm import LlmPlanner, PlanDraft
from relohome_agent.agents.planning import PlannerInput
from relohome_agent.agents.subagents.services.moving import QuoteContact
from relohome_agent.agents.subagents.services.moving_catalog import MovingCatalogCache
from relohome_agent.agents.subagents.services.moving_llm import MovingExecution
from relohome_agent.api.routes import router as chat_router
from relohome_agent.api.web_actions import router
from relohome_contracts.moving_options import MovingOptions, service_selection, validated_options

from tests.test_agents.helpers import intake_result
from tests.test_agents.test_commit_adapter import RecordingBridge, booking_client, request, tx

SERVICE = {
    "service_id": "SGN-TRUCK-500",
    "name": "Xe tải",
    "cod_limit": 500000,
    "requests": [
        {"_id": "lift", "name": "Bốc xếp", "type": "BOOLEAN"},
        {"_id": "tip", "name": "Hỗ trợ tài xế", "type": "PER_UNIT"},
        {
            "_id": "bulky",
            "type": "TIER",
            "tier_list": [{"code": "small", "selectable": True}, {"code": "over", "selectable": False}],
        },
        {"_id": "fragile", "type": "BOOLEAN", "options": [{"code": "glass", "selectable": True}]},
    ],
}
OPTIONS = {
    "service_id": "SGN-TRUCK-500",
    "requests": [{"request_id": "lift"}, {"request_id": "tip", "quantity": 2}],
    "packages": [{"description": "Thùng sách", "weight_kg": 12, "length_cm": 50, "width_cm": 40, "height_cm": 30}],
    "cod": 100000,
    "item_value": 300000,
    "promo_code": "MOVING",
    "remarks": "Cổng sau",
    "require_pod": True,
}


@pytest.mark.parametrize(
    "data",
    [
        {"pickup_contact": {"name": "Private", "mobile": "0901234567"}},
        {"payment_method": "BALANCE"},
        {"packages": [{"weight_kg": 0}]},
        {"cod": -1},
        {"requests": [{"request_id": "lift"}]},
        {"service_id": "s", "requests": [{"request_id": "lift"}, {"request_id": "lift"}]},
        {"service_id": "s", "requests": [{"request_id": "tip", "quantity": 0}]},
    ],
)
def test_rejects_invalid_and_private_form_inputs(data):
    with pytest.raises(ValidationError):
        MovingOptions.model_validate(data)


def test_default_keeps_legacy_estimate_and_notes_redact_contacts():
    assert validated_options(None) == {}
    assert service_selection(SERVICE, {}) == {"service_id": SERVICE["service_id"]}
    options = validated_options(
        {"remarks": "Gọi 0901234567", "packages": [{"description": "abc@example.test", "weight_kg": 1}]}
    )
    assert "0901234567" not in str(options) and "abc@example.test" not in str(options)


@pytest.mark.parametrize(
    "patch",
    [
        {"requests": [{"request_id": "invented"}]},
        {"requests": [{"request_id": "bulky", "tier_code": "over"}]},
        {"requests": [{"request_id": "bulky"}]},
        {"requests": [{"request_id": "fragile", "option_id": "unknown"}]},
        {"requests": [{"request_id": "lift", "quantity": 3}]},
        {"cod": 500001},
    ],
)
def test_rechecks_request_ids_tiers_options_and_cod_limits(patch):
    with pytest.raises(ValueError):
        service_selection(SERVICE, {**OPTIONS, **patch})


def execution(options):
    client = booking_client()
    client.endpoint = SimpleNamespace(service="moving")
    client.handlers["list_moving_services"] = {"services": [SERVICE, {"service_id": "SGN-VAN", "requests": []}]}
    req = AgentTaskRequest(
        request_id="form-options",
        thread_id="t",
        task_id="moving",
        plan_version=1,
        attempt=1,
        agent=AgentName.RELOCATION,
        inputs={
            "mode": "quote",
            "from_address": "Điểm A",
            "to_address": "Điểm B",
            "move_date": "2026-12-01",
            "moving_options": options,
        },
        budget=AgentBudget(max_llm_calls=0, max_provider_calls=8),
    )
    agent = SimpleNamespace(
        moving=client,
        catalog_cache=MovingCatalogCache(client),
        contact=QuoteContact("Quote Contact", "19001234"),
        clock=utcnow,
        source_kind="sandbox",
    )
    exe = MovingExecution(agent, req, Invocation(max_calls=0))
    exe.route = {
        "pickup": {"address": "Điểm A", "lat": 10.77, "lng": 106.69},
        "destination": {"address": "Điểm B", "lat": 10.78, "lng": 106.7},
        "order_time": 1796000000,
    }
    return exe, client


@pytest.mark.asyncio
async def test_quote_and_commit_preserve_every_selected_option_and_use_private_contacts():
    exe, client = execution(OPTIONS)
    await exe.call("list_moving_services", {})
    assert set(exe.catalog) == {SERVICE["service_id"]}
    # Even if a model asks for a different service, the explicit user selection wins.
    await exe.call("estimate_move", {"service_ids": ["SGN-VAN"]})
    initial = next(args for tool, args in client.calls if tool == "estimate_move")
    assert initial["services"] == [{"service_id": SERVICE["service_id"], "requests": OPTIONS["requests"]}]
    assert initial["draft"]["packages"] == OPTIONS["packages"]
    assert initial["draft"]["destinations"][0]["cod"] == OPTIONS["cod"]
    assert initial["draft"]["remarks"] == OPTIONS["remarks"]
    result = await exe.call("finish", {"option_ids": []})
    assert result.data["moving_options"] == OPTIONS
    assert result.data["addon_labels"][0] == {"id": "lift", "label": "Bốc xếp"}
    req = request()
    req.task_data["moving_options"] = result.data["moving_options"]
    req.pii["destination_contact"] = {
        "name": "Receiver",
        "mobile": "0907654321",
        "building": "Tòa B",
        "apartment_or_floor": "302",
        "remarks": "Có thang máy",
    }
    receipt = await tx(client, RecordingBridge()).commit(req)
    estimates = [args for tool, args in client.calls if tool == "estimate_move"]
    assert len(estimates) == 2
    refreshed = estimates[1]
    assert refreshed["services"] == initial["services"]
    for key in ("packages", "promo_code", "remarks", "payment_method"):
        assert refreshed["draft"][key] == initial["draft"][key]
    point = refreshed["draft"]["destinations"][0]
    for key in ("cod", "item_value", "require_pod"):
        assert point[key] == initial["draft"]["destinations"][0][key]
    assert point["mobile"] == "0907654321" and point["apartment_or_floor"] == "302"
    assert "0907654321" not in receipt.model_dump_json()
    assert [name for name, _ in client.calls].count("create_move_order") == 1


@pytest.mark.asyncio
async def test_invalid_addon_asks_before_any_estimate_or_write():
    exe, client = execution({**OPTIONS, "requests": [{"request_id": "unknown"}]})
    await exe.call("list_moving_services", {})
    result = await exe.call("estimate_move", {"service_ids": [SERVICE["service_id"]]})
    assert result.status == "needs_input" and result.questions[0].field == "service_id"
    assert [name for name, _ in client.calls] == ["list_moving_services"]


@pytest.mark.asyncio
async def test_native_moving_adapter_keeps_the_same_form_fields():
    from relohome_agent.agents.subagents.services.moving import MovingSubagent

    from tests.test_agents.test_service_subagents import FakeToolClient

    exe, client = execution(OPTIONS)
    geocoder = FakeToolClient(
        {"resolve_location": {"results": [{"entity_type": "place", "location": {"lat": 10.77, "lng": 106.69}}]}}
    )
    agent = MovingSubagent(client, geocoder, exe.agent.contact)
    req = exe.req.model_copy(update={"inputs": {**exe.req.inputs, "move_time": "09:00"}})
    result = await agent.run(req)
    assert result.status == "done"
    args = next(args for name, args in client.calls if name == "estimate_move")
    assert args["services"] == [{"service_id": SERVICE["service_id"], "requests": OPTIONS["requests"]}]
    assert args["draft"]["packages"] == OPTIONS["packages"]
    assert result.data["moving_options"] == OPTIONS
    assert result.data["addon_labels"][0]["label"] == "Bốc xếp"


@pytest.mark.parametrize("trusted", [None, OPTIONS])
def test_planner_cannot_invent_or_change_structured_options(trusted):
    planner = LlmPlanner(None, {})
    values = {"moving_options": trusted} if trusted else {}
    inp = PlannerInput(intake=intake_result(domains=[AgentName.RELOCATION], values=values), session=SessionContext())
    draft = PlanDraft(
        tasks=[
            {
                "id": "m",
                "agent": "relocation",
                "inputs_json": json.dumps({"mode": "quote", "moving_options": {"service_id": "invented"}}),
                "depends_on": [],
                "required": True,
            }
        ],
        actions=[],
    )
    task = planner._convert(draft, inp).tasks[0]
    assert task.inputs.get("moving_options") == trusted


@pytest.mark.asyncio
async def test_catalog_endpoint_validates_coordinates_and_drops_provider_private_fields():
    class Client:
        async def call(self, name, args):
            assert name == "list_moving_services"
            # The workspace reads the default catalog and the TRUCK catalog together.
            assert args in ({"lat": 10.77, "lng": 106.7}, {"lat": 10.77, "lng": 106.7, "delivery_type": "TRUCK"})
            return {"services": [{**SERVICE, "provider_data": {"secret": "private-value"}}]}

    service = SimpleNamespace(
        mode="fake", deps=SimpleNamespace(agents={AgentName.RELOCATION: SimpleNamespace(moving=Client())})
    )
    app = FastAPI()
    app.state.agent_service = service
    app.include_router(router)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/ui/moving/services?lat=10.77&lng=106.7")
        assert r.status_code == 200 and r.json()["services"][0]["service_id"] == SERVICE["service_id"]
        assert "private-value" not in r.text and "provider_data" not in r.text
        assert (await client.get("/ui/moving/services?lat=100&lng=106.7")).status_code == 422


@pytest.mark.asyncio
async def test_chat_passes_options_as_trusted_state_and_rejects_edits_during_approval():
    calls = []
    pending = []

    class Graph:
        async def aget_state(self, config):
            return SimpleNamespace(
                values={"user_id": "u"} if pending else {},
                tasks=[SimpleNamespace(interrupts=[SimpleNamespace(value=pending[0])])] if pending else [],
            )

        async def ainvoke(self, state, config):
            calls.append(state)
            return {}

    service = SimpleNamespace(
        mode="fake", locks={}, graph=Graph(), deps=SimpleNamespace(settings=SimpleNamespace(recursion_limit=50))
    )
    app = FastAPI()
    app.state.agent_service = service
    app.include_router(chat_router)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"X-User-Id": "u"}
    ) as client:
        body = {"thread_id": "t", "message": "Báo giá chuyển đồ", "moving_options": OPTIONS}
        r = await client.post("/chat", json=body)
        assert r.status_code == 200
        assert calls[0]["moving_options"]["requests"] == OPTIONS["requests"]
        assert calls[0]["messages"][0].content == body["message"]
        pending.append({"type": "confirmation_required", "plan_version": 1})
        assert (await client.post("/chat", json=body)).status_code == 409
        assert len(calls) == 1


@pytest.mark.asyncio
async def test_intake_preserves_form_on_followup_but_clears_it_for_new_goal():
    from dataclasses import replace

    from langchain_core.messages import HumanMessage
    from relohome_agent.agents.deps import default_deps
    from relohome_agent.agents.intake import FixedIntake
    from relohome_agent.agents.models import RequestKind
    from relohome_agent.agents.nodes.intake import make_intake

    deps = default_deps()
    state = {
        "thread_id": "t",
        "request_id": "r",
        "messages": [HumanMessage("chuyển đồ")],
        "session": SessionContext(),
        "moving_options": OPTIONS,
    }
    deps = replace(deps, intake=FixedIntake(intake_result(domains=[AgentName.RELOCATION])))
    first = await make_intake(deps)(state)
    assert first["intake"].constraints.values["moving_options"] == OPTIONS
    deps = replace(deps, intake=FixedIntake(intake_result(kind=RequestKind.REFINE, domains=[AgentName.RELOCATION])))
    state.update(intake=first["intake"], moving_options=None)
    followup = await make_intake(deps)(state)
    assert followup["intake"].constraints.values["moving_options"] == OPTIONS
    deps = replace(
        deps,
        intake=FixedIntake(
            intake_result(domains=[AgentName.RELOCATION], values={"moving_options": {"service_id": "invented"}})
        ),
    )
    new = await make_intake(deps)({**state, "intake": followup["intake"]})
    assert "moving_options" not in new["intake"].constraints.values
