from datetime import date, datetime, timedelta

from relohome_flight.schemas import Contact, FlightSearchRequest, HoldBookingRequest, Passenger
from relohome_flight.settings import VN_TZ

TODAY = date(2026, 10, 1)
FLIGHT_DAY = date(2026, 10, 10)


class FakeClock:
    """Đồng hồ điều khiển được để test hết hạn offer/giữ chỗ."""

    def __init__(self) -> None:
        self.now = datetime(TODAY.year, TODAY.month, TODAY.day, 9, 0, tzinfo=VN_TZ)

    def __call__(self) -> datetime:
        return self.now

    def advance(self, minutes: int) -> None:
        self.now += timedelta(minutes=minutes)


def make_search(**overrides: object) -> FlightSearchRequest:
    data: dict[str, object] = {"origin": "HAN", "destination": "SGN", "departure_date": FLIGHT_DAY}
    data.update(overrides)
    return FlightSearchRequest.model_validate(data)


def adult(first: str = "Van An", last: str = "Nguyen", born: date = date(1990, 1, 1)) -> Passenger:
    return Passenger(type="adult", title="MR", first_name=first, last_name=last, date_of_birth=born)


def make_hold(offer_id: str, passengers: list[Passenger] | None = None) -> HoldBookingRequest:
    return HoldBookingRequest(
        offer_id=offer_id,
        passengers=passengers or [adult()],
        contact=Contact(email="khach@example.com", phone="0901234567"),
    )
