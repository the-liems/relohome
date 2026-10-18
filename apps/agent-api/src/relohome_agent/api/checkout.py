"""Thao tác thanh toán và thuê nhà có kiểu trên UI (payment-design §7–§10). Không gọi LLM, không tạo đơn AhaMove."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from relohome_agent.api.routes import Service, UserId, _owned, authenticate

router = APIRouter(prefix="/ui", dependencies=[Depends(authenticate)])


class SummaryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    domain: str = Field(pattern="^(flight|relocation)$")


class PayRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    payload_hash: str = Field(min_length=64, max_length=64)
    request_key: str = Field(min_length=16, max_length=80)
    # Chỉ vé bay: người đặt (từ hồ sơ) + người đi cùng (nhập ở form). Không đi qua LLM, không lưu ở giao dịch.
    passengers: dict | None = None


class ViewingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    slot: str = Field(min_length=10, max_length=40)


class AgreementRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    agreed: bool
    deposit_vnd: int | None = Field(default=None, ge=0, le=10_000_000_000)
    rent_vnd: int | None = Field(default=None, ge=0, le=10_000_000_000)
    move_in: str | None = Field(default=None, max_length=10)


class LandlordPaidRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    amount_vnd: int = Field(ge=1, le=10_000_000_000)
    paid_on: str = Field(min_length=10, max_length=10)


def checkout_of(service):
    if getattr(service, "checkout", None) is None:
        raise HTTPException(404, "Thanh toán trong app chưa được bật trên máy chủ này.")
    return service.checkout


async def _values(service, thread_id: str, user_id: str) -> dict:
    values, pending = await _owned(service, thread_id, user_id)
    if pending:
        raise HTTPException(409, "Hãy xử lý phương án đang chờ xác nhận trước.")
    return values


@router.get("/chat/{thread_id}/checkout")
async def thread_checkout(thread_id: str, service: Service, user_id: UserId = "anonymous"):
    checkout = getattr(service, "checkout", None)
    if checkout is None:
        return {"enabled": False, "transactions": [], "totals": {}}
    values, _ = await _owned(service, thread_id, user_id)
    return {"enabled": True, **checkout.thread_view(user_id, thread_id, values)}


@router.post("/chat/{thread_id}/checkout/summary")
async def checkout_summary(thread_id: str, body: SummaryRequest, service: Service, user_id: UserId = "anonymous"):
    checkout = checkout_of(service)
    values = await _values(service, thread_id, user_id)
    return checkout.summary(user_id, thread_id, values, body.domain)


@router.post("/checkout/{transaction_id}/pay")
async def checkout_pay(transaction_id: str, body: PayRequest, service: Service, user_id: UserId = "anonymous"):
    checkout = checkout_of(service)
    attempt = await checkout.pay(user_id, transaction_id, body.payload_hash, body.request_key, body.passengers)
    return {"attempt": attempt, "transaction": checkout.transaction_view(checkout.store.get_tx(transaction_id))}


@router.post("/checkout/attempts/{attempt_id}/check")
async def checkout_check(attempt_id: str, service: Service, user_id: UserId = "anonymous"):
    checkout = checkout_of(service)
    attempt = await checkout.check(user_id, attempt_id)
    tx = checkout.store.get_tx(attempt["transaction_id"])
    return {"attempt": attempt, "transaction": checkout.transaction_view(tx)}


@router.post("/checkout/attempts/{attempt_id}/tester-paid")
async def checkout_tester_paid(attempt_id: str, service: Service, user_id: UserId = "anonymous"):
    checkout = checkout_of(service)
    attempt = await checkout.tester_paid(user_id, attempt_id)
    tx = checkout.store.get_tx(attempt["transaction_id"])
    return {"attempt": attempt, "transaction": checkout.transaction_view(tx)}


@router.get("/checkout/attempts/{attempt_id}/qr")
async def checkout_qr(attempt_id: str, service: Service, user_id: UserId = "anonymous"):
    checkout = checkout_of(service)
    attempt = checkout.store.get_attempt(attempt_id)
    if attempt is None or attempt.user_id != user_id or not attempt.qr_code:
        raise HTTPException(404, "Không có mã QR cho lần thanh toán này.")
    if attempt.outcome != "awaiting_payment" or (
        attempt.expires_at and attempt.expires_at <= datetime.now(attempt.expires_at.tzinfo)
    ):
        raise HTTPException(409, "Lần thanh toán không còn chờ trả.")
    return {"qr_code": attempt.qr_code}


@router.post("/chat/{thread_id}/housing/viewing")
async def housing_viewing(thread_id: str, body: ViewingRequest, service: Service, user_id: UserId = "anonymous"):
    checkout = checkout_of(service)
    values = await _values(service, thread_id, user_id)
    return checkout.housing_viewing(user_id, thread_id, values, body.slot)


@router.post("/chat/{thread_id}/housing/agreement")
async def housing_agreement(thread_id: str, body: AgreementRequest, service: Service, user_id: UserId = "anonymous"):
    checkout = checkout_of(service)
    values = await _values(service, thread_id, user_id)
    return checkout.housing_agreement(
        user_id, thread_id, values, body.agreed, body.deposit_vnd, body.rent_vnd, body.move_in
    )


@router.post("/chat/{thread_id}/housing/paid")
async def housing_paid(thread_id: str, body: LandlordPaidRequest, service: Service, user_id: UserId = "anonymous"):
    checkout = checkout_of(service)
    values = await _values(service, thread_id, user_id)
    return checkout.housing_paid(user_id, thread_id, values, body.amount_vnd, body.paid_on)
