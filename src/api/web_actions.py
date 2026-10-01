"""Structured read/selection actions for the SIU web client; never commits orders."""

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from langchain_core.messages import HumanMessage
from pydantic import BaseModel, ConfigDict, Field

from src.agents.common import utcnow
from src.agents.graph import run_config
from src.agents.models import AgentName, AgentResponse, ConfirmedFact, Quote, TaskStatus, active_commits
from src.agents.nodes.change_impact import downstream_closure
from src.agents.nodes.cost_summary import make_cost_summary
from src.agents.subagents.services.location import to_candidate
from src.api.routes import Service, UserId, _lock, _owned, _to_response, authenticate
from src.services.adapters.mcp import ToolCallError

router = APIRouter(prefix="/ui", dependencies=[Depends(authenticate)])


class ResultAction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["select", "more"]
    task_id: str = Field(min_length=1, max_length=128)
    plan_version: int
    fetched_at: str
    entity_id: str | None = Field(default=None, max_length=200)


def client_for(service, domain):
    agent = service.deps.agents.get(domain)
    client = getattr(agent, "client", None)
    if client is None:
        raise HTTPException(503, "Dịch vụ này chưa được kết nối.")
    return client


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
            or result.fetched_at.isoformat() != body.fetched_at
        ):
            raise HTTPException(409, "Nhóm kết quả đã thay đổi. Hãy sử dụng kết quả mới nhất.")
        intake = state["intake"].model_copy(deep=True)
        update = {}
        if body.kind == "select":
            committed = active_commits(state.get("committed"))
            affected = downstream_closure(plan, {body.task_id})
            if any(a.id in committed and a.source_task_id in affected for a in plan.commit_actions):
                raise HTTPException(
                    409, "Lựa chọn liên quan tới dịch vụ đã đặt. Hãy yêu cầu thay đổi trong chat để kiểm tra đơn trước."
                )
            key = {AgentName.PROPERTY: "candidates", AgentName.FLIGHT: "offers", AgentName.RELOCATION: "quotes"}.get(
                result.agent
            )
            rows = result.data.get(key, []) if key else []
            chosen = next((r for r in rows if (r.get("id") or r.get("option_id")) == body.entity_id), None)
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
            response = AgentResponse(kind="ANSWER", text=f"Đã lưu lựa chọn: {label}. Chưa thực hiện đặt dịch vụ.")
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
                candidate, _ = to_candidate(row, request.get("amenities", []))
                if candidate["id"] not in known:
                    known.add(candidate["id"])
                    result.data["candidates"].append(candidate)
                    if candidate["price_vnd"] is not None:
                        result.quotes.append(
                            Quote(
                                option_id=candidate["id"],
                                label=candidate["title"],
                                amount_vnd=candidate["price_vnd"],
                                recurrence="monthly",
                            )
                        )
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
