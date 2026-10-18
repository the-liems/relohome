"""Chat API gọi graph agent (agent-graph.md §9).

Xác thực người dùng là việc của hạ tầng; ở đây `X-User-Id` là định danh đã được gateway xác thực.
Approval và dữ liệu cá nhân do backend tạo; client không bao giờ tự gửi `approval_id` hay `pii_ref`.
"""

from __future__ import annotations

import asyncio
import logging
import secrets
import uuid
from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from langchain_core.messages import HumanMessage
from langgraph.types import Command
from relohome_agent.agents.common import utcnow
from relohome_agent.agents.graph import run_config
from relohome_agent.agents.progress import plan_progress
from relohome_agent.agents.selections import selected_option, selection_is_current
from relohome_agent.agents.wiring import AgentService
from relohome_agent.api.guest_claim import GuestClaim
from relohome_agent.api.guest_claim import claim as claim_guest_thread
from relohome_agent.guest_access import allowed as guest_route_allowed
from relohome_agent.guest_access import is_guest, require_account
from relohome_contracts.schemas import ChatRequest, ChatResponse, DecisionRequest, SimulatePaymentRequest
from relohome_privacy import redact_pii

logger = logging.getLogger(__name__)
# Optional so fake mode and allowed guest routes still pass without a token.
bearer = HTTPBearer(auto_error=False)


async def authenticate(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    x_user_id: str | None = Header(default=None),
):
    service = getattr(request.app.state, "agent_service", None)
    if x_user_id and x_user_id.startswith("guest_") and not is_guest(x_user_id):
        raise HTTPException(401, "Invalid gateway guest identity")
    if service and (service.mode == "live" or is_guest(x_user_id)):
        expected = service.settings.agent_api_token.get_secret_value() if service.settings else ""
        if not expected:
            logger.error("Request failed: missing_agent_api_token")
            raise HTTPException(503, "Configure AGENT_API_TOKEN for trusted local frontend/gateway.")
        if not credentials or not secrets.compare_digest(credentials.credentials, expected):
            raise HTTPException(401, "Authentication required")
        if not x_user_id or x_user_id == "anonymous":
            raise HTTPException(401, "A gateway-verified X-User-Id is required")
    if is_guest(x_user_id) and not guest_route_allowed(request.url.path, request.method):
        require_account(x_user_id)


router = APIRouter(dependencies=[Depends(authenticate)])


def get_service(request: Request) -> AgentService:
    service = getattr(request.app.state, "agent_service", None)
    if service is None:
        logger.error("Request failed: agent_runtime_not_started")
        raise HTTPException(503, "Agent runtime has not started")
    return service


UserId = Annotated[str, Header(alias="X-User-Id", min_length=1, max_length=128)]
Service = Annotated[AgentService, Depends(get_service)]


@router.post("/chat/guest-claim")
async def guest_claim(body: GuestClaim, service: Service, user_id: UserId):
    return await claim_guest_thread(body, service, user_id)


@router.get("/map/search")
async def search_map(service: Service, text: str = Query(min_length=2, max_length=200)):
    """Shared read-only place picker; never guesses or approves a Moving pin."""
    from relohome_agent.agents.models import AgentName
    from relohome_agent.services.adapters.mcp import ToolCallError

    if len(text.strip()) < 2:
        raise HTTPException(422, "Nhập ít nhất hai ký tự tên địa điểm.")
    agent = service.deps.agents.get(AgentName.MAP)
    client = getattr(agent, "client", None)
    if client is None:
        raise HTTPException(503, "Location service chưa được kết nối.")
    try:
        return await client.call("resolve_location", {"text": text.strip(), "limit": 8})
    except ToolCallError:
        raise HTTPException(502, "Không truy vấn được bản đồ; vui lòng thử lại sau.") from None


class ThreadBusy(HTTPException):
    def __init__(self):
        super().__init__(status_code=409, detail="Thread đang xử lý một lượt khác; thử lại sau.")


def _lock(service: AgentService, thread_id: str) -> asyncio.Lock:
    lock = service.locks.setdefault(thread_id, asyncio.Lock())
    if lock.locked():
        raise ThreadBusy()
    return lock


async def _pending(service: AgentService, thread_id: str) -> tuple[dict, dict | None]:
    snapshot = await service.graph.aget_state(run_config(thread_id, service.deps))
    interrupts = [i.value for task in snapshot.tasks for i in task.interrupts]
    return snapshot.values or {}, (interrupts[0] if interrupts else None)


def _payment_response(thread_id: str, payment: dict, service: AgentService) -> ChatResponse:
    # UI hiện nút "giả lập đã thanh toán" khi `simulation_available` (chỉ demo với cổng mock).
    return ChatResponse(
        status="pending_payment",
        thread_id=thread_id,
        payment={**payment, "simulation_available": service.payment_simulation},
    )


def _to_response(thread_id: str, result: dict, service: AgentService) -> ChatResponse:
    interrupts = result.get("__interrupt__") or []
    if interrupts:
        value = interrupts[0].value
        if value.get("type") == "payment_required":
            return _payment_response(thread_id, value, service)
        return ChatResponse(status="pending_confirmation", thread_id=thread_id, confirmation=value)
    response = result.get("response")
    return ChatResponse(
        status="done", thread_id=thread_id, response=response.model_dump(mode="json") if response else None
    )


async def _owned(service: AgentService, thread_id: str, user_id: str) -> tuple[dict, dict | None]:
    values, pending = await _pending(service, thread_id)
    if not values or values.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail="Không tìm thấy hội thoại.")
    return values, pending


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest, service: Service, user_id: UserId = "anonymous") -> ChatResponse:
    """Gửi một tin nhắn. Thread đang chờ xác nhận thì tin nhắn được coi là đổi ý."""
    thread_id = request.thread_id or f"th_{uuid.uuid4().hex}"
    async with _lock(service, thread_id):
        config = run_config(thread_id, service.deps)
        values, pending = await _pending(service, thread_id)
        if values and values.get("user_id") != user_id:
            raise HTTPException(status_code=404, detail="Không tìm thấy hội thoại.")
        if pending and pending.get("type") == "payment_required":
            return _payment_response(thread_id, pending, service)
        if pending:
            if request.moving_locations or request.moving_options or request.housing_location or request.place_choice:
                raise HTTPException(409, "Change the pending proposal first, then submit confirmed locations.")
            result = await service.graph.ainvoke(
                Command(
                    update={"request_id": uuid.uuid4().hex},
                    resume={
                        "kind": "CHANGE",
                        "plan_version": pending["plan_version"],
                        "change_request": redact_pii(request.message),
                    },
                ),
                config,
            )
        else:
            result = await service.graph.ainvoke(
                {
                    "messages": [HumanMessage(redact_pii(request.message))],
                    "moving_quote_context": None,  # A new chat cannot replay an unfinished form branch.
                    "user_id": user_id,
                    "thread_id": thread_id,
                    "request_id": uuid.uuid4().hex,
                    "housing_location": request.housing_location.model_dump(mode="json")
                    if request.housing_location
                    else None,
                    "moving_locations": request.moving_locations.model_dump(mode="json", exclude_none=True)
                    if request.moving_locations
                    else None,
                    "map_view": request.map_view.model_dump(mode="json") if request.map_view else None,
                    "moving_options": request.moving_options.model_dump(mode="json", exclude_none=True)
                    if request.moving_options is not None
                    else None,
                    "place_choice": await _verified_place(service, request.place_choice)
                    if request.place_choice
                    else None,
                },
                config,
            )
        return _to_response(thread_id, result, service)


async def _verified_place(service: AgentService, choice) -> dict:
    """Re-read a chosen place from Location; the client only supplies its ID."""
    from relohome_agent.agents.models import AgentName
    from relohome_agent.services.adapters.mcp import ToolCallError

    agent = service.deps.agents.get(AgentName.MAP) or service.deps.agents.get(AgentName.PROPERTY)
    client = getattr(agent, "client", None)
    if client is None:
        raise HTTPException(503, "Location service chưa được kết nối.")
    try:
        place = await client.call("get_place", {"place_id": choice.place_id})
    except ToolCallError as exc:
        if exc.transport or exc.retryable:
            raise HTTPException(502, "Không đọc được địa điểm đã chọn; vui lòng thử lại.") from None
        raise HTTPException(422, "Địa điểm đã chọn không hợp lệ hoặc không còn khả dụng.") from None
    location = (place or {}).get("location") or {}
    if (place or {}).get("place_id") != choice.place_id or location.get("lat") is None:
        raise HTTPException(422, "Địa điểm đã chọn không còn khả dụng.")
    return {
        "field": choice.field,
        "place_id": choice.place_id,
        "name": place.get("name") or choice.place_id,
        "lat": location["lat"],
        "lng": location["lng"],
    }


@router.post("/chat/{thread_id}/decision", response_model=ChatResponse)
async def decision(
    thread_id: str, body: DecisionRequest, service: Service, user_id: UserId = "anonymous"
) -> ChatResponse:
    """Xác nhận / đổi / từ chối / huỷ phương án đang chờ."""
    async with _lock(service, thread_id):
        _, pending = await _owned(service, thread_id, user_id)
        if not pending or pending.get("type") != "confirmation_required":
            raise HTTPException(status_code=409, detail="Không có phương án nào đang chờ xác nhận.")
        resume: dict = body.model_dump(exclude={"pii_forms", "payload_hash"})
        if resume.get("change_request"):
            resume["change_request"] = redact_pii(resume["change_request"])
        if body.kind == "CONFIRM":
            if service.mode == "live" and not service.writes_enabled:
                raise HTTPException(403, "Booking/cancellation writes are disabled; quote and search remain available.")
            if body.payload_hash != pending["payload_hash"] or body.plan_version != pending["plan_version"]:
                raise HTTPException(status_code=409, detail="Phương án đã thay đổi; hãy xem lại trước khi xác nhận.")
            pii_refs = {}
            from pydantic import ValidationError
            from relohome_contracts.schemas import MovingContact, MovingOrderUpdate

            for action_id, required in pending.get("pii_required", {}).items():
                form = body.pii_forms.get(action_id, {})
                try:
                    for key in required:
                        if key not in form:
                            raise ValueError("Missing required form")
                        if key in {"pickup_contact", "destination_contact"}:
                            MovingContact.model_validate(form[key])
                        elif key == "order_update":
                            MovingOrderUpdate.model_validate(form[key])
                except (ValueError, ValidationError):
                    # Never echo Pydantic's input value (contacts) in an HTTP error.
                    raise HTTPException(422, "Thiếu hoặc sai thông tin liên hệ/cập nhật trong form.") from None
            for action_id, form in body.pii_forms.items():
                if action_id in pending.get("pii_required", {}):
                    pii_refs[action_id] = await service.pii_store.put(form)
            expires_at = min(
                utcnow() + service.deps.settings.approval_ttl, utcnow().fromisoformat(pending["expires_at"])
            )
            if expires_at <= utcnow():
                raise HTTPException(status_code=409, detail="Báo giá đã hết hạn; hãy tìm lại.")
            approval = await service.approval_store.create(
                user_id=user_id,
                thread_id=thread_id,
                plan_version=pending["plan_version"],
                payload_hash=pending["payload_hash"],
                expires_at=min(expires_at, utcnow() + timedelta(minutes=30)),
                pii_refs=pii_refs,
            )
            resume.update(approval_id=approval.approval_id, pii_refs=pii_refs)
        result = await service.graph.ainvoke(Command(update={"request_id": uuid.uuid4().hex}, resume=resume), run_config(thread_id, service.deps)
        )
        return _to_response(thread_id, result, service)


async def _payment(thread_id: str, action: str, service: AgentService, user_id: str) -> ChatResponse:
    async with _lock(service, thread_id):
        _, pending = await _owned(service, thread_id, user_id)
        if not pending or pending.get("type") != "payment_required":
            raise HTTPException(status_code=409, detail="Không có thanh toán nào đang chờ.")
        result = await service.graph.ainvoke(Command(resume={"action": action}), run_config(thread_id, service.deps))
        return _to_response(thread_id, result, service)


@router.post("/chat/{thread_id}/payment/check", response_model=ChatResponse)
async def payment_check(thread_id: str, service: Service, user_id: UserId = "anonymous") -> ChatResponse:
    """Hỏi lại cổng thanh toán (người dùng bấm "Tôi đã thanh toán" hoặc UI hỏi định kỳ)."""
    return await _payment(thread_id, "check", service, user_id)


@router.post("/chat/{thread_id}/payment/cancel", response_model=ChatResponse)
async def payment_cancel(thread_id: str, service: Service, user_id: UserId = "anonymous") -> ChatResponse:
    """Huỷ thanh toán đang chờ; `transaction` huỷ phần giữ chỗ."""
    return await _payment(thread_id, "cancel", service, user_id)


@router.post("/chat/{thread_id}/payment/simulate", response_model=ChatResponse)
async def payment_simulate(
    thread_id: str, body: SimulatePaymentRequest, service: Service, user_id: UserId = "anonymous"
) -> ChatResponse:
    """CHỈ CHO DEMO với cổng thanh toán mock: giả lập khách đã trả / thất bại / link hết hạn, rồi hỏi lại
    cổng như nút "Tôi đã thanh toán". Tắt ở môi trường thật (`PAYMENT_SIMULATION_ENABLED=false`)."""
    if not service.payment_simulation:
        raise HTTPException(status_code=404, detail="Giả lập thanh toán không được bật.")
    async with _lock(service, thread_id):
        values, pending = await _owned(service, thread_id, user_id)
        payment = values.get("pending_payment")
        if not pending or pending.get("type") != "payment_required" or payment is None:
            raise HTTPException(status_code=409, detail="Không có thanh toán nào đang chờ.")
        try:
            await service.deps.transaction.simulate_payment(payment.payment_ref, body.outcome)
        except Exception as exc:  # cổng không phải mock, giao dịch đã hết PENDING…
            raise HTTPException(status_code=409, detail="Không giả lập được thanh toán này.") from exc
        result = await service.graph.ainvoke(Command(resume={"action": "check"}), run_config(thread_id, service.deps))
        return _to_response(thread_id, result, service)


@router.get("/chat/{thread_id}/state")
async def thread_state(thread_id: str, service: Service, user_id: UserId = "anonymous") -> dict:
    values, pending = await _owned(service, thread_id, user_id)
    plan = values.get("plan")
    return {
        "thread_id": thread_id,
        "intake": values["intake"].model_dump(mode="json") if values.get("intake") else None,
        "plan": plan.model_dump(mode="json") if plan else None,
        "task_status": {k: str(v) for k, v in (values.get("task_status") or {}).items()},
        "cost_summary": values["cost_summary"].model_dump(mode="json") if values.get("cost_summary") else None,
        "committed": {k: r.model_dump(mode="json") for k, r in (values.get("committed") or {}).items()},
        "pending": pending,
        "selections": _selections(values),
        "progress": plan_progress(values),
        **({"auth_required": values.get("auth_required") or []} if is_guest(user_id) else {}),
        "checkout": service.checkout.thread_view(user_id, thread_id, values) if service.checkout else None,
        "viewing": service.viewing.thread_view(user_id, thread_id, values) if service.viewing else None,
    }


def _selections(values: dict) -> dict:
    """Option the user chose per domain, read from provider results in graph state (never from the client).

    A home chosen on the map workspace is only in state, not in any chat message; the UI needs its
    address and coordinate to prefill the moving destination."""
    intake = values.get("intake")
    facts = intake.user_confirmed_facts if intake else {}
    results = values.get("task_results") or {}
    out: dict[str, dict] = {}
    for task_id, option_id in (values.get("goal_selections") or {}).items():
        result = results.get(task_id)
        if not selection_is_current(values, task_id, option_id):
            continue
        match = selected_option(result, option_id)
        if match:
            out[result.agent.value] = match
    plan = values.get("plan")
    current_task_ids = {task.id for task in plan.tasks} if plan else set()
    for key, fact in facts.items():
        if not key.startswith("selected:"):
            continue
        domain = key.split(":", 1)[1]
        for task_id, result in results.items():
            if (
                task_id not in current_task_ids
                or result.agent.value != domain
                or not selection_is_current(values, task_id, str(fact.value))
            ):
                continue
            match = selected_option(result, str(fact.value))
            if match:
                out[domain] = match
                break
    return out


@router.delete("/chat/{thread_id}")
async def delete_thread(thread_id: str, service: Service, user_id: UserId = "anonymous") -> dict:
    """Xoá hội thoại: checkpoint của graph và bộ nhớ có nguồn từ hội thoại này.

    Không huỷ đơn đã đặt; biên nhận và approval vẫn nằm trong kho bền vững của backend.
    Thanh toán đang chờ phải được huỷ hoặc hoàn tất trước để không bỏ lại phần giữ chỗ."""
    async with _lock(service, thread_id):
        values, pending = await _pending(service, thread_id)
        if not values:
            return {"thread_id": thread_id, "deleted": False}
        if values.get("user_id") != user_id:
            raise HTTPException(status_code=404, detail="Không tìm thấy hội thoại.")
        if pending and pending.get("type") == "payment_required":
            raise HTTPException(
                status_code=409,
                detail="Hội thoại đang có thanh toán chờ xử lý. Hãy hủy hoặc hoàn tất thanh toán trước khi xóa.",
            )
        if service.checkout is not None and service.checkout.has_open_attempt(user_id, thread_id):
            raise HTTPException(
                status_code=409,
                detail="Hội thoại có lần thanh toán đang chờ hoặc đang đối soát. Hãy hoàn tất trước khi xóa.",
            )
        await service.graph.checkpointer.adelete_thread(thread_id)
        await service.deps.session.forget_thread(user_id, thread_id)
        if service.viewing is not None:
            service.viewing.delete_thread(user_id, thread_id)
    service.locks.pop(thread_id, None)
    return {"thread_id": thread_id, "deleted": True}


@router.delete("/memory")
async def forget_memory(service: Service, user_id: UserId = "anonymous") -> dict:
    """Quên toàn bộ sở thích/thói quen agent đã ghi nhớ về người dùng (làm mới SIU)."""
    await service.deps.session.forget(user_id)
    return {"forgotten": True}


@router.get("/status")
async def agent_status(service: Service):
    """Trạng thái agent và các lĩnh vực đã đăng ký."""
    return {
        "status": "ready",
        "agent": "LifeFlow agent graph",
        "mode": service.mode,
        "app_payment": service.checkout is not None,
        "housing_viewing": service.viewing is not None,
        "domains": [d.value for d in service.deps.agents.names()],
        "domain_agents": {
            d.value: {
                "implementation": type(service.deps.agents.get(d)).__name__,
                "uses_llm": service.deps.agents.capability(d).uses_llm,
                "read_only": True,
            }
            for d in service.deps.agents.names()
        },
        "writes_enabled": service.writes_enabled,
        "sandbox_payments_enabled": service.sandbox_payment_client is not None,
        "moving_payment_method": "CASH",
        "flight_booking_enabled": False,
        "simulated_transactions": False,
    }
