"""Chọn nhiều căn, hẹn xem và chốt (docs/review/housing-viewing-design.md). Thao tác có kiểu, không gọi LLM."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from langchain_core.messages import HumanMessage
from pydantic import BaseModel, ConfigDict, Field
from relohome_agent.agents.graph import run_config
from relohome_agent.agents.models import AgentName, AgentResponse, TaskStatus
from relohome_agent.agents.nodes.change_impact import selection_impact
from relohome_agent.agents.nodes.cost_summary import make_cost_summary
from relohome_agent.api.routes import Service, UserId, _lock, _owned, _to_response, authenticate
from relohome_agent.checkout.models import CheckoutError

router = APIRouter(prefix="/ui", dependencies=[Depends(authenticate)])


class ListingBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    listing_id: str = Field(min_length=1, max_length=128)


class ScheduleBody(ListingBody):
    slot: str = Field(min_length=10, max_length=40)


class VisitReview(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rating: int = Field(ge=1, le=5)
    body: str = Field(default="", max_length=2000)


class VisitBody(ListingBody):
    outcome: Literal["met_agreed", "met_undecided", "met_rejected", "missed"]
    review: VisitReview | None = None


class DecideBody(ListingBody):
    rent_vnd: int = Field(ge=1, le=10_000_000_000)
    deposit_vnd: int = Field(ge=1, le=10_000_000_000)
    move_in: date | None = None
    keep_listing_ids: list[str] = Field(default_factory=list, max_length=20)
    decision_key: str = Field(min_length=16, max_length=80)
    acknowledge_paid_moving: bool = False


class PaidBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    amount_vnd: int = Field(ge=1, le=10_000_000_000)
    paid_on: date
    request_id: str | None = Field(default=None, min_length=8, max_length=160)


class ReopenBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rejected_report_key: str | None = Field(default=None, min_length=8, max_length=160)


class MovingModeBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["wait_for_home"] | None


def viewing_of(service):
    if getattr(service, "viewing", None) is None:
        raise HTTPException(404, "Chọn nhiều căn để hẹn xem chưa được bật trên máy chủ này.")
    return service.viewing


async def _values(service, thread_id: str, user_id: str) -> dict:
    values, pending = await _owned(service, thread_id, user_id)
    if pending:
        raise HTTPException(409, "Hãy xử lý phương án đang chờ xác nhận trước.")
    return values


async def _sync(service, thread_id: str, user_id: str, update: dict | None = None) -> None:
    """Cập nhật danh sách căn cho agent (chỉ ID/nhãn) cùng phần cập nhật khác trong một lần ghi."""
    update = dict(update or {})
    update["housing_selection"] = service.viewing.projection(user_id, thread_id)
    await service.graph.aupdate_state(run_config(thread_id, service.deps), update, as_node="respond")


async def select_for_viewing(service, thread_id: str, user_id: str, state: dict, task_id: str, chosen: dict, update):
    """Gọi từ `choose_result` (đang giữ khóa hội thoại): thêm căn vào tập chọn, không đổi căn của kế hoạch."""
    viewing = service.viewing
    try:
        viewing.select(user_id, thread_id, task_id, chosen)
    except CheckoutError as exc:
        raise HTTPException(exc.status, exc.message) from None
    count = len(viewing.active(user_id, thread_id))
    label = chosen.get("title") or "căn nhà"
    response = AgentResponse(
        kind="ANSWER",
        text=(
            f"Đã chọn {label} để hẹn xem ({count}/{viewing.settings.max_selected} căn). "
            "Đây chưa phải căn của kế hoạch: hẹn lịch xem trong Kế hoạch → Xem nhà, gặp chủ nhà rồi chốt."
        ),
    )
    update = {
        **update,
        "messages": [HumanMessage(f"Tôi chọn {label} (ID: {chosen['id']}) để hẹn xem.")],
        "response": response,
    }
    await _sync(service, thread_id, user_id, update)
    return _to_response(thread_id, {"response": response}, service)


@router.get("/chat/{thread_id}/viewings")
async def viewings(thread_id: str, service: Service, user_id: UserId = "anonymous"):
    viewing = viewing_of(service)
    values, _ = await _owned(service, thread_id, user_id)
    return viewing.thread_view(user_id, thread_id, values)


@router.get("/viewings/thread")
async def viewing_thread(listing_id: str, service: Service, user_id: UserId = "anonymous"):
    viewing = viewing_of(service)
    row = viewing.store.db.execute(
        "SELECT thread_id FROM checkout_transactions WHERE user_id=? AND logical_key=? AND superseded=0 ORDER BY rowid DESC LIMIT 1",
        (user_id, "housing:" + listing_id),
    ).fetchone()
    if row:
        await _owned(service, row[0], user_id)
    return {"thread_id": row[0] if row else None}


@router.get("/viewings/slots")
async def viewing_options(service: Service):
    viewing = viewing_of(service)
    days = viewing.settings.proposal_days
    end = viewing.clock() + timedelta(days=days)
    return {"slots": [slot for slot in viewing.slots() if datetime.fromisoformat(slot) <= end], "days": days}


async def _store_action(service, thread_id: str, user_id: str, action, *, sync: bool = False):
    viewing = viewing_of(service)
    async with _lock(service, thread_id):
        values = await _values(service, thread_id, user_id)
        await action(viewing)
        if sync:
            await _sync(service, thread_id, user_id)
        return viewing.thread_view(user_id, thread_id, values)


@router.post("/chat/{thread_id}/viewings/unselect")
async def unselect(thread_id: str, body: ListingBody, service: Service, user_id: UserId = "anonymous"):
    async def act(v):
        v.unselect(user_id, thread_id, body.listing_id)

    return await _store_action(service, thread_id, user_id, act, sync=True)


@router.post("/chat/{thread_id}/viewings/schedule")
async def schedule(thread_id: str, body: ScheduleBody, service: Service, user_id: UserId = "anonymous"):
    async def act(v):
        await v.schedule(user_id, thread_id, body.listing_id, body.slot)

    return await _store_action(service, thread_id, user_id, act)


@router.post("/chat/{thread_id}/viewings/cancel")
async def cancel(thread_id: str, body: ListingBody, service: Service, user_id: UserId = "anonymous"):
    async def act(v):
        v.cancel(user_id, thread_id, body.listing_id)

    return await _store_action(service, thread_id, user_id, act)


@router.post("/chat/{thread_id}/viewings/visit")
async def visit(thread_id: str, body: VisitBody, service: Service, user_id: UserId = "anonymous"):
    async def act(v):
        v.visit(
            user_id, thread_id, body.listing_id, body.outcome, review=body.review.model_dump() if body.review else None
        )

    return await _store_action(service, thread_id, user_id, act, sync=body.outcome == "met_rejected")


@router.post("/chat/{thread_id}/viewings/paid")
async def paid(thread_id: str, body: PaidBody, service: Service, user_id: UserId = "anonymous"):
    async def act(v):
        v.report_paid(user_id, thread_id, body.amount_vnd, body.paid_on.isoformat(), body.request_id)

    return await _store_action(service, thread_id, user_id, act)


@router.post("/chat/{thread_id}/viewings/moving-mode")
async def moving_mode(thread_id: str, body: MovingModeBody, service: Service, user_id: UserId = "anonymous"):
    viewing = viewing_of(service)
    async with _lock(service, thread_id):
        values = await _values(service, thread_id, user_id)
        await service.graph.aupdate_state(
            run_config(thread_id, service.deps), {"moving_destination_mode": body.mode}, as_node="respond"
        )
        return viewing.thread_view(user_id, thread_id, {**values, "moving_destination_mode": body.mode})


def _housing_task(values: dict, preferred: str | None):
    """Task tìm nhà còn hiệu lực để đặt căn của kế hoạch; ưu tiên task đã cho ra căn này."""
    plan = values.get("plan")
    results = values.get("task_results") or {}
    status = values.get("task_status") or {}
    candidates = [
        t.id
        for t in (plan.tasks if plan else [])
        if t.agent == AgentName.PROPERTY
        and status.get(t.id) == TaskStatus.DONE
        and results.get(t.id)
        and results[t.id].status == "done"
        and not results[t.id].data.get("comparison")
    ]
    if preferred in candidates:
        return preferred
    return candidates[-1] if candidates else None


@router.post("/chat/{thread_id}/viewings/decide")
async def decide(thread_id: str, body: DecideBody, service: Service, user_id: UserId = "anonymous"):
    from relohome_agent.api.web_actions import ResultAction, _choose_result_locked, explored_listing

    viewing = viewing_of(service)
    form = {
        "rent_vnd": body.rent_vnd,
        "deposit_vnd": body.deposit_vnd,
        "move_in": body.move_in and body.move_in.isoformat(),
    }
    # Hold the thread across intent, provider read, graph selection, store and projection.
    # Other chat/UI mutations receive ThreadBusy rather than interleave.
    async with _lock(service, thread_id):
        values = await _values(service, thread_id, user_id)
        decision = viewing.begin_decision(
            user_id, thread_id, body.listing_id, body.keep_listing_ids, form, body.decision_key
        )
        impact = "none"
        if decision["step"] == "planned":
            listing = await explored_listing(service, body.listing_id)
            if listing is None:
                raise CheckoutError(409, "Tin nhà không còn khả dụng; không chốt được.", "listing_gone")
            impact = viewing.moving_impact(user_id, thread_id, listing, values)
            if impact == "different_paid" and not body.acknowledge_paid_moving:
                raise CheckoutError(
                    409,
                    "Chuyển đồ đã thanh toán tới địa chỉ khác căn này. Xác nhận giữ nguyên chuyển đồ để chốt.",
                    "moving_paid_elsewhere",
                )
            viewing.validate_decision(decision)
            intake = values.get("intake")
            current = intake.user_confirmed_facts.get("selected:property") if intake else None
            if current is None or str(current.value) != body.listing_id:
                item = viewing.store.current_tx(user_id, thread_id, f"housing:{body.listing_id}")
                task_id = _housing_task(values, item.task_id if item else None)
                if task_id is None:
                    raise CheckoutError(409, "Hãy mở lại kết quả tìm nhà trước khi chốt.", "no_housing_task")
                plan, result = values["plan"], values["task_results"][task_id]
                await _choose_result_locked(
                    thread_id,
                    ResultAction(
                        kind="select",
                        task_id=task_id,
                        plan_version=plan.version,
                        fetched_at=result.fetched_at,
                        entity_id=body.listing_id,
                    ),
                    service,
                    user_id,
                    plan_choice=True,
                )
            viewing.mark_decision(decision, "plan_chosen")
        values = await _values(service, thread_id, user_id)
        intake = values.get("intake")
        current = intake.user_confirmed_facts.get("selected:property") if intake else None
        if current is None or str(current.value) != body.listing_id:
            raise CheckoutError(409, "Căn của kế hoạch đã đổi; không hoàn tất quyết định cũ.", "decision_stale")
        if decision["step"] != "done":
            viewing.finish_decision(decision)
        # Repair the projection even on retry after a durable store commit.
        await _sync(service, thread_id, user_id)
        return {
            **viewing.thread_view(user_id, thread_id, values),
            "decided": body.listing_id,
            "moving_impact": impact,
        }


@router.post("/chat/{thread_id}/viewings/reopen")
async def reopen(thread_id: str, service: Service, body: ReopenBody | None = None, user_id: UserId = "anonymous"):
    """Thỏa thuận không thành: gỡ căn của kế hoạch; chuyển đồ tuần tự quay về chờ chốt (V10)."""
    viewing = viewing_of(service)
    async with _lock(service, thread_id):
        values = await _values(service, thread_id, user_id)
        viewing.reopen(user_id, thread_id, rejected_report_key=body.rejected_report_key if body else None)
        update: dict = {}
        intake = values.get("intake")
        current = intake.user_confirmed_facts.get("selected:property") if intake else None
        plan = values.get("plan")
        if current is not None:
            intake = intake.model_copy(deep=True)
            intake.user_confirmed_facts.pop("selected:property", None)
            results = values.get("task_results") or {}
            housing_tasks = [t.id for t in plan.tasks if t.agent == AgentName.PROPERTY] if plan else []
            affected: set[str] = set()
            for task_id in housing_tasks:
                affected |= selection_impact(plan, task_id, AgentName.PROPERTY, str(current.value)) - {task_id}
            selections = {
                k: v
                for k, v in (values.get("goal_selections") or {}).items()
                if not (results.get(k) and results[k].agent == AgentName.PROPERTY)
            }
            update = {
                "intake": intake,
                "goal_selections": selections,
                "task_status": {tid: TaskStatus.STALE for tid in affected},
            }
            merged = {
                **values,
                **update,
                "task_status": {**values.get("task_status", {}), **update["task_status"]},
            }
            summary = await make_cost_summary(service.deps)(merged)
            update["cost_summary"] = summary["cost_summary"]
        await _sync(service, thread_id, user_id, update)
        values = {**values, **update}
        return viewing.thread_view(user_id, thread_id, values)
