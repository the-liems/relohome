from datetime import date

import pytest
from pydantic import ValidationError
from relohome_flight.catalog import distance_km, fare_rules_for, find_airports, get_airport
from relohome_flight.errors import InvalidRequestError
from relohome_flight.schemas import FlightSearchRequest, PassengerCount

from tests.test_mcp_flights.helpers import FLIGHT_DAY, adult


@pytest.mark.parametrize(
    ("query", "expected"),
    [("Đà Nẵng", "DAD"), ("da nang", "DAD"), ("sài gòn", "SGN"), ("hcm", "SGN"), ("pqc", "PQC"), ("Nha Trang", "CXR")],
)
def test_find_airports_ignores_accents_and_case(query: str, expected: str) -> None:
    assert find_airports(query)[0].code == expected


def test_find_airports_empty_query_returns_nothing() -> None:
    assert find_airports("   ") == []


def test_get_airport_rejects_non_domestic_code() -> None:
    with pytest.raises(InvalidRequestError, match="BKK"):
        get_airport("BKK")


def test_distance_han_sgn_is_realistic() -> None:
    assert 1100 < distance_km(get_airport("HAN"), get_airport("SGN")) < 1200


def test_fare_rules_fall_back_for_unknown_airline_and_business() -> None:
    assert fare_rules_for("ZZ", "economy").refundable is False
    assert fare_rules_for("VJ", "first").checked_baggage_kg == 30  # first -> quy về business


def test_sun_phuquoc_airways_has_own_fare_rules() -> None:
    # 9G có trong dữ liệu SerpApi thật, không được rơi vào DEFAULT_FARE_RULES
    assert fare_rules_for("9G", "economy").checked_baggage_kg == 20


def test_search_request_normalizes_codes() -> None:
    request = FlightSearchRequest(origin="han", destination="sgn", departure_date=FLIGHT_DAY)
    assert (request.origin, request.destination) == ("HAN", "SGN")


def test_search_request_rejects_same_origin_and_destination() -> None:
    with pytest.raises(ValidationError):
        FlightSearchRequest(origin="HAN", destination="han", departure_date=FLIGHT_DAY)


@pytest.mark.parametrize("counts", [{"adults": 1, "infants": 2}, {"adults": 5, "children": 5}, {"adults": 0}])
def test_passenger_count_rules(counts: dict[str, int]) -> None:
    with pytest.raises(ValidationError):
        PassengerCount(**counts)


def test_passenger_name_is_uppercased_without_accents() -> None:
    passenger = adult(first="  Thị   Bích ", last="Đặng")
    assert (passenger.first_name, passenger.last_name) == ("THI BICH", "DANG")


def test_passenger_name_rejects_digits() -> None:
    with pytest.raises(ValidationError):
        adult(first="An 2", born=date(1990, 1, 1))
