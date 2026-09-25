import hashlib
from datetime import date, timedelta
from typing import Protocol

from src.mcp_servers.flights.catalog import get_airport
from src.mcp_servers.flights.errors import InvalidRequestError
from src.mcp_servers.flights.schemas import FlightOffer, FlightSearchRequest

MAX_DAYS_AHEAD = 330


class FlightSearchProvider(Protocol):
    """Giao diện chung cho mọi nguồn dữ liệu chuyến bay (mock, SerpApi...)."""

    name: str

    async def search(self, request: FlightSearchRequest) -> list[FlightOffer]:
        """Trả về các offer một chiều; danh sách rỗng nếu không có chuyến."""
        ...


def validate_search(request: FlightSearchRequest, today: date) -> None:
    """Kiểm tra chung trước khi gọi provider: sân bay nội địa và ngày bay hợp lệ."""
    get_airport(request.origin)
    get_airport(request.destination)
    if request.departure_date < today:
        raise InvalidRequestError(f"Ngày bay {request.departure_date} đã qua (hôm nay là {today}).")
    if request.departure_date > today + timedelta(days=MAX_DAYS_AHEAD):
        raise InvalidRequestError(f"Chỉ tìm được chuyến trong vòng {MAX_DAYS_AHEAD} ngày tới.")


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
