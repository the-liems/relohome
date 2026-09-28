from typing import Any

import pytest
from mcp import ClientSession
from mcp.shared.memory import create_connected_server_and_client_session

from src.mcp_servers.flights.server import create_server
from src.mcp_servers.flights.tools import FlightServices
from tests.test_mcp_flights.helpers import FLIGHT_DAY, FakeClock

EXPECTED_TOOLS = {
    "search_airports",
    "search_flights",
    "get_offer",
    "hold_booking",
    "confirm_booking",
    "get_booking",
    "cancel_booking",
}
PASSENGER = {
    "type": "adult",
    "title": "MS",
    "first_name": "Thị Lan",
    "last_name": "Phạm",
    "date_of_birth": "1995-03-08",
}
CONTACT = {"email": "lan@example.com", "phone": "+84901234567"}


async def call(session: ClientSession, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    result = await session.call_tool(name, arguments)
    assert not result.isError, result.content
    assert result.structuredContent is not None
    return result.structuredContent


async def first_offer_id(session: ClientSession) -> str:
    request = {"origin": "han", "destination": "DAD", "departure_date": FLIGHT_DAY.isoformat()}
    found = await call(session, "search_flights", {"request": request})
    return found["offers"][0]["offer_id"]


@pytest.mark.asyncio
async def test_lists_tools_with_annotations(services: FlightServices) -> None:
    async with create_connected_server_and_client_session(create_server(services)) as session:
        tools = {t.name: t for t in (await session.list_tools()).tools}
    assert set(tools) == EXPECTED_TOOLS
    assert tools["search_flights"].annotations.readOnlyHint is True
    assert tools["confirm_booking"].annotations.destructiveHint is True
    assert tools["search_flights"].outputSchema is not None


@pytest.mark.asyncio
async def test_full_booking_flow(services: FlightServices) -> None:
    async with create_connected_server_and_client_session(create_server(services)) as session:
        assert (await call(session, "search_airports", {"query": "đà nẵng"}))["result"][0]["code"] == "DAD"
        offer_id = await first_offer_id(session)
        detail = await call(session, "get_offer", {"offer_id": offer_id})
        assert "fare_rules" in detail

        hold = {"offer_id": offer_id, "passengers": [PASSENGER], "contact": CONTACT}
        held = await call(session, "hold_booking", {"request": hold})
        assert held["status"] == "HELD" and held["passengers"][0]["last_name"] == "PHAM"

        ticketed = await call(session, "confirm_booking", {"booking_ref": held["pnr"]})
        assert ticketed["status"] == "TICKETED" and len(ticketed["ticket_numbers"]) == 1

        quote = await call(session, "cancel_booking", {"booking_ref": held["booking_id"]})
        assert quote["cancelled"] is False
        fetched = await call(session, "get_booking", {"booking_ref": held["booking_id"]})
        assert fetched["status"] == "TICKETED"


@pytest.mark.asyncio
async def test_errors_are_returned_as_tool_errors(services: FlightServices) -> None:
    async with create_connected_server_and_client_session(create_server(services)) as session:
        bad_airport = await session.call_tool(
            "search_flights",
            {"request": {"origin": "HAN", "destination": "BKK", "departure_date": FLIGHT_DAY.isoformat()}},
        )
        missing = await session.call_tool("confirm_booking", {"booking_ref": "NOPE00"})
    assert bad_airport.isError and "search_airports" in bad_airport.content[0].text
    assert missing.isError and "Không tìm thấy booking" in missing.content[0].text


@pytest.mark.asyncio
async def test_expired_offer_cannot_be_held(services: FlightServices, clock: FakeClock) -> None:
    async with create_connected_server_and_client_session(create_server(services)) as session:
        offer_id = await first_offer_id(session)
        clock.advance(31)
        hold = {"offer_id": offer_id, "passengers": [PASSENGER], "contact": CONTACT}
        result = await session.call_tool("hold_booking", {"request": hold})
    assert result.isError and "hết hạn" in result.content[0].text


@pytest.mark.asyncio
async def test_resources_and_prompt(services: FlightServices) -> None:
    async with create_connected_server_and_client_session(create_server(services)) as session:
        airports = await session.read_resource("flights://airports")
        prompt = await session.get_prompt(
            "plan_domestic_trip", {"origin": "Hà Nội", "destination": "Phú Quốc", "departure_date": "2026-10-10"}
        )
    assert '"PQC"' in airports.contents[0].text
    assert "confirm_booking" in prompt.messages[0].content.text
