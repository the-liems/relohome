import pytest

from src.agents.tools import flight_mcp


@pytest.mark.asyncio
async def test_langchain_loads_flight_tools_over_stdio(tmp_path, monkeypatch) -> None:
    """Chạy server thật qua stdio (process con) và nạp tool bằng langchain-mcp-adapters."""
    monkeypatch.setenv("FLIGHT_SEARCH_PROVIDER", "mock")
    monkeypatch.setenv("FLIGHT_DB_PATH", str(tmp_path / "flights.db"))

    async with flight_mcp.flight_tools_session() as tools:
        names = {tool.name for tool in tools}
        airports = await next(t for t in tools if t.name == "search_airports").ainvoke({"query": "Phú Quốc"})

    assert {"search_flights", "hold_booking", "confirm_booking"} <= names
    assert "PQC" in str(airports)
