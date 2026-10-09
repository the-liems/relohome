"""Typed Moving quote actions integrated with the existing graph; never commits."""

from dataclasses import replace
from datetime import datetime
from time import perf_counter
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from langchain_core.messages import HumanMessage

from src.agents.cost import paid_slots_left, subagent_llm_calls_left
from src.agents.deps import AgentRegistry
from src.agents.graph import make_agent_node, run_config
from src.agents.intake import redact_pii
from src.agents.models import (
    AgentName,
    ConfirmedFact,
    IntakeResult,
    Intent,
    Outcome,
    OutcomeCode,
    RequestKind,
    SessionContext,
    TaskStatus,
    ValidationIssue,
    ValidationReport,
    active_commits,
)
from src.agents.nodes.change_impact import downstream_closure
from src.agents.nodes.cost_summary import make_cost_summary
from src.agents.nodes.respond import make_respond
from src.agents.nodes.validator import DEFAULT_RULES, check_task
from src.agents.planning import plan_confirmed_moving_quote, validate_plan
from src.agents.subagents.services.moving import order_time
from src.api.routes import Service, UserId, _lock, _pending, _to_response, authenticate
from src.models.schemas import MovingQuoteForm

router = APIRouter(prefix="/ui", dependencies=[Depends(authenticate)])


class FormQuoteAgent:
    """Invocation-local adapter; never mutates the shared domain agent/registry."""

    def __init__(self, agent):
        self.agent, self.capability = agent, agent.capability

    async def run(self, request):
        return await self.agent.run_form_quote(request)


@router.post("/chat/{thread_id}/moving/quote")
async def quote_form(thread_id: str, body: MovingQuoteForm, service: Service, user_id: UserId = "anonymous"):
    started = perf_counter()
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
        agent = service.deps.agents.get(AgentName.RELOCATION)
        if agent is None or not hasattr(agent, "run_form_quote"):
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
        deps = replace(
            service.deps,
            agents=AgentRegistry(
                {
                    name: FormQuoteAgent(agent) if name == AgentName.RELOCATION else service.deps.agents.get(name)
                    for name in service.deps.agents.names()
                }
            ),
        )
        update = await make_agent_node(deps, AgentName.RELOCATION)(
            {
                "task": task,
                "allocated_llm_calls": subagent_llm_calls_left(turn, deps.settings),
                "user_id": user_id,
                "plan_version": plan.version,
                "attempt": 1,
                "request_id": request_id,
                "thread_id": thread_id,
                "constraints": intake.constraints,
                "goal": "Báo giá Moving từ form đã xác nhận",
                "user_request": text,
                "hints": {},
                "upstream": {},
            }
        )
        result = update["task_results"][task.id]
        if result.status == "done":
            findings = check_task(task.id, result, agent.capability, agent.capability.stale_ttl_s, [], deps.clock())
            try:
                expiry = datetime.fromisoformat(result.data.get("expires_at", ""))
                fresh = expiry.tzinfo is not None and expiry > deps.clock()
            except (ValueError, TypeError):
                fresh = False
            if findings or not fresh:
                result.status, result.error_code = "failed", "internal"
                result.error = "Báo giá thiếu dữ kiện hợp lệ hoặc đã hết hạn; chưa đặt đơn."
                update["task_status"][task.id] = TaskStatus.FAILED
        code = {"done": OutcomeCode.ANSWER, "needs_input": OutcomeCode.ASK_USER, "failed": OutcomeCode.ERROR}[
            result.status
        ]
        update.update(
            {
                "request_id": request_id,
                "thread_id": thread_id,
                "user_id": user_id,
                "plan": plan,
                "intake": intake,
                "session": state.get("session") or SessionContext(),
                "validation": (
                    ValidationReport(verdict="NEED_MORE", action="ASK_USER", questions=result.questions)
                    if result.status == "needs_input"
                    else None
                ),
                "transaction": None,
                "user_decision": None,
                "change_context": None,
                "planner_questions": [],
                "dispatch": [],
                "replan_count": 0,
                "moving_locations": {"pickup": body.pickup.model_dump(), "destination": body.destination.model_dump()},
                "moving_options": options,
                "task_attempts": {task.id: 1},
                "outcome": Outcome(node="moving_form", code=code),
            }
        )
        update["task_status"] = {**{tid: TaskStatus.STALE for tid in affected}, **update["task_status"]}
        merged = {
            **state,
            **update,
            "task_results": {**state.get("task_results", {}), **update["task_results"]},
            "task_status": {**state.get("task_status", {}), **update["task_status"]},
        }
        if result.status == "done":
            current_results = {
                tid: item
                for tid, item in merged["task_results"].items()
                if merged["task_status"].get(tid) == TaskStatus.DONE
            }
            conflicts = [
                ValidationIssue(code="V5", message=message)
                for rule in DEFAULT_RULES
                for message in rule(plan, current_results, intake)
            ]
            if conflicts:
                update["validation"] = ValidationReport(verdict="NEED_MORE", action="ASK_USER", issues=conflicts)
                update["outcome"] = Outcome(node="moving_form", code=OutcomeCode.ASK_USER)
                merged.update(validation=update["validation"], outcome=update["outcome"])
        update["cost_summary"] = (await make_cost_summary(deps)(merged))["cost_summary"]
        merged["cost_summary"] = update["cost_summary"]
        response_update = await make_respond(deps)(merged)
        update.update(response_update)
        update["messages"] = [HumanMessage(text), *response_update["messages"]]
        result.data["form_elapsed_ms"] = round((perf_counter() - started) * 1000)
        await service.graph.aupdate_state(run_config(thread_id, deps), update, as_node="respond")
        return _to_response(thread_id, {"response": update["response"]}, service)
