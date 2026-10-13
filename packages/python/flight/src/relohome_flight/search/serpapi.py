import json
import logging
from datetime import datetime, timedelta
from typing import Any

import httpx

from relohome_flight.catalog import get_airline
from relohome_flight.errors import ProviderUnavailableError
from relohome_flight.schemas import FlightOffer, FlightSearchRequest, Segment
from relohome_flight.search.base import make_offer_id
from relohome_flight.settings import VN_TZ, FlightSettings, now_vn
from relohome_flight.storage import SearchCache

SERPAPI_URL = "https://serpapi.com/search"
TRAVEL_CLASS = {"economy": 1, "premium_economy": 2, "business": 3, "first": 4}
ROUND_TRIP = 1
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
    params = {
        "engine": "google_flights",
        "departure_id": request.origin,
        "arrival_id": request.destination,
        "outbound_date": request.departure_date.isoformat(),
        "type": ROUND_TRIP if request.trip_type == "round_trip" else ONE_WAY,
        "travel_class": TRAVEL_CLASS[request.cabin_class],
        "adults": pax.adults,
        "children": pax.children,
        "infants_on_lap": pax.infants,
        "stops": NONSTOP if request.nonstop_only else ANY_STOPS,
        "currency": "VND",
        "hl": "vi",
        "gl": "vn",
    }
    if request.trip_type == "round_trip" and request.return_date is not None:
        params["return_date"] = request.return_date.isoformat()
    return params


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


def _items(data: dict[str, Any]) -> list[tuple[list[Segment], int, int, dict[str, Any]]]:
    rows = []
    for item in [*data.get("best_flights", []), *data.get("other_flights", [])]:
        try:
            segments = [parse_segment(raw) for raw in item["flights"]]
            price = int(item["price"])
        except (KeyError, TypeError, ValueError, IndexError, AttributeError):
            continue
        duration = int(item.get("total_duration") or sum(s.duration_minutes for s in segments))
        rows.append((segments, price, duration, item))
    return rows


def parse_offers(
    data: dict[str, Any], request: FlightSearchRequest, expires_at: datetime, tokens: dict[str, str] | None = None
) -> list[FlightOffer]:
    """Gộp best_flights + other_flights thành FlightOffer; bỏ qua lịch trình thiếu giá hoặc thiếu dữ liệu.

    Khứ hồi: SerpApi trả danh sách chiều đi, giá là giá khứ hồi thấp nhất có chuyến đi đó (kiểm bằng lần gọi thật
    08/10/2026), kèm `departure_token` để lấy chiều về; token ghi vào `tokens`. Chuyến đi thiếu token thì bỏ.
    """
    round_trip = request.trip_type == "round_trip"
    offers = []
    for segments, price, duration, item in _items(data):
        token = item.get("departure_token") if round_trip else None
        if round_trip and not token:
            continue
        id_parts = [*(s.flight_number for s in segments), segments[0].departure_time]
        if round_trip:
            id_parts.append(request.return_date)
        offer = FlightOffer(
            offer_id=make_offer_id("off_serp_rto" if round_trip else "off_serp", *id_parts, request.passengers),
            source="serpapi",
            segments=segments,
            stops=len(segments) - 1,
            total_duration_minutes=duration,
            cabin_class=request.cabin_class,
            passengers=request.passengers,
            total_price=price,
            expires_at=expires_at,
            kind="round_trip_outbound" if round_trip else "one_way",
            price_scope="round_trip_from" if round_trip else "one_way",
        )
        if token and tokens is not None:
            tokens[offer.offer_id] = token
        offers.append(offer)
    return offers


def parse_returns(data: dict[str, Any], outbound: FlightOffer, expires_at: datetime) -> list[FlightOffer]:
    """Chiều về cho chuyến đi đã chọn; giá là giá cả hành trình (đi + về) do SerpApi trả, không tự cộng."""
    offers = []
    for segments, price, duration, _ in _items(data):
        offers.append(
            FlightOffer(
                offer_id=make_offer_id(
                    "off_serp_rt",
                    *(s.flight_number for s in outbound.segments),
                    outbound.segments[0].departure_time,
                    *(s.flight_number for s in segments),
                    segments[0].departure_time,
                    outbound.passengers,
                ),
                source="serpapi",
                segments=outbound.segments,
                return_segments=segments,
                stops=max(outbound.stops, len(segments) - 1),
                total_duration_minutes=outbound.total_duration_minutes + duration,
                cabin_class=outbound.cabin_class,
                passengers=outbound.passengers,
                total_price=price,
                expires_at=min(expires_at, outbound.expires_at),
                kind="round_trip",
                price_scope="round_trip",
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
        self._tokens: dict[str, str] = {}

    async def search(self, request: FlightSearchRequest) -> list[FlightOffer]:
        data = await self._cached(build_params(request))
        return parse_offers(data, request, now_vn() + self._offer_ttl, self._tokens)

    def return_token(self, offer_id: str) -> str | None:
        return self._tokens.get(offer_id)

    async def search_returns(
        self, outbound: FlightOffer, token: str, request: FlightSearchRequest
    ) -> list[FlightOffer]:
        data = await self._cached({**build_params(request), "departure_token": token})
        return parse_returns(data, outbound, now_vn() + self._offer_ttl)

    async def _cached(self, params: dict[str, Any]) -> dict[str, Any]:
        cache_key = json.dumps(params, sort_keys=True)
        data = self._cache.get(cache_key) if self._cache else None
        if data is None:
            data = await self._fetch(params)
            if self._cache:
                self._cache.put(cache_key, data)
        return data

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
