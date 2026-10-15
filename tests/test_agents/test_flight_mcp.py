from contextlib import AsyncExitStack

import pytest
from relohome_agent.agents.tools import flight_mcp
from relohome_flight.settings import FlightSettings
from relohome_flights_mcp.server import create_server

from tests.mcp_http import TEST_MCP_TOKEN, running_mcp


@pytest.mark.asyncio
@pytest.mark.parametrize("simulation", [False, True])
@pytest.mark.parametrize("discovery_only", [False, True])
async def test_langchain_loads_flight_tools_over_http(tmp_path, monkeypatch, simulation: bool, discovery_only: bool) -> None:
    """Load LangChain tools from an independently running HTTP server."""
    server = create_server(settings=FlightSettings(
        _env_file=None, search_provider="mock", simulation_enabled=simulation, db_path=str(tmp_path / "flights.db")
    ))
    async with running_mcp(server) as url:
        monkeypatch.setenv("FLIGHT_MCP_URL", url)
        monkeypatch.setenv("FLIGHT_MCP_AUTH_TOKEN", TEST_MCP_TOKEN)
        async with AsyncExitStack() as stack:
            tools = (await flight_mcp.get_flight_tools() if discovery_only else
                     await stack.enter_async_context(flight_mcp.flight_tools_session()))
            names = {tool.name for tool in tools}
            airports = await next(t for t in tools if t.name == "search_airports").ainvoke({"query": "Phú Quốc"})

    expected = {"search_airports", "search_flights", "search_return_flights", "get_offer"}
    if simulation:
        expected |= {"hold_booking", "confirm_booking", "get_booking", "cancel_booking"}
    assert names == expected
    assert "PQC" in str(airports)
