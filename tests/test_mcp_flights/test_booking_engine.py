from datetime import date

import pytest
from relohome_flight.errors import BookingNotFoundError, BookingStateError, InvalidRequestError
from relohome_flight.schemas import FlightOffer, Passenger
from relohome_flight.search import MockFlightSearch
from relohome_flights_mcp.tools import FlightServices

from tests.test_mcp_flights.helpers import FakeClock, adult, make_hold, make_search


async def find_offer(services: FlightServices, airline: str, **search: object) -> FlightOffer:
    assert isinstance(services.provider, MockFlightSearch)
    offers = await services.provider.search(make_search(**search))
    return next(o for o in offers if o.segments[0].airline_code == airline)


@pytest.mark.asyncio
async def test_hold_confirm_flow_is_idempotent(services: FlightServices) -> None:
    offer = await find_offer(services, "VN")
    held = services.bookings.hold(offer, make_hold(offer.offer_id))
    assert held.status == "HELD" and len(held.pnr) == 6

    ticketed = services.bookings.confirm(held.booking_id)
    again = services.bookings.confirm(held.pnr.lower())
    assert ticketed.status == "TICKETED"
    assert ticketed.ticket_numbers[0].startswith("738-")
    assert again.ticket_numbers == ticketed.ticket_numbers


@pytest.mark.asyncio
async def test_repeated_hold_returns_same_booking(services: FlightServices) -> None:
    offer = await find_offer(services, "VJ")
    first = services.bookings.hold(offer, make_hold(offer.offer_id))
    second = services.bookings.hold(offer, make_hold(offer.offer_id))
    assert first.booking_id == second.booking_id


@pytest.mark.asyncio
async def test_expired_hold_cannot_be_ticketed(services: FlightServices, clock: FakeClock) -> None:
    offer = await find_offer(services, "VJ")
    held = services.bookings.hold(offer, make_hold(offer.offer_id))
    clock.advance(16)
    assert services.bookings.get(held.booking_id).status == "EXPIRED"
    with pytest.raises(BookingStateError):
        services.bookings.confirm(held.booking_id)


@pytest.mark.asyncio
async def test_passenger_mix_must_match_offer(services: FlightServices) -> None:
    offer = await find_offer(services, "VJ", passengers={"adults": 2})
    with pytest.raises(InvalidRequestError, match="2 người lớn"):
        services.bookings.hold(offer, make_hold(offer.offer_id))


@pytest.mark.asyncio
async def test_passenger_age_must_match_type(services: FlightServices) -> None:
    offer = await find_offer(services, "VJ", passengers={"adults": 1, "children": 1})
    too_old_child = Passenger(
        type="child", title="MSTR", first_name="Minh", last_name="Nguyen", date_of_birth=date(2010, 1, 1)
    )
    with pytest.raises(InvalidRequestError, match="tuổi"):
        services.bookings.hold(offer, make_hold(offer.offer_id, [adult(), too_old_child]))


@pytest.mark.asyncio
async def test_cancel_held_booking_is_free(services: FlightServices) -> None:
    offer = await find_offer(services, "VJ")
    held = services.bookings.hold(offer, make_hold(offer.offer_id))
    quote = services.bookings.cancel(held.booking_id)
    assert (quote.cancelled, quote.cancel_fee, quote.status) == (False, 0, "HELD")
    done = services.bookings.cancel(held.booking_id, confirm=True)
    assert (done.cancelled, done.status) == (True, "CANCELLED")


@pytest.mark.asyncio
async def test_cancel_refundable_ticket_charges_fee_per_passenger(services: FlightServices) -> None:
    offer = await find_offer(services, "VN", passengers={"adults": 2})
    request = make_hold(offer.offer_id, [adult(), adult(first="Thi Binh", last="Tran")])
    booking = services.bookings.confirm(services.bookings.hold(offer, request).booking_id)
    result = services.bookings.cancel(booking.booking_id, confirm=True)
    assert result.cancel_fee == min(booking.total_price, 2 * 500_000)
    assert result.refund_amount == booking.total_price - result.cancel_fee


@pytest.mark.asyncio
async def test_non_refundable_ticket_refunds_nothing(services: FlightServices) -> None:
    offer = await find_offer(services, "VJ")
    booking = services.bookings.confirm(services.bookings.hold(offer, make_hold(offer.offer_id)).booking_id)
    quote = services.bookings.cancel(booking.pnr)
    assert quote.refund_amount == 0 and quote.cancel_fee == booking.total_price


def test_unknown_booking_raises(services: FlightServices) -> None:
    with pytest.raises(BookingNotFoundError):
        services.bookings.get("ABC123")
