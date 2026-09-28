import re
import unicodedata
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

CabinClass = Literal["economy", "premium_economy", "business", "first"]
PassengerType = Literal["adult", "child", "infant"]
BookingStatus = Literal["HELD", "TICKETED", "CANCELLED", "EXPIRED"]
SortBy = Literal["price", "departure_time", "duration"]

MAX_PASSENGERS = 9
_IATA_PATTERN = r"^[A-Za-z]{3}$"
_NAME_PATTERN = re.compile(r"^[A-Z]+( [A-Z]+)*$")


def strip_accents(text: str) -> str:
    """Bỏ dấu tiếng Việt: 'Đà Nẵng' -> 'Da Nang'."""
    text = text.replace("Đ", "D").replace("đ", "d")
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


# ---------- Danh mục ----------


class Airport(BaseModel):
    code: str = Field(description="Mã IATA 3 ký tự")
    name: str
    city: str
    province: str
    aliases: list[str] = Field(default_factory=list)
    lat: float
    lon: float


class FareRules(BaseModel):
    """Điều kiện vé (giả lập theo hãng, không phải quy định chính thức)."""

    checked_baggage_kg: int = Field(description="Hành lý ký gửi miễn cước (kg), 0 = không có")
    carry_on_kg: int = Field(description="Hành lý xách tay (kg)")
    changeable: bool
    change_fee: int | None = Field(description="Phí đổi mỗi khách (VND)")
    refundable: bool
    cancel_fee: int | None = Field(description="Phí hủy/hoàn mỗi khách (VND), null nếu không hoàn")


class Airline(BaseModel):
    code: str
    name: str
    ticket_prefix: str
    price_factor: float
    trunk_only: bool = Field(description="Chỉ khai thác các đường bay trục chính")
    cabins: list[CabinClass]
    fare_rules: dict[str, FareRules]


# ---------- Tìm chuyến ----------


class PassengerCount(BaseModel):
    adults: int = Field(default=1, ge=1, le=MAX_PASSENGERS, description="Người lớn (từ 12 tuổi)")
    children: int = Field(default=0, ge=0, le=MAX_PASSENGERS, description="Trẻ em (2-11 tuổi)")
    infants: int = Field(default=0, ge=0, le=MAX_PASSENGERS, description="Em bé (dưới 2 tuổi, ngồi lòng người lớn)")

    @model_validator(mode="after")
    def check_counts(self) -> "PassengerCount":
        if self.infants > self.adults:
            raise ValueError("Mỗi em bé cần đi kèm một người lớn")
        if self.adults + self.children + self.infants > MAX_PASSENGERS:
            raise ValueError(f"Tối đa {MAX_PASSENGERS} khách mỗi lần đặt")
        return self

    @property
    def total(self) -> int:
        return self.adults + self.children + self.infants


class FlightSearchRequest(BaseModel):
    """Yêu cầu tìm chuyến bay một chiều nội địa Việt Nam."""

    origin: str = Field(pattern=_IATA_PATTERN, description="Mã IATA điểm đi, ví dụ HAN")
    destination: str = Field(pattern=_IATA_PATTERN, description="Mã IATA điểm đến, ví dụ SGN")
    departure_date: date = Field(description="Ngày bay YYYY-MM-DD")
    passengers: PassengerCount = Field(default_factory=PassengerCount)
    cabin_class: CabinClass = "economy"
    nonstop_only: bool = Field(default=False, description="Chỉ lấy chuyến bay thẳng")
    sort_by: SortBy = "price"
    max_results: int = Field(default=5, ge=1, le=20)

    @field_validator("origin", "destination")
    @classmethod
    def upper_code(cls, value: str) -> str:
        return value.upper()

    @model_validator(mode="after")
    def check_route(self) -> "FlightSearchRequest":
        if self.origin == self.destination:
            raise ValueError("Điểm đi và điểm đến phải khác nhau")
        return self


class Segment(BaseModel):
    flight_number: str = Field(description="Số hiệu chuyến bay, ví dụ VJ123")
    airline_code: str
    airline_name: str
    origin: str
    destination: str
    departure_time: datetime
    arrival_time: datetime
    duration_minutes: int
    aircraft: str | None = None


class FlightOffer(BaseModel):
    offer_id: str = Field(description="Dùng cho get_offer và hold_booking")
    source: Literal["mock", "serpapi"]
    segments: list[Segment]
    stops: int
    total_duration_minutes: int
    cabin_class: CabinClass
    passengers: PassengerCount
    total_price: int = Field(description="Tổng giá cho tất cả hành khách (VND)")
    price_per_adult: int | None = None
    currency: str = "VND"
    seats_left: int | None = None
    expires_at: datetime = Field(description="Sau thời điểm này phải tìm lại")


class SearchFlightsResult(BaseModel):
    source: str
    offers: list[FlightOffer]
    message: str


class OfferDetail(BaseModel):
    offer: FlightOffer
    fare_rules: FareRules


# ---------- Đặt vé ----------


class Passenger(BaseModel):
    type: PassengerType = "adult"
    title: Literal["MR", "MRS", "MS", "MSTR", "MISS"]
    first_name: str = Field(min_length=1, max_length=50, description="Tên đệm và tên, ví dụ 'VAN A'")
    last_name: str = Field(min_length=1, max_length=50, description="Họ, ví dụ 'NGUYEN'")
    date_of_birth: date
    id_number: str | None = Field(default=None, max_length=20, description="CCCD/hộ chiếu (tùy chọn)")

    @field_validator("first_name", "last_name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        """Tên trên vé viết hoa, không dấu như quy định của hãng."""
        name = " ".join(strip_accents(value).upper().split())
        if not _NAME_PATTERN.match(name):
            raise ValueError("Tên chỉ gồm chữ cái và khoảng trắng")
        return name


class Contact(BaseModel):
    email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    phone: str = Field(pattern=r"^\+?\d{9,15}$", description="Số điện thoại, ví dụ 0901234567")


class HoldBookingRequest(BaseModel):
    offer_id: str
    passengers: list[Passenger] = Field(min_length=1, max_length=MAX_PASSENGERS)
    contact: Contact


class Booking(BaseModel):
    booking_id: str
    pnr: str = Field(description="Mã đặt chỗ 6 ký tự")
    status: BookingStatus
    offer: FlightOffer
    passengers: list[Passenger]
    contact: Contact
    total_price: int
    currency: str
    hold_expires_at: datetime | None = Field(description="Hạn giữ chỗ khi status = HELD")
    ticket_numbers: list[str] = Field(default_factory=list)
    cancel_fee: int | None = None
    refund_amount: int | None = None
    created_at: datetime
    updated_at: datetime


class CancelResult(BaseModel):
    booking_id: str
    pnr: str
    status: BookingStatus
    cancelled: bool = Field(description="False nghĩa là mới báo giá hủy, chưa hủy")
    cancel_fee: int
    refund_amount: int
    currency: str
    message: str
