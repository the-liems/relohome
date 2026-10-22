"""Flight business errors reach the backend client as structured codes, not guessed text."""

from contextlib import aclosing

import pytest
from relohome_agent.services.adapters.mcp import McpEndpoint, McpToolClient, ToolCallError
from relohome_flight.settings import FlightSettings
from relohome_flights_mcp.server import create_server

from tests.mcp_http import TEST_MCP_TOKEN, running_mcp


@pytest.mark.asyncio
async def test_flight_business_errors_arrive_as_structured_codes(tmp_path):
    settings = FlightSettings(
        _env_file=None, search_provider="mock", simulation_enabled=True, db_path=str(tmp_path / "flights.db")
    )
    async with running_mcp(create_server(settings=settings)) as url:
        client = McpToolClient(McpEndpoint("flight", frozenset({"confirm_booking"}), url=url, token=TEST_MCP_TOKEN))
        with pytest.raises(ToolCallError) as missing:
            async with aclosing(client):
                await client.call("confirm_booking", {"booking_ref": "NOPE00"})
    assert (missing.value.code, missing.value.retryable) == ("BOOKING_NOT_FOUND", False)
    assert "Không tìm thấy booking" in missing.value.message
