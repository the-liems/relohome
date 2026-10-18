from typing import Any

import pytest
from mcp.client import Client
from mcp.shared.exceptions import MCPError
from relohome_flight.settings import FlightSettings
from relohome_flights_mcp.server import create_server
from relohome_flights_mcp.tools import FlightServices

from tests.test_mcp_flights.helpers import FLIGHT_DAY, FakeClock

READ_ONLY_TOOLS = {"search_airports", "search_flights", "search_return_flights", "get_offer"}
SIMULATION_TOOLS = {
    "hold_booking",
    "confirm_booking",
    "get_booking",
    "cancel_booking",
}
EXPECTED_TOOLS = READ_ONLY_TOOLS | SIMULATION_TOOLS
PASSENGER = {
    "type": "adult",
    "title": "MS",
    "first_name": "Thị Lan",
    "last_name": "Phạm",
    "date_of_birth": "1995-03-08",
}
CONTACT = {"email": "lan@example.com", "phone": "+84901234567"}


async def call(session: Client, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    result = await session.call_tool(name, arguments)
    assert not result.is_error, result.content
    assert result.structured_content is not None
    return result.structured_content


async def first_offer_id(session: Client) -> str:
    request = {"origin": "han", "destination": "DAD", "departure_date": FLIGHT_DAY.isoformat()}
    found = await call(session, "search_flights", {"request": request})
    return found["offers"][0]["offer_id"]


@pytest.mark.asyncio
@pytest.mark.parametrize("simulation", [False, True])
async def test_lists_tools_with_annotations(
    services: FlightServices, settings: FlightSettings, simulation: bool
) -> None:
    settings = settings.model_copy(update={"simulation_enabled": simulation})
    async with Client(create_server(services, settings=settings)) as session:
        tools = {t.name: t for t in (await session.list_tools()).tools}
    assert set(tools) == (EXPECTED_TOOLS if simulation else READ_ONLY_TOOLS)
    for name in READ_ONLY_TOOLS:
        assert tools[name].annotations.read_only_hint is True
    if simulation:
        for name in {"hold_booking", "confirm_booking", "cancel_booking"}:
            assert tools[name].annotations.read_only_hint is False
        assert tools["confirm_booking"].annotations.destructive_hint is True
        assert tools["get_booking"].annotations.read_only_hint is True
    assert tools["search_flights"].output_schema is not None


@pytest.mark.asyncio
async def test_full_booking_flow(services: FlightServices, settings: FlightSettings) -> None:
    async with Client(create_server(services, settings=settings)) as session:
        assert (await call(session, "search_airports", {"query": "đà nẵng"}))["result"][0]["code"] == "DAD"
        offer_id = await first_offer_id(session)
        detail = await call(session, "get_offer", {"offer_id": offer_id})
        assert "fare_rules" in detail

        hold = {"offer_id": offer_id, "passengers": [PASSENGER], "contact": CONTACT}
        held = await call(session, "hold_booking", {"request": hold})
        assert held["status"] == "HELD" and held["passengers"][0]["last_name"] == "PHAM"
        resource = await session.read_resource(f"flights://bookings/{held['pnr']}")
        assert held["booking_id"] in resource.contents[0].text

        ticketed = await call(session, "confirm_booking", {"booking_ref": held["pnr"]})
        assert ticketed["status"] == "TICKETED" and len(ticketed["ticket_numbers"]) == 1

        quote = await call(session, "cancel_booking", {"booking_ref": held["booking_id"]})
        assert quote["cancelled"] is False
        fetched = await call(session, "get_booking", {"booking_ref": held["booking_id"]})
        assert fetched["status"] == "TICKETED"


@pytest.mark.asyncio
async def test_errors_are_returned_as_tool_errors(services: FlightServices, settings: FlightSettings) -> None:
    async with Client(create_server(services, settings=settings)) as session:
        bad_airport = await session.call_tool(
            "search_flights",
            {"request": {"origin": "HAN", "destination": "BKK", "departure_date": FLIGHT_DAY.isoformat()}},
        )
        missing = await session.call_tool("confirm_booking", {"booking_ref": "NOPE00"})
    assert bad_airport.is_error and "search_airports" in bad_airport.content[0].text
    assert missing.is_error and "Không tìm thấy booking" in missing.content[0].text


@pytest.mark.asyncio
async def test_expired_offer_cannot_be_held(
    services: FlightServices, clock: FakeClock, settings: FlightSettings
) -> None:
    async with Client(create_server(services, settings=settings)) as session:
        offer_id = await first_offer_id(session)
        clock.advance(31)
        hold = {"offer_id": offer_id, "passengers": [PASSENGER], "contact": CONTACT}
        result = await session.call_tool("hold_booking", {"request": hold})
    assert result.is_error and "hết hạn" in result.content[0].text


@pytest.mark.asyncio
async def test_resources_and_prompt(services: FlightServices, settings: FlightSettings) -> None:
    async with Client(create_server(services, settings=settings)) as session:
        airports = await session.read_resource("flights://airports")
        prompt = await session.get_prompt(
            "plan_domestic_trip", {"origin": "Hà Nội", "destination": "Phú Quốc", "departure_date": "2026-10-10"}
        )
    assert '"PQC"' in airports.contents[0].text
    assert "confirm_booking" in prompt.messages[0].content.text


@pytest.mark.asyncio
async def test_search_only_mode_excludes_simulated_booking_contract(
    services: FlightServices, settings: FlightSettings
) -> None:
    # Search provider selection must not implicitly authorize simulated writes.
    settings = settings.model_copy(update={"simulation_enabled": False})
    async with Client(create_server(services, settings=settings)) as session:
        offer_id = await first_offer_id(session)
        assert (await call(session, "get_offer", {"offer_id": offer_id}))["offer"]["offer_id"] == offer_id
        assert {str(r.uri) for r in (await session.list_resources()).resources} == {
            "flights://airports",
            "flights://airlines",
        }
        assert (await session.list_resource_templates()).resource_templates == []
        assert (await session.list_prompts()).prompts == []
        for name in SIMULATION_TOOLS:
            denied = await session.call_tool(name, {})
            assert denied.is_error and f"Unknown tool: {name}" in denied.content[0].text
        with pytest.raises(MCPError):
            await session.get_prompt(
                "plan_domestic_trip",
                {"origin": "HAN", "destination": "DAD", "departure_date": FLIGHT_DAY.isoformat()},
            )
        with pytest.raises(MCPError, match=r"[Rr]esource"):
            await session.read_resource("flights://bookings/NOPE00")
