"""Structured read/selection actions for the SIU web client; never commits orders."""

import asyncio
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from langchain_core.messages import HumanMessage
from pydantic import BaseModel, ConfigDict, Field
from relohome_agent.agents.common import utcnow
from relohome_agent.agents.graph import run_config
from relohome_agent.agents.models import AgentName, AgentResponse, ConfirmedFact, Quote, TaskStatus, active_commits
from relohome_agent.agents.nodes.change_impact import selection_impact
from relohome_agent.agents.nodes.cost_summary import make_cost_summary
from relohome_agent.agents.progress import select_plan_option
from relohome_agent.agents.selections import option_is_expired
from relohome_agent.agents.subagents.services.location import to_candidate
from relohome_agent.agents.suggestions import next_step_suggestions
from relohome_agent.api.routes import Service, UserId, _lock, _owned, _to_response, authenticate
from relohome_agent.services.adapters.mcp import ToolCallError

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
        return {
            **candidate,
            "description": raw.get("description"),
            "images": raw.get("images", []),
            # Additive decision-support fields. Imported listings simply return
            # an empty fee list and no management metadata.
            "fees": raw.get("fees") or [],
            "management": raw.get("management"),
        }
    except ToolCallError:
        raise HTTPException(502, "Chưa tải được tin nhà. Hãy thử lại.") from None


@router.post("/chat/{thread_id}/action")
async def result_action(thread_id: str, body: ResultAction, service: Service, user_id: UserId = "anonymous"):
    return await choose_result(thread_id, body, service, user_id)


async def choose_result(thread_id: str, body: ResultAction, service, user_id: str, *, plan_choice: bool = False):
    """Acquire the thread lock for a standalone selection action."""
    async with _lock(service, thread_id):
        return await _choose_result_locked(thread_id, body, service, user_id, plan_choice=plan_choice)


async def _choose_result_locked(thread_id: str, body: ResultAction, service, user_id: str, *, plan_choice: bool = False):
    """Internal selection step: caller owns the thread lock across its entire operation."""
    if not service.locks[thread_id].locked():
        raise RuntimeError("Selection requires the thread lock")
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
    if result.data.get("comparison"):
        raise HTTPException(409, "Bảng so sánh chỉ để đọc. Hãy mở kết quả tìm nhà để thay lựa chọn.")
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
        if result.agent == AgentName.FLIGHT:
            # Vé khứ hồi: lựa chọn cuối là hành trình (đi + về); chuyến đi chọn bằng /flight/outbound.
            rows = [*rows, *(result.data.get("return_options") or [])]
        chosen = next((r for r in rows if (r.get("id") or r.get("option_id")) == body.entity_id), None)
        if chosen and chosen.get("kind") == "round_trip_outbound":
            raise HTTPException(
                409, "Đây là chuyến đi của vé khứ hồi. Hãy chọn chuyến đi để xem chiều về, rồi chọn chiều về."
            )
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
        if option_is_expired(result, body.entity_id):
            raise HTTPException(409, "Lựa chọn đã hết hạn hoặc chưa xác minh được thời hạn. Hãy tìm lại.")
        label = (
            chosen.get("title")
            or chosen.get("carrier")
            or chosen.get("vehicle")
            or chosen.get("service_name")
            or "phương án"
        )
        if result.agent == AgentName.PROPERTY and getattr(service, "viewing", None) and not plan_choice:
            # Chọn để hẹn xem, chưa phải căn của kế hoạch (housing-viewing-design V3).
            from relohome_agent.api.viewings import select_for_viewing

            return await select_for_viewing(service, thread_id, user_id, state, body.task_id, chosen, update)
        text = f"Tôi chọn {label} (ID: {body.entity_id})."
        intake.user_confirmed_facts[f"selected:{result.agent.value}"] = ConfirmedFact(
            value=body.entity_id,
            evidence=text,
            stated_at=utcnow(),
        )
        update.update(intake=intake, messages=[HumanMessage(text)])
        update["task_status"] = {tid: TaskStatus.STALE for tid in affected - {body.task_id}}
        update["goal_selections"] = select_plan_option(state, body.task_id, body.entity_id, affected)
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


class OutboundAction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    task_id: str = Field(min_length=1, max_length=128)
    plan_version: int
    fetched_at: datetime
    offer_id: str = Field(min_length=1, max_length=200)


def _leg(segment_list: list[dict], direction: str, carrier: str | None) -> dict:
    first, last = segment_list[0], segment_list[-1]
    return {
        "direction": direction,
        "carrier": first.get("airline_name") or carrier,
        "origin": first.get("origin"),
        "destination": last.get("destination"),
        "depart_at": first.get("departure_time"),
        "arrive_at": last.get("arrival_time"),
        "flight_numbers": [s.get("flight_number") for s in segment_list],
        "stops": len(segment_list) - 1,
    }


@router.post("/chat/{thread_id}/flight/outbound")
async def flight_outbound(thread_id: str, body: OutboundAction, service: Service, user_id: UserId = "anonymous"):
    """Vé khứ hồi: người dùng duyệt chiều đi, app lấy chiều về cho đúng chuyến đó (0 LLM, payment-design §8.2)."""
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
            or result.agent != AgentName.FLIGHT
            or result.status != "done"
            or body.fetched_at.tzinfo is None
            or result.fetched_at != body.fetched_at
        ):
            raise HTTPException(409, "Nhóm kết quả đã thay đổi. Hãy sử dụng kết quả mới nhất.")
        if result.data.get("trip_type") != "round_trip":
            raise HTTPException(409, "Kết quả này không phải vé khứ hồi.")
        outbound = next((o for o in result.data.get("offers", []) if o.get("id") == body.offer_id), None)
        if outbound is None or outbound.get("kind") != "round_trip_outbound":
            raise HTTPException(409, "Chuyến đi không thuộc nhóm kết quả hiện tại.")
        try:
            deadline = datetime.fromisoformat(str(outbound.get("expires_at")))
        except ValueError:
            deadline = None
        if deadline is None or deadline.tzinfo is None or deadline <= utcnow():
            raise HTTPException(409, "Giá tham khảo của chuyến đi đã hết hạn. Hãy tìm lại.")
        try:
            raw = await client_for(service, AgentName.FLIGHT).call(
                "search_return_flights", {"outbound_offer_id": body.offer_id}
            )
        except ToolCallError as exc:
            if exc.transport or exc.retryable:
                raise HTTPException(502, "Chưa tải được chiều về. Hãy thử lại.") from None
            raise HTTPException(409, "Chuyến đi đã hết hạn hoặc không còn chiều về. Hãy tìm lại.") from None
        rows, quotes = [], []
        for offer in (raw or {}).get("offers", []):
            if offer.get("source") != "serpapi" or offer.get("kind") != "round_trip":
                continue
            out_leg = _leg(offer.get("segments") or [{}], "out", outbound.get("carrier"))
            back_leg = _leg(offer.get("return_segments") or [{}], "return", None)
            row = {
                "id": offer["offer_id"],
                "kind": "round_trip",
                "price_scope": "round_trip",
                "carrier": back_leg["carrier"],
                "fare_vnd": offer.get("total_price"),
                "depart_at": back_leg["depart_at"],
                "arrive_at": back_leg["arrive_at"],
                "stops": back_leg["stops"],
                "expires_at": offer.get("expires_at"),
                "outbound_id": body.offer_id,
                "legs": [out_leg, back_leg],
                "baggage_kg": None,
            }
            rows.append(row)
            if row["fare_vnd"] is not None:
                quotes.append(
                    Quote(
                        option_id=row["id"],
                        label=f"Khứ hồi {out_leg['carrier']} / {back_leg['carrier']}",
                        amount_vnd=int(row["fare_vnd"]),
                        recurrence="one_time",
                    )
                )
        result = result.model_copy(deep=True)
        old_ids = {r.get("id") for r in result.data.get("return_options") or []}
        result.quotes = [q for q in result.quotes if q.option_id not in old_ids] + quotes
        result.data.update(
            outbound_offer_id=body.offer_id, return_options=rows, return_message=(raw or {}).get("message")
        )
        result.source_refs = list(dict.fromkeys([*result.source_refs, *(r["id"] for r in rows)]))
        result.fetched_at = utcnow()
        intake = state["intake"].model_copy(deep=True)
        update: dict = {"task_results": {body.task_id: result}, "intake": intake}
        chosen = intake.user_confirmed_facts.get("selected:flight")
        if chosen is not None and str(chosen.value) not in {r["id"] for r in rows}:
            # Đổi chuyến đi: lựa chọn chiều về cũ và các lần duyệt liên quan hết hiệu lực.
            intake.user_confirmed_facts.pop("selected:flight", None)
            selections = dict(state.get("goal_selections") or {})
            selections.pop(body.task_id, None)
            update["goal_selections"] = selections
        label = f"{outbound.get('carrier')} {str(outbound.get('depart_at'))[11:16]}"
        text = (
            f"Đã chọn chuyến đi {label}. Chọn một chuyến về để có giá cả hành trình."
            if rows
            else f"Đã chọn chuyến đi {label}. {(raw or {}).get('message') or 'Chưa có chuyến về phù hợp.'}"
        )
        update["messages"] = [HumanMessage(f"Tôi chọn chuyến đi {label} (ID: {body.offer_id}).")]
        response = AgentResponse(
            kind="ANSWER",
            text=text,
            data={
                "results": {
                    body.task_id: {
                        "agent": "flight",
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
            "task_results": {**state.get("task_results", {}), **update["task_results"]},
        }
        summary = await make_cost_summary(service.deps)(merged)
        update.update(cost_summary=summary["cost_summary"], response=response)
        await service.graph.aupdate_state(run_config(thread_id, service.deps), update, as_node="respond")
        return _to_response(thread_id, {"response": response}, service)
