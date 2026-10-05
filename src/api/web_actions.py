"""Structured read/selection actions for the SIU web client; never commits orders."""

import asyncio
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from langchain_core.messages import HumanMessage
from pydantic import BaseModel, ConfigDict, Field

from src.agents.common import utcnow
from src.agents.graph import run_config
from src.agents.models import AgentName, AgentResponse, ConfirmedFact, Quote, TaskStatus, active_commits
from src.agents.nodes.change_impact import selection_impact
from src.agents.nodes.cost_summary import make_cost_summary
from src.agents.subagents.services.location import to_candidate
from src.agents.suggestions import next_step_suggestions
from src.api.routes import Service, UserId, _lock, _owned, _to_response, authenticate
from src.services.adapters.mcp import ToolCallError

router = APIRouter(prefix="/ui", dependencies=[Depends(authenticate)])


async def explored_listing(service, listing_id: str) -> dict | None:
    """Trusted copy of a listing the user picked on the map; never built from client data."""
    client = getattr(service.deps.agents.get(AgentName.PROPERTY), "client", None)
    if client is None:
        return None
    try:
        raw = await client.call("get_housing", {"listing_id": listing_id})
    except ToolCallError as exc:
        if exc.transport or exc.retryable:
            raise HTTPException(502, "Chưa đọc được tin nhà. Hãy thử lại.") from None
        return None
    if not raw or raw.get("listing_id") != listing_id:
        return None
    candidate, _ = to_candidate(raw, [])
    if candidate["price_vnd"] is None or candidate["address"] is None:
        return None  # same comparability rule as housing search results
    return {**candidate, "origin": "map_workspace"}


class ResultAction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["select", "more"]
    task_id: str = Field(min_length=1, max_length=128)
    plan_version: int
    fetched_at: datetime
    entity_id: str | None = Field(default=None, max_length=200)


def client_for(service, domain):
    agent = service.deps.agents.get(domain)
    client = getattr(agent, "client", None)
    if client is None:
        raise HTTPException(503, "Dịch vụ này chưa được kết nối.")
    return client


@router.get("/moving/services")
async def moving_services(
    service: Service, lat: float = Query(ge=-90, le=90), lng: float = Query(ge=-180, le=180), refresh: bool = False
):
    """Read the provider's catalog for the confirmed pickup. No write credentials or raw provider data."""
    agent = service.deps.agents.get(AgentName.RELOCATION)
    client = getattr(agent, "moving", None) or getattr(agent, "client", None)
    if client is None:
        raise HTTPException(503, "Dịch vụ chuyển đồ chưa được kết nối.")
    try:
        arguments = {"lat": lat, "lng": lng}
        catalog_cache = getattr(agent, "catalog_cache", None)
        if refresh and catalog_cache is not None:
            catalog_cache.invalidate(arguments)

        async def read_catalog(query):
            return (
                await catalog_cache.read(query)
                if catalog_cache is not None
                else await client.call("list_moving_services", query)
            )

        # The default provider catalog can contain only INSTANT. Include actual
        # TRUCK services too, reading independent catalogs in parallel.
        catalogs = await asyncio.gather(read_catalog(arguments), read_catalog({**arguments, "delivery_type": "TRUCK"}))
        services = {row["service_id"]: row for catalog in catalogs for row in (catalog or {}).get("services", [])}
        raw = {"services": list(services.values())}
    except ToolCallError:
        raise HTTPException(502, "Chưa tải được gói xe và tùy chọn AhaMove. Hãy thử lại.") from None
    request_keys = (
        "_id",
        "request_id",
        "name",
        "name_vi_vn",
        "description",
        "description_vi_vn",
        "type",
        "price",
        "enable",
    )
    choice_keys = ("_id", "code", "name", "name_vi_vn", "description_vi_vn", "price", "selectable", "need_user_input")
    rows = []
    for service_row in (raw or {}).get("services", []):
        row = {
            k: service_row.get(k)
            for k in ("service_id", "name", "description", "delivery_type", "currency", "cod_limit")
        }
        row["requests"] = []
        for item in service_row.get("requests", []):
            if item.get("enable") is False:
                continue
            clean = {k: item.get(k) for k in request_keys}
            for key in ("tier_list", "options"):
                clean[key] = [{k: c.get(k) for k in choice_keys} for c in item.get(key) or []]
            row["requests"].append(clean)
        rows.append(row)
    return {"services": rows}


@router.get("/flight/{offer_id}")
async def flight_detail(offer_id: str, service: Service):
    try:
        raw = await client_for(service, AgentName.FLIGHT).call("get_offer", {"offer_id": offer_id})
        offer = (raw or {}).get("offer", {})
        if offer.get("offer_id") != offer_id or offer.get("source") != "serpapi":
            raise HTTPException(404, "Chuyến bay không còn khả dụng. Hãy tìm lại.")
        return {k: offer.get(k) for k in ("offer_id", "segments", "total_price", "currency", "expires_at", "source")}
    except ToolCallError:
        raise HTTPException(502, "Chưa tải được hành trình. Hãy thử lại.") from None


@router.get("/housing/{listing_id}")
async def housing_detail(listing_id: str, service: Service):
    try:
        raw = await client_for(service, AgentName.PROPERTY).call("get_housing", {"listing_id": listing_id})
        if not raw or raw.get("listing_id") != listing_id:
            raise HTTPException(404, "Tin nhà không còn khả dụng.")
        candidate, _ = to_candidate(raw, [])
        return {**candidate, "description": raw.get("description"), "images": raw.get("images", [])}
    except ToolCallError:
        raise HTTPException(502, "Chưa tải được tin nhà. Hãy thử lại.") from None


@router.post("/chat/{thread_id}/action")
async def result_action(thread_id: str, body: ResultAction, service: Service, user_id: UserId = "anonymous"):
    async with _lock(service, thread_id):
        state, pending = await _owned(service, thread_id, user_id)
        if pending:
            raise HTTPException(409, "Hãy đổi hoặc từ chối phương án đang chờ trước khi thay lựa chọn.")
        plan = state.get("plan")
        result = (state.get("task_results") or {}).get(body.task_id)
        if (
            not plan
            or plan.version != body.plan_version
            or not plan.task(body.task_id)
            or not result
            or result.status != "done"
            or (state.get("task_status") or {}).get(body.task_id) != TaskStatus.DONE
            or body.fetched_at.tzinfo is None
            or result.fetched_at != body.fetched_at
        ):
            raise HTTPException(409, "Nhóm kết quả đã thay đổi. Hãy sử dụng kết quả mới nhất.")
        intake = state["intake"].model_copy(deep=True)
        update = {}
        if body.kind == "select":
            committed = active_commits(state.get("committed"))
            previous = intake.user_confirmed_facts.get(f"selected:{result.agent.value}")
            affected = (
                selection_impact(plan, body.task_id, result.agent, previous.value if previous else None)
                if previous is None or previous.value != body.entity_id
                else {body.task_id}
            )
            if any(a.id in committed and a.source_task_id in affected for a in plan.commit_actions):
                raise HTTPException(
                    409, "Lựa chọn liên quan tới dịch vụ đã đặt. Hãy yêu cầu thay đổi trong chat để kiểm tra đơn trước."
                )
            key = {AgentName.PROPERTY: "candidates", AgentName.FLIGHT: "offers", AgentName.RELOCATION: "quotes"}.get(
                result.agent
            )
            rows = result.data.get(key, []) if key else []
            chosen = next((r for r in rows if (r.get("id") or r.get("option_id")) == body.entity_id), None)
            if not chosen and result.agent == AgentName.PROPERTY:
                # A listing explored on the map workspace: re-read it from Location and add it to
                # this housing result, so selection, plan outline and later tasks see a real option.
                chosen = await explored_listing(service, body.entity_id)
                if chosen:
                    result = result.model_copy(deep=True)
                    missing = [
                        key for key in ("price_vnd", "deposit_vnd", "area_m2", "address") if chosen.get(key) is None
                    ]
                    if chosen.get("price_unverified"):
                        missing.append("price_quality")
                    append_housing_candidate(result, chosen, missing)
                    update["task_results"] = {body.task_id: result}
            if not chosen:
                raise HTTPException(409, "Lựa chọn không thuộc nhóm kết quả hiện tại.")
            expiry = chosen.get("expires_at") or result.data.get("expires_at")
            if expiry:
                try:
                    deadline = datetime.fromisoformat(str(expiry))
                except ValueError:
                    deadline = None
                if deadline is None or deadline.tzinfo is None or deadline <= utcnow():
                    raise HTTPException(409, "Lựa chọn đã hết hạn hoặc chưa xác minh được thời hạn. Hãy tìm lại.")
            elif result.agent in {AgentName.FLIGHT, AgentName.RELOCATION}:
                raise HTTPException(409, "Báo giá thiếu thời hạn. Hãy tìm lại.")
            label = (
                chosen.get("title")
                or chosen.get("carrier")
                or chosen.get("vehicle")
                or chosen.get("service_name")
                or "phương án"
            )
            text = f"Tôi chọn {label} (ID: {body.entity_id})."
            intake.user_confirmed_facts[f"selected:{result.agent.value}"] = ConfirmedFact(
                value=body.entity_id,
                evidence=text,
                stated_at=utcnow(),
            )
            update.update(intake=intake, messages=[HumanMessage(text)])
            update["task_status"] = {tid: TaskStatus.STALE for tid in affected - {body.task_id}}
            # Downstream choices become stale; the choice just made in this domain stays.
            for agent in {plan.task(tid).agent for tid in affected - {body.task_id}} - {result.agent}:
                intake.user_confirmed_facts.pop(f"selected:{agent.value}", None)
            if result.agent == AgentName.PROPERTY and previous and previous.value != body.entity_id:
                old_house = next((r for r in rows if r.get("id") == previous.value), {})
                pins = dict(state.get("moving_locations") or {})
                for endpoint, address_key, coordinate_key in (
                    ("pickup", "from_address", "pickup_coordinate"),
                    ("destination", "to_address", "destination_coordinate"),
                ):
                    if old_house.get("address") and (pins.get(endpoint) or {}).get("address") == old_house["address"]:
                        pins.pop(endpoint)
                        intake.constraints.values.pop(coordinate_key, None)
                        intake.constraints.values[address_key] = "selected:property"
                        intake.user_confirmed_facts.pop(address_key, None)
                update["moving_locations"] = pins
            # Same next-step rules as a chat answer (e.g. quote moving to the chosen home).
            suggestions = next_step_suggestions(
                {
                    **state,
                    **update,
                    "task_results": {**state.get("task_results", {}), **update.get("task_results", {})},
                },
                service.deps.agents,
                service.deps.settings.max_suggestions,
                "ANSWER",
            )
            response = AgentResponse(
                kind="ANSWER",
                text=f"Đã lưu lựa chọn: {label}. Chưa thực hiện đặt dịch vụ."
                + (" Bạn có thể làm tiếp:" if suggestions else ""),
                suggestions=suggestions,
            )
        else:
            cursor = result.data.get("next_cursor")
            if result.agent != AgentName.PROPERTY or not cursor or not result.data.get("search_request"):
                raise HTTPException(409, "Nhóm kết quả này không có trang tiếp theo.")
            request = dict(result.data["search_request"])
            request["pagination"] = {**request.get("pagination", {}), "cursor": cursor}
            try:
                raw = await client_for(service, AgentName.PROPERTY).call("search_housing", request)
            except ToolCallError:
                raise HTTPException(502, "Không tải được trang tiếp. Hãy thử lại.") from None
            result = result.model_copy(deep=True)
            known = {c["id"] for c in result.data["candidates"]}
            for row in raw.get("results", []):
                candidate, missing = to_candidate(row, request.get("amenities", []))
                if candidate["price_vnd"] is None or candidate["address"] is None:
                    continue
                if candidate["id"] not in known:
                    if candidate.get("price_unverified"):
                        missing.append("price_quality")
                    known.add(candidate["id"])
                    append_housing_candidate(result, candidate, missing)
            result.data.update(
                next_cursor=(raw.get("page") or {}).get("next_cursor"),
                map_context={"scope": "returned_candidates", "listing_ids": list(known)},
            )
            result.data["has_more"] = bool(result.data["next_cursor"])
            result.fetched_at = utcnow()
            update["task_results"] = {body.task_id: result}
            response = AgentResponse(
                kind="ANSWER",
                text=f"Đang hiển thị {len(known)} căn trong các trang đã tải.",
                data={
                    "results": {
                        body.task_id: {
                            "agent": "property",
                            "data": result.data,
                            "source": result.source,
                            "source_kind": result.source_kind,
                            "source_refs": result.source_refs,
                            "fetched_at": result.fetched_at.isoformat(),
                        }
                    }
                },
            )
        merged = {
            **state,
            **update,
            "task_results": {**state.get("task_results", {}), **update.get("task_results", {})},
            "task_status": {**state.get("task_status", {}), **update.get("task_status", {})},
        }
        summary = await make_cost_summary(service.deps)(merged)
        update.update(cost_summary=summary["cost_summary"], response=response)
        await service.graph.aupdate_state(run_config(thread_id, service.deps), update, as_node="respond")
        return _to_response(thread_id, {"response": response}, service)


def append_housing_candidate(result, candidate: dict, missing: list[str]) -> None:
    """Keep citations, cost options and missing-field indices in sync with added real listings."""
    rows = result.data.setdefault("candidates", [])
    index = len(rows)
    rows.append(candidate)
    result.source_refs = list(dict.fromkeys([*result.source_refs, candidate["id"]]))
    result.missing_fields.extend(f"candidates[{index}].{key}" for key in missing)
    result.data["map_context"] = {
        **result.data.get("map_context", {}),
        "scope": "returned_candidates",
        "listing_ids": [c["id"] for c in rows],
    }
    if candidate.get("price_vnd") is not None and not candidate.get("price_unverified"):
        result.quotes.append(
            Quote(
                option_id=candidate["id"],
                label=candidate["title"],
                amount_vnd=candidate["price_vnd"],
                recurrence="monthly",
            )
        )
