from datetime import timedelta

import pytest
from relohome_flight.errors import InvalidRequestError
from relohome_flight.search import MockFlightSearch, sort_and_limit, validate_search
from relohome_flight.search.mock import total_fare
from relohome_flight.settings import FlightSettings

from tests.test_mcp_flights.helpers import TODAY, FakeClock, make_search


@pytest.fixture
def provider(settings: FlightSettings, clock: FakeClock) -> MockFlightSearch:
    return MockFlightSearch(settings, clock=clock)


@pytest.mark.asyncio
async def test_mock_is_deterministic(provider: MockFlightSearch) -> None:
    first = await provider.search(make_search())
    second = await provider.search(make_search())
    assert [o.offer_id for o in first] == [o.offer_id for o in second]
    assert len(first) > 0


@pytest.mark.asyncio
async def test_trunk_route_has_all_airlines(provider: MockFlightSearch) -> None:
    offers = await provider.search(make_search())
    assert {o.segments[0].airline_code for o in offers} == {"VN", "VJ", "QH", "VU", "9G"}


@pytest.mark.asyncio
async def test_regional_route_only_has_full_service_airlines(provider: MockFlightSearch) -> None:
    offers = await provider.search(make_search(destination="BMV"))
    assert offers
    assert {o.segments[0].airline_code for o in offers} <= {"VN", "VJ"}


@pytest.mark.asyncio
async def test_route_without_hub_has_no_flights(provider: MockFlightSearch) -> None:
    assert await provider.search(make_search(origin="HPH", destination="VII")) == []


@pytest.mark.asyncio
async def test_business_cabin_excludes_economy_only_airline(provider: MockFlightSearch) -> None:
    offers = await provider.search(make_search(cabin_class="business"))
    airlines = {o.segments[0].airline_code for o in offers}
    assert airlines and not airlines & {"VU", "9G"}


@pytest.mark.asyncio
async def test_offer_price_matches_passenger_mix(provider: MockFlightSearch) -> None:
    pax = {"adults": 2, "children": 1, "infants": 1}
    offer = (await provider.search(make_search(passengers=pax)))[0]
    assert offer.total_price == total_fare(offer.price_per_adult or 0, offer.passengers)
    assert offer.total_price > 2 * (offer.price_per_adult or 0)


@pytest.mark.asyncio
async def test_sort_and_limit_by_price(provider: MockFlightSearch) -> None:
    request = make_search(max_results=3)
    offers = sort_and_limit(await provider.search(request), request)
    assert len(offers) == 3
    assert [o.total_price for o in offers] == sorted(o.total_price for o in offers)


def test_validate_search_rejects_past_and_far_dates() -> None:
    with pytest.raises(InvalidRequestError, match="đã qua"):
        validate_search(make_search(departure_date=TODAY - timedelta(days=1)), TODAY)
    with pytest.raises(InvalidRequestError, match="330"):
        validate_search(make_search(departure_date=TODAY + timedelta(days=400)), TODAY)
