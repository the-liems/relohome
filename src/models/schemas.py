from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class MovingContact(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=150)
    mobile: str = Field(pattern=r"^\+?\d{9,15}$")


class MovingOrderUpdate(BaseModel):
    """Contact/notes update only. Route/COD changes need a new price agreement."""

    model_config = ConfigDict(extra="forbid")
    path_index: int = Field(ge=0, le=50)
    name: str | None = Field(default=None, min_length=1, max_length=150)
    mobile: str | None = Field(default=None, pattern=r"^\+?\d{9,15}$")
    remarks: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def nonempty(self):
        if self.name is None and self.mobile is None and self.remarks is None:
            raise ValueError("Provide at least one contact/notes field")
        return self


class ConfirmedLocation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    address: str = Field(min_length=3, max_length=300)
    lat: float = Field(ge=-90, le=90, allow_inf_nan=False)
    lng: float = Field(ge=-180, le=180, allow_inf_nan=False)
    confirmed: Literal[True]


class MovingLocations(BaseModel):
    model_config = ConfigDict(extra="forbid")
    pickup: ConfirmedLocation | None = None
    destination: ConfirmedLocation | None = None


class ChatRequest(BaseModel):
    moving_locations: MovingLocations | None = None
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


class SimulatePaymentRequest(BaseModel):
    outcome: Literal["PAID", "FAILED", "EXPIRED"] = Field(
        default="PAID", description="Kết quả giả lập; chỉ dùng khi demo với cổng thanh toán mock"
    )


class ChatResponse(BaseModel):
    status: Literal["done", "pending_confirmation", "pending_payment"]
    thread_id: str
    response: dict[str, Any] | None = None
    confirmation: dict[str, Any] | None = None
    payment: dict[str, Any] | None = None
