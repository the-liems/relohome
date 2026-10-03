"""Các điều chỉnh theo phản hồi của service Moving (Khoa, 2026-09-29)."""

from datetime import datetime, timedelta

import pytest
from mcp.types import CallToolResult, TextContent
from pydantic import SecretStr

from src.agents.common import utcnow
from src.agents.contracts import UpstreamResult
from src.agents.deps import GraphSettings, test_deps
from src.agents.intake import ScriptedIntake, redact_pii
from src.agents.models import AgentName, CommitActionKind, Receipt, RequestKind, SessionContext
from src.agents.planning import PlannerInput, TemplatePlanner
from src.agents.subagents.conformance import sample_request
from src.agents.subagents.services.moving import VN_TZ, MovingSubagent, QuoteContact, order_time
from src.services.adapters.mcp import ToolCallError, unwrap
from src.services.adapters.registry import ServiceRegistry, ServiceSettings
from tests.test_agents.helpers import Session, commit_fact, intake_result
from tests.test_agents.test_service_subagents import FakeToolClient, moving_client

MOVE = {"from_address": "12 Láng Hạ", "to_address": "45 Kim Mã", "move_date": "2026-11-14", "move_time": "09:00"}


@pytest.mark.asyncio
async def test_confirmation_shows_consented_price_band_for_moving():
    intake = intake_result(
        RequestKind.NEW_GOAL,
        [AgentName.RELOCATION],
        values=MOVE,
        facts=dict([commit_fact(CommitActionKind.MOVING_BOOKING, "Đặt xe")]),
    )
    out = await Session(test_deps(ScriptedIntake([intake]), TemplatePlanner())).say("Đặt xe chuyển nhà")
    payload = out["__interrupt__"][0].value
    line = payload["cost_summary"]["lines"][0]
    assert (line["min_amount_vnd"], line["amount_vnd"], line["max_amount_vnd"]) == (3_040_000, 3_200_000, 3_360_000)
    assert payload["cost_summary"]["total_one_time_max_vnd"] == 3_360_000
    note = payload["notes"]["moving_booking:t1"]
    assert "3.360.000đ" in note and "tiền mặt" in note


@pytest.mark.asyncio
async def test_band_can_be_disabled():
    intake = intake_result(
        RequestKind.NEW_GOAL,
        [AgentName.RELOCATION],
        values=MOVE,
        facts=dict([commit_fact(CommitActionKind.MOVING_BOOKING, "Đặt xe")]),
    )
    deps = test_deps(ScriptedIntake([intake]), TemplatePlanner(), settings=GraphSettings(price_tolerance={}))
    out = await Session(deps).say("Đặt xe chuyển nhà")
    assert out["__interrupt__"][0].value["cost_summary"]["lines"][0]["max_amount_vnd"] is None


def test_order_time_requires_explicit_future_time():
    now = datetime(2026, 11, 14, 8, 0, tzinfo=VN_TZ)
    assert order_time("2026-11-14", None, now) is None  # không tự chọn 08:00
    assert order_time("2026-11-14", "08:10", now) is None  # quá sát / đã qua: không thành đơn gọi ngay
    assert order_time("2026-11-14", "09:00", now) == int(datetime(2026, 11, 14, 9, 0, tzinfo=VN_TZ).timestamp())


@pytest.mark.asyncio
async def test_moving_asks_when_address_only_matches_a_district_or_time_missing():
    geo = FakeToolClient(
        {
            "resolve_location": {
                "ambiguous": False,
                "results": [{"entity_type": "administrative_area", "location": {"lat": 21.0, "lng": 105.8}}],
            }
        }
    )
    agent = MovingSubagent(moving_client(), geo, QuoteContact("LifeFlow", "19001234"))
    upstream = {
        "t1": UpstreamResult(
            task_id="t1",
            agent=AgentName.PROPERTY,
            data={"candidates": [{"id": "l", "address": "x", "lat": 10.7, "lng": 106.6}]},
        )
    }
    req = sample_request(
        AgentName.RELOCATION,
        {"mode": "quote", "from_address": "Quận Đống Đa", "move_date": "2026-11-14", "selected_listing_id": "l"},
        upstream,
    )
    result = await agent.run(req)
    assert result.status == "needs_input"
    assert {q.field for q in result.questions} == {"move_time", "from_address"}


def test_structured_mcp_error_uses_server_retryable():
    error = CallToolResult(
        isError=True,
        content=[
            TextContent(
                type="text",
                text='{"code":"QUOTE_EXPIRED","message":"The selected quote has expired.","retryable":false}',
            )
        ],
    )
    with pytest.raises(ToolCallError) as err:
        unwrap(error)
    assert err.value.code == "QUOTE_EXPIRED" and err.value.retryable is False


def test_no_write_endpoint_without_write_token():
    base = dict(_env_file=None, moving_mcp_url="http://moving-mcp:4400/mcp", moving_mcp_auth_token=SecretStr("r" * 32))
    assert ServiceRegistry.from_settings(ServiceSettings(**base)).moving.write_client() is None
    registry = ServiceRegistry.from_settings(ServiceSettings(**base, moving_mcp_write_token=SecretStr("w" * 32)))
    assert registry.moving.write_client().endpoint.token == "w" * 32


def test_pii_is_redacted_before_llm():
    text = "Mình tên A, sđt 0901 234 567, mail a.b@gmail.com, CCCD 012345678901, chuyển 14/11 lúc 9:00, 6.000.000đ"
    out = redact_pii(text)
    assert "0901" not in out and "gmail" not in out and "012345678901" not in out
    assert "14/11" in out and "6.000.000đ" in out


@pytest.mark.asyncio
async def test_cancel_uses_the_single_booked_order_of_the_thread():
    intake = intake_result(
        RequestKind.REFINE,
        [AgentName.RELOCATION],
        facts=dict([commit_fact(CommitActionKind.CANCEL_ORDER, "huỷ")]),
    ).model_copy(update={"commit_requested": [CommitActionKind.CANCEL_ORDER]})
    receipt = Receipt(
        receipt_id="ORD7",
        action_id="moving_booking:t2",
        kind=CommitActionKind.MOVING_BOOKING,
        provider="ahamove",
        amount_vnd=1,
        source_kind="sandbox",
        status="ASSIGNING",
        created_at=utcnow() - timedelta(minutes=5),
    )
    plan = (
        await TemplatePlanner().plan(
            PlannerInput(intake=intake, session=SessionContext(), committed={receipt.action_id: receipt})
        )
    ).plan
    assert plan.tasks[0].inputs == {"mode": "order_status", "order_id": "ORD7"}
    assert plan.commit_actions[0].target_receipt_id == "ORD7"


@pytest.mark.asyncio
async def test_abbreviated_place_is_left_to_the_domain_not_blocked_at_intake():
    # No alias table in code: the user's spelling goes to the domain, which resolves it against real
    # Location data or asks back for that field only, without blocking other requested domains.
    intake = intake_result(RequestKind.NEW_GOAL, [AgentName.PROPERTY], values={"near": "Q10"})
    deps = test_deps(ScriptedIntake([intake]), TemplatePlanner())
    out = await Session(deps).say("Tìm phòng ở Q10")
    assert not out["intake"].conflicts
    assert out["intake"].constraints.values["near"] == "Q10"
    assert [r.inputs.get("near") for r in deps.agents.get(AgentName.PROPERTY).requests] == ["Q10"]
