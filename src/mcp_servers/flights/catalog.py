import json
import math
from functools import lru_cache
from pathlib import Path

from src.mcp_servers.flights.errors import InvalidRequestError
from src.mcp_servers.flights.schemas import Airline, Airport, CabinClass, FareRules, strip_accents

DATA_DIR = Path(__file__).parent / "data"
EARTH_RADIUS_KM = 6371.0
DEFAULT_FARE_RULES = FareRules(
    checked_baggage_kg=0,
    carry_on_kg=7,
    changeable=False,
    change_fee=None,
    refundable=False,
    cancel_fee=None,
)


def normalize_text(text: str) -> str:
    """Chuẩn hóa để so khớp: bỏ dấu, chữ thường, gộp khoảng trắng."""
    return " ".join(strip_accents(text).lower().replace(".", " ").split())


@lru_cache
def load_airports() -> dict[str, Airport]:
    raw = json.loads((DATA_DIR / "airports.json").read_text(encoding="utf-8"))
    return {item["code"]: Airport.model_validate(item) for item in raw}


@lru_cache
def load_airlines() -> dict[str, Airline]:
    raw = json.loads((DATA_DIR / "airlines.json").read_text(encoding="utf-8"))
    return {item["code"]: Airline.model_validate(item) for item in raw}


def get_airport(code: str) -> Airport:
    """Lấy sân bay nội địa theo mã IATA, báo lỗi nếu không hỗ trợ."""
    airport = load_airports().get(code.upper())
    if airport is None:
        raise InvalidRequestError(
            f"Sân bay '{code}' không nằm trong danh sách nội địa Việt Nam được hỗ trợ. "
            "Dùng search_airports để tra mã IATA."
        )
    return airport


def get_airline(code: str) -> Airline | None:
    return load_airlines().get(code.upper())


def find_airports(query: str, limit: int = 5) -> list[Airport]:
    """Tìm sân bay theo mã IATA, tên sân bay, thành phố, tỉnh hoặc tên gọi khác (không phân biệt dấu)."""
    needle = normalize_text(query)
    if not needle:
        return []
    airports = load_airports()
    exact = airports.get(query.strip().upper())
    matches = [exact] if exact else []
    for airport in airports.values():
        haystack = [airport.name, airport.city, airport.province, *airport.aliases]
        if airport not in matches and any(needle in normalize_text(text) for text in haystack):
            matches.append(airport)
    return matches[:limit]


def fare_rules_for(airline_code: str, cabin: CabinClass) -> FareRules:
    """Điều kiện vé giả lập theo hãng và hạng ghế."""
    airline = get_airline(airline_code)
    if airline is None:
        return DEFAULT_FARE_RULES
    key = "business" if cabin in ("business", "first") else "economy"
    return airline.fare_rules.get(key) or airline.fare_rules.get("economy") or DEFAULT_FARE_RULES


def distance_km(origin: Airport, destination: Airport) -> float:
    """Khoảng cách đường chim bay (công thức haversine)."""
    lat1, lon1, lat2, lon2 = map(math.radians, (origin.lat, origin.lon, destination.lat, destination.lon))
    a = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))
