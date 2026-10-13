"""Explicit ZaloPay sandbox demo, separate from AhaMove CASH and flight booking.

Every create is a human form submission. Provider keys never enter the LLM/UI.
Ownership and uncertain-request fencing persist in the local runtime DB.
"""

import hashlib
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from relohome_agent.api.routes import Service, UserId, _lock, authenticate
from relohome_agent.services.adapters.mcp import ToolCallError

router = APIRouter(prefix="/sandbox/payments", dependencies=[Depends(authenticate)])


class CreateSandboxPayment(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: UUID
    amount_vnd: int = Field(ge=1000, le=100000, strict=True)
    confirmed: Literal[True]


def configured(service):
    if not service.sandbox_payment_client:
        raise HTTPException(403, "ZaloPay sandbox demo is disabled")
    return service.sandbox_payment_client, service.deps.transaction.intent_store


@router.post("")
async def create_payment(body: CreateSandboxPayment, service: Service, user_id: UserId):
    client, db = configured(service)
    key = hashlib.sha256(f"{user_id}|{body.request_id}".encode()).hexdigest()
    async with _lock(service, "payment:" + key):
        existing = db.get("sandbox_payment_requests", key)
        if existing:
            if existing["amount"] != body.amount_vnd:
                raise HTTPException(409, "Request ID is already bound to another amount")
            if existing.get("payment"):
                # Recover the owner index if the process stopped between the two writes.
                db.put(
                    "sandbox_payment_owners",
                    existing["payment"]["payment_id"],
                    {"owner": user_id, "request_key": key},
                )
                return existing["payment"]
            raise HTTPException(409, "Kết quả lần tạo trước chưa rõ; cần đối soát, không tự tạo lại.")
        record = {"owner": user_id, "amount": body.amount_vnd, "state": "started"}
        db.put("sandbox_payment_requests", key, record)
        try:
            result = await client.call(
                "create_payment",
                {
                    "order_ref": "demo_" + key[:20],
                    "amount": body.amount_vnd,
                    "customer_ref": "user_" + hashlib.sha256(user_id.encode()).hexdigest()[:20],
                },
            )
        except ToolCallError:
            raise HTTPException(
                502, "Chưa xác định được kết quả tạo ZaloPay sandbox; giữ mã yêu cầu để đối soát."
            ) from None
        if not isinstance(result, dict) or result.get("provider") != "zalopay" or not result.get("payment_id"):
            raise HTTPException(502, "Provider result is invalid; reconcile before retrying")
        db.put("sandbox_payment_requests", key, {**record, "state": "created", "payment": result})
        db.put("sandbox_payment_owners", result["payment_id"], {"owner": user_id, "request_key": key})
        return result


@router.get("/{payment_id}")
async def get_payment(payment_id: str, service: Service, user_id: UserId):
    client, db = configured(service)
    owner = db.get("sandbox_payment_owners", payment_id)
    if not owner or owner["owner"] != user_id:
        raise HTTPException(404, "Payment not found")
    async with _lock(service, "payment:" + owner["request_key"]):
        try:
            return await client.call("get_payment", {"payment_ref": payment_id})
        except ToolCallError:
            raise HTTPException(502, "Không đọc được trạng thái ZaloPay; chưa thể kết luận đã thanh toán.") from None
