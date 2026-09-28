from typing import Any, Literal

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=5000, description="Tin nhắn từ user")
    thread_id: str | None = Field(default=None, max_length=128, description="Bỏ trống để mở hội thoại mới")
    suggestion_key: str | None = Field(default=None, max_length=100, description="Key gợi ý khi user bấm nút gợi ý")


class DecisionRequest(BaseModel):
    kind: Literal["CONFIRM", "CHANGE", "REJECT", "CANCEL"]
    plan_version: int
    payload_hash: str | None = Field(default=None, description="Bắt buộc khi CONFIRM; phải khớp payload đang chờ")
    change_request: str | None = Field(default=None, max_length=5000)
    target_task_ids: list[str] = []
    # Form dữ liệu cá nhân theo commit action (D16). Backend lưu vào kho riêng, graph chỉ thấy pii_ref.
    pii_forms: dict[str, dict[str, Any]] = {}


class ChatResponse(BaseModel):
    status: Literal["done", "pending_confirmation", "pending_payment"]
    thread_id: str
    response: dict[str, Any] | None = None
    confirmation: dict[str, Any] | None = None
    payment: dict[str, Any] | None = None
