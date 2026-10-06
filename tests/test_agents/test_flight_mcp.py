import pytest

from src.agents.tools import flight_mcp


@pytest.mark.asyncio
@pytest.mark.parametrize("simulation", [False, True])
async def test_langchain_loads_flight_tools_over_stdio(tmp_path, monkeypatch, simulation: bool) -> None:
    """Chạy server thật qua stdio (process con) và nạp tool bằng langchain-mcp-adapters."""
    monkeypatch.delenv("FLIGHT_MCP_URL", raising=False)
    monkeypatch.setenv("FLIGHT_SEARCH_PROVIDER", "mock")
    monkeypatch.setenv("FLIGHT_SIMULATION_ENABLED", str(simulation).lower())
    monkeypatch.setenv("FLIGHT_DB_PATH", str(tmp_path / "flights.db"))

    async with flight_mcp.flight_tools_session() as tools:
        names = {tool.name for tool in tools}
        airports = await next(t for t in tools if t.name == "search_airports").ainvoke({"query": "Phú Quốc"})

    expected = {"search_airports", "search_flights", "get_offer"}
    if simulation:
        expected |= {"hold_booking", "confirm_booking", "get_booking", "cancel_booking"}
    assert names == expected
    assert "PQC" in str(airports)
