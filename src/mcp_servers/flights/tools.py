from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Annotated

from pydantic import Field
from relohome_flight.booking_engine import BookingEngine
from relohome_flight.catalog import fare_rules_for, find_airports, load_airlines, load_airports
from relohome_flight.errors import InvalidRequestError
from relohome_flight.schemas import (
    Airline,
    Airport,
    Booking,
    CancelResult,
    FlightSearchRequest,
    HoldBookingRequest,
    OfferDetail,
    SearchFlightsResult,
)
from relohome_flight.search import FlightSearchProvider, create_search_provider, sort_and_limit, validate_search
from relohome_flight.search.base import returns_after_arrival
from relohome_flight.settings import FlightSettings, get_flight_settings, now_vn
from relohome_flight.storage import FlightDatabase, OfferCache

BookingRef = Annotated[str, Field(min_length=1, description="booking_id (bk_...) hoặc mã PNR 6 ký tự")]


@dataclass
class FlightServices:
    provider: FlightSearchProvider
    offers: OfferCache
    bookings: BookingEngine
    clock: Callable[[], datetime] = field(default=now_vn)
    round_trip_min_gap_minutes: int = 120


def build_services(settings: FlightSettings | None = None) -> FlightServices:
    """Khởi tạo provider + SQLite theo cấu hình FLIGHT_*."""
    settings = settings or get_flight_settings()
    db = FlightDatabase(settings.db_path)
    return FlightServices(
        provider=create_search_provider(settings, db),
        offers=OfferCache(db),
        bookings=BookingEngine(db, hold_minutes=settings.hold_minutes),
        round_trip_min_gap_minutes=settings.round_trip_min_gap_minutes,
    )


class FlightTools:
    """Cài đặt các MCP tool. Docstring của mỗi method chính là mô tả tool mà LLM đọc."""

    def __init__(self, services: FlightServices) -> None:
        self._s = services

    async def search_airports(
        self,
        query: Annotated[
            str, Field(min_length=1, description="Tên thành phố/sân bay/tỉnh hoặc mã IATA, có dấu hoặc không")
        ],
        limit: Annotated[int, Field(ge=1, le=22)] = 5,
    ) -> list[Airport]:
        """Tra mã IATA của sân bay nội địa Việt Nam. Ví dụ: 'Đà Nẵng' -> DAD, 'Sài Gòn' -> SGN."""
        return find_airports(query, limit)

    async def search_flights(self, request: FlightSearchRequest) -> SearchFlightsResult:
        """Tìm chuyến bay nội địa Việt Nam.

        Một chiều (mặc định): offer `one_way` có giá tổng cho toàn bộ hành khách.
        Khứ hồi (`trip_type=round_trip` + `return_date`): trả danh sách CHIỀU ĐI (`round_trip_outbound`);
        giá là giá khứ hồi thấp nhất có chuyến đi đó (`price_scope=round_trip_from`). Chọn một chuyến đi rồi gọi
        `search_return_flights` để lấy các hành trình đầy đủ. Offer có hạn (expires_at).
        """
        validate_search(request, self._s.clock().date())
        offers = sort_and_limit(await self._s.provider.search(request), request)
        self._s.offers.put_many(offers)
        request_json = request.model_dump_json()
        for offer in offers:
            token = self._s.provider.return_token(offer.offer_id) if offer.kind == "round_trip_outbound" else None
            if token:
                self._s.offers.put_return_token(offer, token, request_json)
        if not offers:
            message = "Không có chuyến phù hợp. Thử ngày khác, bỏ nonstop_only hoặc đổi hạng ghế."
        elif request.trip_type == "round_trip":
            message = (
                f"Tìm thấy {len(offers)} chuyến đi (nguồn: {self._s.provider.name}). Chọn chuyến đi để xem chiều về."
            )
        else:
            message = f"Tìm thấy {len(offers)} chuyến (nguồn: {self._s.provider.name})."
        return SearchFlightsResult(source=self._s.provider.name, offers=offers, message=message)

    async def search_return_flights(
        self,
        outbound_offer_id: Annotated[str, Field(min_length=1, description="offer_id chiều đi (round_trip_outbound)")],
        max_results: Annotated[int, Field(ge=1, le=20)] = 10,
    ) -> SearchFlightsResult:
        """Lấy CHIỀU VỀ cho một chuyến đi khứ hồi đã chọn. Mỗi offer trả về là cả hành trình (đi + về),
        `price_scope=round_trip`, giá do nguồn trả (không cộng giá hai chiều). Bỏ chuyến về cất cánh trước giờ
        hạ cánh chuyến đi cộng khoảng cách tối thiểu."""
        outbound = self._s.offers.get(outbound_offer_id)
        if outbound.kind != "round_trip_outbound":
            raise InvalidRequestError("Offer này không phải chuyến đi của vé khứ hồi.")
        token, request_json = self._s.offers.get_return_token(outbound_offer_id)
        request = FlightSearchRequest.model_validate_json(request_json)
        found = await self._s.provider.search_returns(outbound, token, request)
        offers = returns_after_arrival(outbound, found, self._s.round_trip_min_gap_minutes)
        offers = sorted(offers, key=lambda o: (o.total_price, o.return_segments[0].departure_time))[:max_results]
        self._s.offers.put_many(offers)
        if offers:
            message = f"Tìm thấy {len(offers)} hành trình khứ hồi cho chuyến đi đã chọn."
        elif found:
            message = "Không còn chuyến về sau giờ hạ cánh chuyến đi (cộng khoảng cách tối thiểu). Hãy đổi ngày về."
        else:
            message = "Không có chuyến về phù hợp. Thử ngày về khác."
        return SearchFlightsResult(source=self._s.provider.name, offers=offers, message=message)

    async def get_offer(self, offer_id: Annotated[str, Field(min_length=1)]) -> OfferDetail:
        """Xem chi tiết một offer và điều kiện vé: hành lý, phí đổi, có hoàn/hủy được không."""
        offer = self._s.offers.get(offer_id)
        rules = fare_rules_for(offer.segments[0].airline_code, offer.cabin_class)
        return OfferDetail(offer=offer, fare_rules=rules)

    async def hold_booking(self, request: HoldBookingRequest) -> Booking:
        """Bước 1/2 đặt vé: GIỮ CHỖ (chưa xuất vé, chưa trừ tiền) cho một offer.

        Trả về booking trạng thái HELD kèm PNR, tổng tiền và hạn giữ chỗ. Sau bước này PHẢI
        đưa tóm tắt (chuyến, giờ bay, hành khách, tổng tiền) cho người dùng và chờ họ đồng ý
        rõ ràng rồi mới gọi confirm_booking. Tên hành khách được chuẩn hóa viết hoa không dấu.
        """
        offer = self._s.offers.get(request.offer_id)
        return self._s.bookings.hold(offer, request)

    async def confirm_booking(self, booking_ref: BookingRef) -> Booking:
        """Bước 2/2 đặt vé: XUẤT VÉ cho booking đang HELD (giả lập thanh toán).

        Chỉ gọi sau khi người dùng đã xác nhận rõ ràng. Gọi lại nhiều lần không xuất vé trùng.
        """
        return self._s.bookings.confirm(booking_ref)

    async def get_booking(self, booking_ref: BookingRef) -> Booking:
        """Tra cứu booking theo booking_id hoặc PNR: trạng thái, hành trình, số vé."""
        return self._s.bookings.get(booking_ref)

    async def cancel_booking(
        self,
        booking_ref: BookingRef,
        confirm: Annotated[bool, Field(description="false = chỉ báo phí hủy; true = hủy thật")] = False,
    ) -> CancelResult:
        """Hủy booking. Luôn gọi với confirm=false trước để báo phí hủy/tiền hoàn cho người dùng,
        chỉ gọi confirm=true khi họ đồng ý."""
        return self._s.bookings.cancel(booking_ref, confirm)

    # ---------- resources ----------

    def airports_resource(self) -> list[Airport]:
        """Danh sách sân bay nội địa được hỗ trợ."""
        return list(load_airports().values())

    def airlines_resource(self) -> list[Airline]:
        """Các hãng nội địa và điều kiện vé giả lập."""
        return list(load_airlines().values())

    def booking_resource(self, booking_ref: str) -> Booking:
        """Chi tiết một booking."""
        return self._s.bookings.get(booking_ref)
