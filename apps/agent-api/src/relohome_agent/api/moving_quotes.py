"""Typed Moving quote actions integrated with the existing graph; never commits."""

from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from langchain_core.messages import HumanMessage
from langfuse import propagate_attributes
from relohome_agent.agents.context import GraphContext
from relohome_agent.agents.cost import paid_slots_left
from relohome_agent.agents.graph import run_config
from relohome_agent.agents.models import (
    AgentName,
    ConfirmedFact,
    IntakeResult,
    Intent,
    RequestKind,
    SessionContext,
    TaskStatus,
    active_commits,
)
from relohome_agent.agents.nodes.change_impact import downstream_closure
from relohome_agent.agents.planning import plan_confirmed_moving_quote, validate_plan
from relohome_agent.agents.subagents.services.moving import order_time
from relohome_agent.api.routes import Service, UserId, _lock, _pending, _to_response, authenticate
from relohome_contracts.schemas import MovingQuoteForm
from relohome_privacy import redact_pii

router = APIRouter(prefix="/ui", dependencies=[Depends(authenticate)])


@router.post("/chat/{thread_id}/moving/quote")
async def quote_form(thread_id: str, body: MovingQuoteForm, service: Service, user_id: UserId = "anonymous"):
    async with _lock(service, thread_id):
        state, pending = await _pending(service, thread_id)
        if state and state.get("user_id") != user_id:
            raise HTTPException(404, "Không tìm thấy hội thoại.")
        if pending:
            raise HTTPException(409, "Hãy đổi hoặc hủy phương án đang chờ xác nhận trước khi lấy báo giá mới.")
        if state.get("pending_payment") and state["pending_payment"].status == "PENDING":
            raise HTTPException(409, "Hãy hoàn tất hoặc hủy luồng thanh toán đang chờ trước khi đổi báo giá.")
        previous = state.get("plan")
        if body.plan_version != (previous.version if previous else 0):
            raise HTTPException(409, "Kế hoạch đã thay đổi. Tải lại thông tin trước khi lấy báo giá.")
        committed = active_commits(state.get("committed"))
        if state.get("transaction") and state["transaction"].status == "pending_verification":
            raise HTTPException(409, "Chưa rõ kết quả đặt đơn. Cần đối soát trước khi lấy báo giá thay thế.")
        for receipt in committed.values():
            if receipt.kind.value == "moving_booking":
                raise HTTPException(409, "Đã có đơn chuyển đồ. Hãy kiểm tra hoặc đổi đơn bằng luồng riêng.")
        agent = service.deps.moving_quote_agent
        if agent is None:
            raise HTTPException(503, "Dịch vụ báo giá form chưa được kết nối.")
        now = service.deps.clock()
        if order_time(body.move_date.isoformat(), body.move_time, now) is None:
            raise HTTPException(422, "Ngày giờ chuyển phải hợp lệ và cách hiện tại ít nhất 30 phút.")
        request_id = uuid4().hex
        turn = await service.deps.usage.counts(thread_id, request_id)
        whole = await service.deps.usage.counts(thread_id)
        if paid_slots_left(turn, whole, service.deps.settings) < 1:
            raise HTTPException(429, "Hội thoại đã đạt giới hạn gọi dịch vụ. Không gửi lại liên tục.")
        selected_house = (
            state.get("intake").user_confirmed_facts.get("selected:property") if state.get("intake") else None
        )
        if body.destination_listing_id and (
            selected_house is None or selected_house.value != body.destination_listing_id
        ):
            raise HTTPException(409, "Căn đã chọn thay đổi. Kiểm tra lại điểm giao trên form.")
        options = body.moving_options.model_dump(mode="json", exclude_none=True, exclude_defaults=True)
        inputs = {
            "mode": "quote",
            "from_address": body.pickup.address,
            "to_address": body.destination.address,
            "pickup_coordinate": {"lat": body.pickup.lat, "lng": body.pickup.lng},
            "destination_coordinate": {"lat": body.destination.lat, "lng": body.destination.lng},
            "move_date": body.move_date.isoformat(),
            "move_time": body.move_time,
            "moving_options": options,
        }
        if body.destination_listing_id:
            inputs["selected_listing_id"] = body.destination_listing_id
        text = redact_pii(
            f"Báo giá chuyển đồ từ {body.pickup.address} đến {body.destination.address} "
            f"ngày {body.move_date.isoformat()} lúc {body.move_time}. Chưa đặt đơn."
        )
        intake = (
            state["intake"].model_copy(deep=True) if state.get("intake") else IntakeResult(kind=RequestKind.NEW_GOAL)
        )
        intake.kind = RequestKind.REFINE if state.get("intake") else RequestKind.NEW_GOAL
        intake.normalized_goal = text
        intake.intent = Intent(
            name="moving_quote_form", domains=[AgentName.RELOCATION], summary="Báo giá từ form đã xác nhận"
        )
        intake.blocking_missing, intake.conflicts, intake.commit_requested = [], [], []
        intake.unavailable_commit_requested, intake.target_task_ids = [], []
        intake.change_request, intake.unsupported_reason = None, None
        for key in list(intake.user_confirmed_facts):
            if key.startswith("commit:"):
                intake.user_confirmed_facts.pop(key)
        if not body.destination_listing_id:
            intake.constraints.values.pop("selected_listing_id", None)
            intake.user_confirmed_facts.pop("selected_listing_id", None)
        for key, value in inputs.items():
            if key != "mode":
                intake.constraints.values[key] = value
                intake.user_confirmed_facts[key] = ConfirmedFact(value=value, evidence=text, stated_at=now)
        intake.constraints.values["moving_mode"] = "quote"
        intake.constraints.missing = []
        try:
            plan, task = plan_confirmed_moving_quote(previous, inputs)
        except ValueError:
            raise HTTPException(409, "Có nhiều task chuyển đồ. Hãy chọn task cần đổi trong hội thoại.") from None
        affected = downstream_closure(previous, {task.id}) if previous and previous.task(task.id) else {task.id}
        for domain in {t.agent for t in plan.tasks if t.id in affected}:
            intake.user_confirmed_facts.pop("selected:" + domain.value, None)
        if validate_plan(plan, service.deps.agents, intake, committed, previous):
            raise HTTPException(422, "Form không đáp ứng contract báo giá hiện tại.")
        # Preflight above preserves HTTP errors without starting a graph run. The
        # prepared, trusted intent enters only the quote branch, never chat planning.
        with propagate_attributes(session_id=thread_id):
            result = await service.graph.ainvoke(
                {
                    "messages": [HumanMessage(text)],
                    "request_id": request_id,
                    "thread_id": thread_id,
                    "user_id": user_id,
                    "moving_quote_context": {"task_id": task.id},
                    "plan": plan,
                    "intake": intake,
                    "session": state.get("session") or SessionContext(),
                    "validation": None,
                    "outcome": None,
                    "response": None,
                    "cost_summary": None,
                    "auth_required": [],
                    "housing_selection_changed": False,
                    "transaction": None,
                    "user_decision": None,
                    "change_context": None,
                    "planner_questions": [],
                    "dispatch": [],
                    "dispatch_llm_budgets": {},
                    "replan_count": 0,
                    "moving_locations": {
                        "pickup": body.pickup.model_dump(),
                        "destination": body.destination.model_dump(),
                    },
                    "moving_options": options,
                    "task_attempts": {task.id: 1},
                    "task_status": {
                        **{tid: TaskStatus.STALE for tid in affected},
                        task.id: TaskStatus.RUNNING,
                    },
                },
                run_config(thread_id, service.deps),
                context=GraphContext(deps=service.deps),
            )
        return _to_response(thread_id, result, service)
