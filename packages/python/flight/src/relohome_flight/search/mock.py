import random
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta

from relohome_flight.catalog import distance_km, get_airport, load_airlines
from relohome_flight.schemas import Airline, FlightOffer, FlightSearchRequest, PassengerCount, Segment
from relohome_flight.search.base import make_offer_id
from relohome_flight.settings import VN_TZ, FlightSettings, now_vn

HUBS = {"HAN", "SGN", "DAD"}
TRUNK_ROUTES = {
    frozenset(pair)
    for pair in [
        ("HAN", "SGN"), ("HAN", "DAD"), ("SGN", "DAD"), ("HAN", "PQC"), ("SGN", "PQC"),
        ("HAN", "CXR"), ("SGN", "CXR"), ("HAN", "DLI"), ("SGN", "HPH"), ("SGN", "VII"),
        ("HAN", "HUI"), ("SGN", "HUI"), ("HAN", "VCA"), ("SGN", "VDO"),
    ]
}  # fmt: skip
CABIN_FACTORS = {"economy": 1.0, "premium_economy": 1.6, "business": 2.8, "first": 4.0}
CHILD_FACTOR = 0.75
INFANT_FACTOR = 0.1
BASE_FARE = 450_000
FARE_PER_KM = 1_100
CRUISE_SPEED_KMH = 780
TAXI_MINUTES = 30
FIRST_DEPARTURE_MIN = 6 * 60
LAST_DEPARTURE_MIN = 21 * 60 + 30


@dataclass
class _MockFlight:
    airline: Airline
    flight_number: str
    departure: datetime
    duration_minutes: int
    fare_per_adult: int
    seats_left: int


def _round_thousand(value: float) -> int:
    return int(round(value / 1000) * 1000)


def total_fare(fare_per_adult: int, passengers: PassengerCount) -> int:
    """Tổng tiền: trẻ em 75%, em bé 10% giá người lớn."""
    units = passengers.adults + CHILD_FACTOR * passengers.children + INFANT_FACTOR * passengers.infants
    return _round_thousand(fare_per_adult * units)


class MockFlightSearch:
    """Sinh lịch bay nội địa giả lập, deterministic theo (tuyến, ngày, hãng).

    Chỉ có chuyến bay thẳng. Tuyến có ít nhất một đầu là HAN/SGN/DAD mới có chuyến;
    Bamboo và Vietravel chỉ bay các tuyến trục trong TRUNK_ROUTES.
    """

    name = "mock"

    def __init__(self, settings: FlightSettings, clock: Callable[[], datetime] = now_vn) -> None:
        self._offer_ttl = timedelta(minutes=settings.offer_ttl_minutes)
        self._clock = clock
        self._tokens: dict[str, str] = {}

    async def search(self, request: FlightSearchRequest) -> list[FlightOffer]:
        one_way = self._one_way(request.model_copy(update={"trip_type": "one_way", "return_date": None}))
        if request.trip_type != "round_trip":
            return one_way
        returns = self._one_way(self._reverse(request))
        if not returns:
            return []
        cheapest_return = min(o.total_price for o in returns)
        outbound = []
        for o in one_way:
            offer = o.model_copy(
                update={
                    "offer_id": "off_mock_rto_" + o.offer_id.removeprefix("off_mock_"),
                    "kind": "round_trip_outbound",
                    "price_scope": "round_trip_from",
                    "total_price": o.total_price + cheapest_return,
                    "price_per_adult": None,
                }
            )
            self._tokens[offer.offer_id] = "mock:" + o.offer_id
            outbound.append(offer)
        return outbound

    def return_token(self, offer_id: str) -> str | None:
        return self._tokens.get(offer_id)

    async def search_returns(
        self, outbound: FlightOffer, token: str, request: FlightSearchRequest
    ) -> list[FlightOffer]:
        """Mock: giá hành trình = giá một chiều đi + giá một chiều về (dữ liệu giả lập, không phải giá thật)."""
        base = token.removeprefix("mock:")
        going = next(
            (
                o
                for o in self._one_way(request.model_copy(update={"trip_type": "one_way", "return_date": None}))
                if o.offer_id == base
            ),
            None,
        )
        if going is None:
            return []
        return [
            FlightOffer(
                offer_id=make_offer_id("off_mock_rt", outbound.offer_id, back.offer_id),
                source="mock",
                segments=outbound.segments,
                return_segments=back.segments,
                stops=0,
                total_duration_minutes=outbound.total_duration_minutes + back.total_duration_minutes,
                cabin_class=outbound.cabin_class,
                passengers=outbound.passengers,
                total_price=going.total_price + back.total_price,
                expires_at=min(outbound.expires_at, back.expires_at),
                kind="round_trip",
                price_scope="round_trip",
            )
            for back in self._one_way(self._reverse(request))
        ]

    @staticmethod
    def _reverse(request: FlightSearchRequest) -> FlightSearchRequest:
        return request.model_copy(
            update={
                "origin": request.destination,
                "destination": request.origin,
                "departure_date": request.return_date,
                "trip_type": "one_way",
                "return_date": None,
            }
        )

    def _one_way(self, request: FlightSearchRequest) -> list[FlightOffer]:
        route = frozenset((request.origin, request.destination))
        if not route & HUBS:
            return []
        airlines = [
            a
            for a in load_airlines().values()
            if request.cabin_class in a.cabins and (route in TRUNK_ROUTES or not a.trunk_only)
        ]
        offers = []
        for airline in airlines:
            for flight in self._generate_flights(airline, request):
                if flight.seats_left >= request.passengers.adults + request.passengers.children:
                    offers.append(self._to_offer(flight, request))
        return offers

    def _generate_flights(self, airline: Airline, request: FlightSearchRequest) -> list[_MockFlight]:
        origin, destination = get_airport(request.origin), get_airport(request.destination)
        rng = random.Random(f"{request.origin}-{request.destination}-{request.departure_date}-{airline.code}")
        distance = distance_km(origin, destination)
        duration = int(round((distance / CRUISE_SPEED_KMH * 60 + TAXI_MINUTES) / 5) * 5)
        count = rng.randint(1, 3) + (2 if frozenset((origin.code, destination.code)) in TRUNK_ROUTES else 0)
        slots = sorted(rng.sample(range(FIRST_DEPARTURE_MIN, LAST_DEPARTURE_MIN + 1, 5), count))
        numbers = rng.sample(range(100, 1000), count)
        weekend = 1.15 if request.departure_date.weekday() >= 5 else 1.0
        cabin = CABIN_FACTORS[request.cabin_class]
        day_start = datetime.combine(request.departure_date, datetime.min.time(), tzinfo=VN_TZ)
        return [
            _MockFlight(
                airline=airline,
                flight_number=f"{airline.code}{number}",
                departure=day_start + timedelta(minutes=slot),
                duration_minutes=duration,
                fare_per_adult=_round_thousand(
                    (BASE_FARE + distance * FARE_PER_KM)
                    * airline.price_factor
                    * cabin
                    * weekend
                    * rng.uniform(0.85, 1.3)
                ),
                seats_left=rng.randint(1, 9),
            )
            for slot, number in zip(slots, numbers, strict=True)
        ]

    def _to_offer(self, flight: _MockFlight, request: FlightSearchRequest) -> FlightOffer:
        segment = Segment(
            flight_number=flight.flight_number,
            airline_code=flight.airline.code,
            airline_name=flight.airline.name,
            origin=request.origin,
            destination=request.destination,
            departure_time=flight.departure,
            arrival_time=flight.departure + timedelta(minutes=flight.duration_minutes),
            duration_minutes=flight.duration_minutes,
            aircraft="Airbus A321",
        )
        pax = request.passengers
        return FlightOffer(
            offer_id=make_offer_id("off_mock", flight.flight_number, flight.departure, request.cabin_class, pax),
            source="mock",
            segments=[segment],
            stops=0,
            total_duration_minutes=flight.duration_minutes,
            cabin_class=request.cabin_class,
            passengers=pax,
            total_price=total_fare(flight.fare_per_adult, pax),
            price_per_adult=flight.fare_per_adult,
            seats_left=flight.seats_left,
            expires_at=self._clock() + self._offer_ttl,
        )
