"""Khứ hồi: chiều đi trả giá khứ hồi thấp nhất, chiều về trả giá cả hành trình; booking chỉ lưu tham chiếu."""

from datetime import date, timedelta
from typing import Any

import httpx
import pytest
from pydantic import ValidationError
from relohome_flight.booking_engine import BookingEngine
from relohome_flight.errors import InvalidRequestError
from relohome_flight.schemas import FlightSearchRequest
from relohome_flight.search import SerpApiFlightSearch
from relohome_flight.search.serpapi import build_params
from relohome_flight.settings import FlightSettings
from relohome_flight.storage import FlightDatabase, OfferCache
from relohome_flights_mcp.tools import FlightServices, FlightTools

from tests.test_mcp_flights.helpers import FLIGHT_DAY, adult, make_hold, make_search

RETURN_DAY = FLIGHT_DAY + timedelta(days=4)


def leg(number: str, origin: str, destination: str, depart: str, arrive: str) -> dict[str, Any]:
    return {
        "flight_number": number,
        "airline": "Vietjet",
        "departure_airport": {"id": origin, "time": depart},
        "arrival_airport": {"id": destination, "time": arrive},
        "duration": 80,
    }


OUTBOUND = {
    "best_flights": [
        {
            "flights": [leg("VJ 501", "HAN", "SGN", f"{FLIGHT_DAY} 05:40", f"{FLIGHT_DAY} 07:00")],
            "price": 1736842,
            "type": "Round trip",
            "departure_token": "token-501",
        },
        {
            # Không có token thì không lấy được chiều về: bỏ.
            "flights": [leg("VJ 503", "HAN", "SGN", f"{FLIGHT_DAY} 09:00", f"{FLIGHT_DAY} 10:20")],
            "price": 1800000,
            "type": "Round trip",
        },
    ]
}
RETURNS = {
    "best_flights": [
        {
            "flights": [leg("VJ 528", "SGN", "HAN", f"{RETURN_DAY} 16:05", f"{RETURN_DAY} 17:25")],
            "price": 1736842,
            "type": "Round trip",
        }
    ],
    "other_flights": [
        {
            "flights": [leg("VJ 508", "SGN", "HAN", f"{RETURN_DAY} 14:05", f"{RETURN_DAY} 15:25")],
            "price": 1952842,
            "type": "Round trip",
        }
    ],
}


class FakeSerpApi:
    def __init__(self, returns: dict[str, Any] | None = None) -> None:
        self.requests: list[httpx.Request] = []
        self.returns = RETURNS if returns is None else returns

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        body = self.returns if request.url.params.get("departure_token") else OUTBOUND
        return httpx.Response(200, json=body)


def serpapi_tools(
    settings: FlightSettings, db: FlightDatabase, clock, returns: dict[str, Any] | None = None
) -> tuple[FlightTools, FakeSerpApi]:
    fake = FakeSerpApi(returns)
    provider = SerpApiFlightSearch(settings, client=httpx.AsyncClient(transport=httpx.MockTransport(fake)))
    services = FlightServices(
        provider=provider,
        offers=OfferCache(db, clock=clock),
        bookings=BookingEngine(db, hold_minutes=15, clock=clock),
        clock=clock,
    )
    return FlightTools(services), fake


def round_trip(**overrides: object) -> FlightSearchRequest:
    return make_search(trip_type="round_trip", return_date=RETURN_DAY, **overrides)


def test_round_trip_request_needs_valid_return_date() -> None:
    with pytest.raises(ValidationError):
        make_search(trip_type="round_trip")
    with pytest.raises(ValidationError):
        make_search(trip_type="round_trip", return_date=FLIGHT_DAY - timedelta(days=1))
    with pytest.raises(ValidationError):
        make_search(return_date=RETURN_DAY)
    params = build_params(round_trip())
    assert params["type"] == 1 and params["return_date"] == RETURN_DAY.isoformat()
    assert build_params(make_search())["type"] == 2 and "return_date" not in build_params(make_search())


@pytest.mark.asyncio
async def test_serpapi_round_trip_outbound_then_itinerary(settings, db, clock) -> None:
    tools, fake = serpapi_tools(settings, db, clock)
    found = await tools.search_flights(round_trip())
    assert [o.kind for o in found.offers] == ["round_trip_outbound"]
    outbound = found.offers[0]
    assert outbound.price_scope == "round_trip_from" and outbound.total_price == 1736842
    # Token chỉ nằm phía server.
    assert "token-501" not in found.model_dump_json()

    returns = await tools.search_return_flights(outbound.offer_id)
    assert fake.requests[-1].url.params["departure_token"] == "token-501"
    itinerary = returns.offers[0]
    assert itinerary.kind == "round_trip" and itinerary.price_scope == "round_trip"
    # Giá hành trình do nguồn trả, không cộng giá chiều đi.
    assert itinerary.total_price == 1736842
    assert itinerary.segments == outbound.segments and itinerary.return_segments[0].flight_number == "VJ528"
    assert (await tools.get_offer(itinerary.offer_id)).offer.return_segments


@pytest.mark.asyncio
async def test_return_must_leave_after_outbound_arrival(settings, db, clock) -> None:
    same_day_returns = {
        "best_flights": [
            {
                "flights": [leg("VJ 520", "SGN", "HAN", f"{FLIGHT_DAY} 08:00", f"{FLIGHT_DAY} 09:20")],
                "price": 1500000,
            },
            {
                "flights": [leg("VJ 522", "SGN", "HAN", f"{FLIGHT_DAY} 09:10", f"{FLIGHT_DAY} 10:30")],
                "price": 1600000,
            },
        ]
    }
    tools, _ = serpapi_tools(settings, db, clock, same_day_returns)
    tools._s.round_trip_min_gap_minutes = 120
    same_day = make_search(trip_type="round_trip", return_date=FLIGHT_DAY)
    outbound = (await tools.search_flights(same_day)).offers[0]  # hạ cánh 07:00
    returns = await tools.search_return_flights(outbound.offer_id)
    # 08:00 < 07:00 + 120 phút nên bị bỏ; 09:10 được giữ.
    assert [o.return_segments[0].flight_number for o in returns.offers] == ["VJ522"]


@pytest.mark.asyncio
async def test_one_way_offer_has_no_returns(tools) -> None:
    offer = (await tools.search_flights(make_search())).offers[0]
    with pytest.raises(InvalidRequestError):
        await tools.search_return_flights(offer.offer_id)


@pytest.mark.asyncio
async def test_mock_round_trip_and_anonymous_hold(tools) -> None:
    outbound = (await tools.search_flights(round_trip(destination="DAD"))).offers[0]
    assert outbound.kind == "round_trip_outbound"
    itinerary = (await tools.search_return_flights(outbound.offer_id)).offers[0]
    request = make_hold(itinerary.offer_id).model_copy(update={"passenger_ref": "pii_ref_1"})
    booking = await tools.hold_booking(request)
    stored = (await tools.get_booking(booking.booking_id)).model_dump_json()
    # Booking chỉ giữ tham chiếu và số khách; không lưu tên, ngày sinh hay liên hệ.
    assert booking.passenger_ref == "pii_ref_1" and booking.passengers == [] and booking.contact is None
    assert "NGUYEN" not in stored and "khach@example.com" not in stored
    # Gọi lại cùng tham chiếu không giữ chỗ lần hai.
    assert (await tools.hold_booking(request)).booking_id == booking.booking_id
    ticketed = await tools.confirm_booking(booking.booking_id)
    assert ticketed.status == "TICKETED" and len(ticketed.ticket_numbers) == 1


@pytest.mark.asyncio
async def test_named_hold_without_reference_keeps_legacy_behaviour(tools) -> None:
    offer = (await tools.search_flights(make_search())).offers[0]
    booking = await tools.hold_booking(make_hold(offer.offer_id, [adult()]))
    assert booking.passengers and booking.passenger_ref is None


def test_return_date_cannot_be_too_far(services) -> None:
    from relohome_flight.search import validate_search

    with pytest.raises(InvalidRequestError):
        validate_search(make_search(trip_type="round_trip", return_date=date(2027, 12, 31)), date(2026, 10, 1))
