import hashlib
from datetime import date, timedelta
from typing import Protocol

from relohome_flight.catalog import get_airport
from relohome_flight.errors import InvalidRequestError
from relohome_flight.schemas import FlightOffer, FlightSearchRequest

MAX_DAYS_AHEAD = 330


class FlightSearchProvider(Protocol):
    """Giao diện chung cho mọi nguồn dữ liệu chuyến bay (mock, SerpApi...)."""

    name: str

    async def search(self, request: FlightSearchRequest) -> list[FlightOffer]:
        """Trả về các offer; danh sách rỗng nếu không có chuyến.

        Một chiều: offer `one_way`. Khứ hồi: offer `round_trip_outbound` cho chiều đi; mã lấy chiều về
        của từng chuyến đi đọc qua `return_token`.
        """
        ...

    def return_token(self, offer_id: str) -> str | None:
        """Mã lấy chiều về của chuyến đi khứ hồi vừa tìm (chỉ server giữ)."""
        ...

    async def search_returns(
        self, outbound: FlightOffer, token: str, request: FlightSearchRequest
    ) -> list[FlightOffer]:
        """Chiều về cho một chuyến đi khứ hồi đã chọn: offer `round_trip` gồm cả hai chặng."""
        ...


def validate_search(request: FlightSearchRequest, today: date) -> None:
    """Kiểm tra chung trước khi gọi provider: sân bay nội địa và ngày bay hợp lệ."""
    get_airport(request.origin)
    get_airport(request.destination)
    if request.departure_date < today:
        raise InvalidRequestError(f"Ngày bay {request.departure_date} đã qua (hôm nay là {today}).")
    if request.departure_date > today + timedelta(days=MAX_DAYS_AHEAD):
        raise InvalidRequestError(f"Chỉ tìm được chuyến trong vòng {MAX_DAYS_AHEAD} ngày tới.")
    if request.return_date is not None and request.return_date > today + timedelta(days=MAX_DAYS_AHEAD):
        raise InvalidRequestError(f"Ngày về chỉ được trong vòng {MAX_DAYS_AHEAD} ngày tới.")


def sort_and_limit(offers: list[FlightOffer], request: FlightSearchRequest) -> list[FlightOffer]:
    """Lọc bay thẳng (nếu cần), sắp xếp theo tiêu chí và cắt theo max_results."""
    if request.nonstop_only:
        offers = [o for o in offers if o.stops == 0]
    sort_keys = {
        "price": lambda o: (o.total_price, o.segments[0].departure_time),
        "departure_time": lambda o: (o.segments[0].departure_time, o.total_price),
        "duration": lambda o: (o.total_duration_minutes, o.total_price),
    }
    return sorted(offers, key=sort_keys[request.sort_by])[: request.max_results]


def make_offer_id(prefix: str, *parts: object) -> str:
    """Sinh offer_id ổn định từ các thành phần (cùng chuyến + cùng số khách -> cùng id)."""
    digest = hashlib.sha1("|".join(str(p) for p in parts).encode(), usedforsecurity=False).hexdigest()
    return f"{prefix}_{digest[:12]}"


def returns_after_arrival(outbound: FlightOffer, returns: list[FlightOffer], min_gap_minutes: int) -> list[FlightOffer]:
    """Bỏ chuyến về cất cánh trước giờ hạ cánh chuyến đi cộng khoảng cách tối thiểu (khứ hồi trong ngày, bay đêm)."""
    landing = outbound.segments[-1].arrival_time + timedelta(minutes=min_gap_minutes)
    return [o for o in returns if o.return_segments and o.return_segments[0].departure_time >= landing]
