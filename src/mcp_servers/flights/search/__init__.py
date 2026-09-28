from collections.abc import Callable
from datetime import datetime

from src.mcp_servers.flights.search.base import FlightSearchProvider, sort_and_limit, validate_search
from src.mcp_servers.flights.search.mock import MockFlightSearch
from src.mcp_servers.flights.search.serpapi import SerpApiFlightSearch
from src.mcp_servers.flights.settings import FlightSettings, now_vn
from src.mcp_servers.flights.storage import FlightDatabase, SearchCache

__all__ = [
    "FlightSearchProvider",
    "MockFlightSearch",
    "SerpApiFlightSearch",
    "create_search_provider",
    "sort_and_limit",
    "validate_search",
]


def create_search_provider(
    settings: FlightSettings, db: FlightDatabase, clock: Callable[[], datetime] = now_vn
) -> FlightSearchProvider:
    """Chọn provider theo FLIGHT_SEARCH_PROVIDER."""
    if settings.search_provider == "serpapi":
        if not settings.serpapi_api_key:
            raise ValueError("FLIGHT_SEARCH_PROVIDER=serpapi nhưng chưa đặt FLIGHT_SERPAPI_API_KEY")
        return SerpApiFlightSearch(settings, cache=SearchCache(db, settings.search_cache_ttl))
    return MockFlightSearch(settings, clock=clock)
