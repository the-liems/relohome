from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from relohome_contracts.moving_options import MovingOptions


class MovingContact(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=150)
    mobile: str = Field(pattern=r"^\+?\d{9,15}$")
    building: str | None = Field(default=None, max_length=200)
    apartment_or_floor: str | None = Field(default=None, max_length=100)
    remarks: str | None = Field(default=None, max_length=500)


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


class MovingQuoteForm(BaseModel):
    """Explicit quote intent; no contacts, approval or model-authored coordinates."""

    model_config = ConfigDict(extra="forbid")
    plan_version: int = Field(ge=0, strict=True)
    pickup: ConfirmedLocation
    destination: ConfirmedLocation
    move_date: date
    move_time: str = Field(pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")
    moving_options: MovingOptions = Field(default_factory=MovingOptions)
    destination_listing_id: str | None = Field(default=None, min_length=1, max_length=128)


class BoundingBox(BaseModel):
    model_config = ConfigDict(extra="forbid")
    west: float = Field(ge=-180, le=180, allow_inf_nan=False)
    south: float = Field(ge=-90, le=90, allow_inf_nan=False)
    east: float = Field(ge=-180, le=180, allow_inf_nan=False)
    north: float = Field(ge=-90, le=90, allow_inf_nan=False)

    @model_validator(mode="after")
    def ordered(self):
        if self.west >= self.east or self.south >= self.north:
            raise ValueError("west < east and south < north are required")
        if self.east - self.west > 3 or self.north - self.south > 3:
            raise ValueError("Map view is wider than a city")
        return self


class MapView(BaseModel):
    """Khung bản đồ client đang hiển thị; graph chỉ dùng khi người dùng nói tới "khu này"."""

    model_config = ConfigDict(extra="forbid")
    bounding_box: BoundingBox
    zoom: float = Field(ge=0, le=24, allow_inf_nan=False)


class PlaceChoice(BaseModel):
    """Ứng viên địa điểm người dùng bấm chọn; API đối chiếu lại với Location trước khi dùng."""

    model_config = ConfigDict(extra="forbid")
    field: Literal["near", "route_from", "route_to"]
    place_id: str = Field(min_length=1, max_length=128)


class ChatRequest(BaseModel):
    housing_location: ConfirmedLocation | None = None
    moving_locations: MovingLocations | None = None
    moving_options: MovingOptions | None = None
    map_view: MapView | None = None
    place_choice: PlaceChoice | None = None
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
