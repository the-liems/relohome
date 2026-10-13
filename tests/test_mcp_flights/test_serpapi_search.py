import json
import logging
from pathlib import Path
from typing import Any

import httpx
import pytest
from relohome_flight.errors import ProviderUnavailableError
from relohome_flight.search import SerpApiFlightSearch
from relohome_flight.search.serpapi import build_params
from relohome_flight.settings import FlightSettings
from relohome_flight.storage import FlightDatabase, SearchCache

from tests.test_mcp_flights.helpers import make_search

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "serpapi_han_sgn.json").read_text(encoding="utf-8"))


class FakeSerpApi:
    """Giả lập endpoint SerpApi, đếm số lần bị gọi."""

    def __init__(self, status: int = 200, body: dict[str, Any] | None = None) -> None:
        self.status = status
        self.body = FIXTURE if body is None else body
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return httpx.Response(self.status, json=self.body)

    def client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=httpx.MockTransport(self))


def make_provider(settings: FlightSettings, fake: FakeSerpApi, cache: SearchCache | None = None) -> SerpApiFlightSearch:
    return SerpApiFlightSearch(settings, cache=cache, client=fake.client())


def test_build_params_maps_request() -> None:
    params = build_params(
        make_search(cabin_class="business", nonstop_only=True, passengers={"adults": 2, "infants": 1})
    )
    assert params["departure_id"] == "HAN" and params["type"] == 2
    assert (params["travel_class"], params["stops"], params["infants_on_lap"]) == (3, 1, 1)
    assert "api_key" not in params


@pytest.mark.asyncio
async def test_parses_offers_and_skips_items_without_price(settings: FlightSettings) -> None:
    fake = FakeSerpApi()
    offers = await make_provider(settings, fake).search(make_search())

    assert [o.segments[0].flight_number for o in offers] == ["VJ121", "VN207", "QH101"]
    connecting = offers[2]
    assert connecting.stops == 1 and connecting.segments[1].destination == "SGN"
    assert offers[0].segments[0].departure_time.utcoffset().total_seconds() == 7 * 3600
    assert fake.requests[0].url.params["api_key"] == "test-key"


@pytest.mark.asyncio
async def test_cache_avoids_second_call(settings: FlightSettings, db: FlightDatabase) -> None:
    fake = FakeSerpApi()
    provider = make_provider(settings, fake, cache=SearchCache(db, ttl_seconds=60))
    await provider.search(make_search())
    await provider.search(make_search())
    assert len(fake.requests) == 1


@pytest.mark.asyncio
async def test_no_results_returns_empty_list(settings: FlightSettings) -> None:
    fake = FakeSerpApi(body={"error": "Google Flights hasn't returned any results for this query."})
    assert await make_provider(settings, fake).search(make_search()) == []


@pytest.mark.asyncio
@pytest.mark.parametrize(("status", "message"), [(401, "không hợp lệ"), (429, "hết lượt"), (400, "Invalid")])
async def test_http_errors_are_mapped(settings: FlightSettings, status: int, message: str) -> None:
    fake = FakeSerpApi(status=status, body={"error": "Invalid departure_id"})
    with pytest.raises(ProviderUnavailableError, match=message):
        await make_provider(settings, fake).search(make_search())


@pytest.mark.asyncio
async def test_api_key_is_not_logged(settings: FlightSettings, caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    await make_provider(settings, FakeSerpApi()).search(make_search())
    assert "test-key" not in caplog.text


@pytest.mark.asyncio
async def test_connection_error_does_not_leak_api_key(settings: FlightSettings) -> None:
    def fail(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError(f"cannot reach {request.url}")

    provider = SerpApiFlightSearch(settings, client=httpx.AsyncClient(transport=httpx.MockTransport(fail)))
    with pytest.raises(ProviderUnavailableError) as exc_info:
        await provider.search(make_search())
    assert "test-key" not in str(exc_info.value)
