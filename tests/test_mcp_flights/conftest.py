from collections.abc import Iterator

import pytest

from src.mcp_servers.flights.booking_engine import BookingEngine
from src.mcp_servers.flights.search import MockFlightSearch
from src.mcp_servers.flights.settings import FlightSettings
from src.mcp_servers.flights.storage import FlightDatabase, OfferCache
from src.mcp_servers.flights.tools import FlightServices, FlightTools
from tests.test_mcp_flights.helpers import FakeClock


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def settings() -> FlightSettings:
    # _env_file=None: không đọc .env của máy dev để test luôn chạy với mock
    return FlightSettings(_env_file=None, db_path=":memory:", search_provider="mock", serpapi_api_key="test-key")


@pytest.fixture
def db() -> Iterator[FlightDatabase]:
    database = FlightDatabase(":memory:")
    yield database
    database.close()


@pytest.fixture
def services(settings: FlightSettings, db: FlightDatabase, clock: FakeClock) -> FlightServices:
    return FlightServices(
        provider=MockFlightSearch(settings, clock=clock),
        offers=OfferCache(db, clock=clock),
        bookings=BookingEngine(db, hold_minutes=settings.hold_minutes, clock=clock),
        clock=clock,
    )


@pytest.fixture
def tools(services: FlightServices) -> FlightTools:
    return FlightTools(services)
