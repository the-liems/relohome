import json
import logging
from datetime import datetime, timedelta
from typing import Any

import httpx

from src.mcp_servers.flights.catalog import get_airline
from src.mcp_servers.flights.errors import ProviderUnavailableError
from src.mcp_servers.flights.schemas import FlightOffer, FlightSearchRequest, Segment
from src.mcp_servers.flights.search.base import make_offer_id
from src.mcp_servers.flights.settings import VN_TZ, FlightSettings, now_vn
from src.mcp_servers.flights.storage import SearchCache

SERPAPI_URL = "https://serpapi.com/search"
TRAVEL_CLASS = {"economy": 1, "premium_economy": 2, "business": 3, "first": 4}
ONE_WAY = 2
NONSTOP = 1
ANY_STOPS = 0
TIME_FORMAT = "%Y-%m-%d %H:%M"
NO_RESULTS_HINT = "hasn't returned any results"
REQUEST_TIMEOUT_SECONDS = 30.0

# httpx log mọi request ở mức INFO kèm full URL, mà SerpApi nhận api_key qua query string
# -> nâng lên WARNING để key không lọt vào stderr/log của client MCP.
logging.getLogger("httpx").setLevel(logging.WARNING)


def build_params(request: FlightSearchRequest) -> dict[str, Any]:
    """Tham số Google Flights API của SerpApi (chưa gồm api_key)."""
    pax = request.passengers
    return {
        "engine": "google_flights",
        "departure_id": request.origin,
        "arrival_id": request.destination,
        "outbound_date": request.departure_date.isoformat(),
        "type": ONE_WAY,
        "travel_class": TRAVEL_CLASS[request.cabin_class],
        "adults": pax.adults,
        "children": pax.children,
        "infants_on_lap": pax.infants,
        "stops": NONSTOP if request.nonstop_only else ANY_STOPS,
        "currency": "VND",
        "hl": "vi",
        "gl": "vn",
    }


def parse_segment(raw: dict[str, Any]) -> Segment:
    """Chuyển một phần tử `flights[]` của SerpApi sang Segment."""
    flight_number = raw["flight_number"].replace(" ", "")
    airline_code = raw["flight_number"].split()[0]
    known = get_airline(airline_code)
    return Segment(
        flight_number=flight_number,
        airline_code=airline_code,
        airline_name=raw.get("airline") or (known.name if known else airline_code),
        origin=raw["departure_airport"]["id"],
        destination=raw["arrival_airport"]["id"],
        departure_time=datetime.strptime(raw["departure_airport"]["time"], TIME_FORMAT).replace(tzinfo=VN_TZ),
        arrival_time=datetime.strptime(raw["arrival_airport"]["time"], TIME_FORMAT).replace(tzinfo=VN_TZ),
        duration_minutes=int(raw["duration"]),
        aircraft=raw.get("airplane"),
    )


def parse_offers(data: dict[str, Any], request: FlightSearchRequest, expires_at: datetime) -> list[FlightOffer]:
    """Gộp best_flights + other_flights thành FlightOffer; bỏ qua lịch trình thiếu giá hoặc thiếu dữ liệu."""
    offers = []
    for item in [*data.get("best_flights", []), *data.get("other_flights", [])]:
        try:
            segments = [parse_segment(raw) for raw in item["flights"]]
            price = int(item["price"])
        except (KeyError, TypeError, ValueError, IndexError, AttributeError):
            continue
        offers.append(
            FlightOffer(
                offer_id=make_offer_id(
                    "off_serp", *(s.flight_number for s in segments), segments[0].departure_time, request.passengers
                ),
                source="serpapi",
                segments=segments,
                stops=len(segments) - 1,
                total_duration_minutes=int(item.get("total_duration") or sum(s.duration_minutes for s in segments)),
                cabin_class=request.cabin_class,
                passengers=request.passengers,
                total_price=price,
                expires_at=expires_at,
            )
        )
    return offers


class SerpApiFlightSearch:
    """Tìm chuyến thật qua SerpApi Google Flights. Chỉ đọc dữ liệu, không đặt vé."""

    name = "serpapi"

    def __init__(
        self, settings: FlightSettings, cache: SearchCache | None = None, client: httpx.AsyncClient | None = None
    ) -> None:
        self._api_key = settings.serpapi_api_key
        self._offer_ttl = timedelta(minutes=settings.offer_ttl_minutes)
        self._cache = cache
        self._client = client

    async def search(self, request: FlightSearchRequest) -> list[FlightOffer]:
        params = build_params(request)
        cache_key = json.dumps(params, sort_keys=True)
        data = self._cache.get(cache_key) if self._cache else None
        if data is None:
            data = await self._fetch(params)
            if self._cache:
                self._cache.put(cache_key, data)
        return parse_offers(data, request, now_vn() + self._offer_ttl)

    async def _fetch(self, params: dict[str, Any]) -> dict[str, Any]:
        # Không đưa str(exc) vào message: URL lỗi của httpx có chứa api_key.
        try:
            if self._client is not None:
                response = await self._client.get(SERPAPI_URL, params={**params, "api_key": self._api_key})
            else:
                async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
                    response = await client.get(SERPAPI_URL, params={**params, "api_key": self._api_key})
        except httpx.TimeoutException as exc:
            raise ProviderUnavailableError("SerpApi phản hồi quá chậm, hãy thử lại sau.") from exc
        except httpx.HTTPError as exc:
            raise ProviderUnavailableError("Không kết nối được SerpApi.") from exc
        return self._read_body(response)

    @staticmethod
    def _read_body(response: httpx.Response) -> dict[str, Any]:
        if response.status_code == 401:
            raise ProviderUnavailableError("FLIGHT_SERPAPI_API_KEY không hợp lệ.")
        if response.status_code == 429:
            raise ProviderUnavailableError(
                "Đã hết lượt gọi SerpApi. Chuyển FLIGHT_SEARCH_PROVIDER=mock để tiếp tục demo."
            )
        try:
            data = response.json()
        except ValueError as exc:
            raise ProviderUnavailableError(
                f"SerpApi trả về dữ liệu không đọc được (HTTP {response.status_code})."
            ) from exc
        error = data.get("error") if isinstance(data, dict) else None
        if error and NO_RESULTS_HINT in error:
            return {}
        if error or response.status_code >= 400:
            raise ProviderUnavailableError(f"SerpApi báo lỗi: {error or f'HTTP {response.status_code}'}")
        return data
