"""Chat API gọi graph agent (agent-graph.md §9).

Xác thực người dùng là việc của hạ tầng; ở đây `X-User-Id` là định danh đã được gateway xác thực.
Approval và dữ liệu cá nhân do backend tạo; client không bao giờ tự gửi `approval_id` hay `pii_ref`.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from langchain_core.messages import HumanMessage
from langgraph.types import Command

from src.agents.common import utcnow
from src.agents.graph import run_config
from src.agents.wiring import AgentService
from src.models.schemas import ChatRequest, ChatResponse, DecisionRequest

router = APIRouter()


def get_service(request: Request) -> AgentService:
    service = getattr(request.app.state, "agent_service", None)
    if service is None:
        service = AgentService.create()
        request.app.state.agent_service = service
    return service


UserId = Annotated[str, Header(alias="X-User-Id", min_length=1, max_length=128)]
Service = Annotated[AgentService, Depends(get_service)]


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


def _to_response(thread_id: str, result: dict) -> ChatResponse:
    interrupts = result.get("__interrupt__") or []
    if interrupts:
        value = interrupts[0].value
        if value.get("type") == "payment_required":
            return ChatResponse(status="pending_payment", thread_id=thread_id, payment=value)
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
            return ChatResponse(status="pending_payment", thread_id=thread_id, payment=pending)
        if pending:
            result = await service.graph.ainvoke(
                Command(
                    resume={
                        "kind": "CHANGE",
                        "plan_version": pending["plan_version"],
                        "change_request": request.message,
                    }
                ),
                config,
            )
        else:
            result = await service.graph.ainvoke(
                {
                    "messages": [HumanMessage(request.message)],
                    "user_id": user_id,
                    "thread_id": thread_id,
                    "request_id": uuid.uuid4().hex,
                },
                config,
            )
        return _to_response(thread_id, result)


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
        if body.kind == "CONFIRM":
            if body.payload_hash != pending["payload_hash"] or body.plan_version != pending["plan_version"]:
                raise HTTPException(status_code=409, detail="Phương án đã thay đổi; hãy xem lại trước khi xác nhận.")
            pii_refs = {}
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
        result = await service.graph.ainvoke(Command(resume=resume), run_config(thread_id, service.deps))
        return _to_response(thread_id, result)


async def _payment(thread_id: str, action: str, service: AgentService, user_id: str) -> ChatResponse:
    async with _lock(service, thread_id):
        _, pending = await _owned(service, thread_id, user_id)
        if not pending or pending.get("type") != "payment_required":
            raise HTTPException(status_code=409, detail="Không có thanh toán nào đang chờ.")
        result = await service.graph.ainvoke(Command(resume={"action": action}), run_config(thread_id, service.deps))
        return _to_response(thread_id, result)


@router.post("/chat/{thread_id}/payment/check", response_model=ChatResponse)
async def payment_check(thread_id: str, service: Service, user_id: UserId = "anonymous") -> ChatResponse:
    """Hỏi lại cổng thanh toán (người dùng bấm "Tôi đã thanh toán" hoặc UI hỏi định kỳ)."""
    return await _payment(thread_id, "check", service, user_id)


@router.post("/chat/{thread_id}/payment/cancel", response_model=ChatResponse)
async def payment_cancel(thread_id: str, service: Service, user_id: UserId = "anonymous") -> ChatResponse:
    """Huỷ thanh toán đang chờ; `transaction` huỷ phần giữ chỗ."""
    return await _payment(thread_id, "cancel", service, user_id)


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
    }


@router.get("/status")
async def agent_status(service: Service):
    """Trạng thái agent và các lĩnh vực đã đăng ký."""
    return {
        "status": "ready",
        "agent": "LifeFlow agent graph",
        "mode": service.mode,
        "domains": [d.value for d in service.deps.agents.names()],
    }
