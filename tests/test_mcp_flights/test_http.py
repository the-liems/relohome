import pytest
from relohome_agent.agents.tools import flight_mcp
from relohome_flight.settings import FlightSettings
from relohome_flights_mcp.server import SERVER_NAME, create_server
from relohome_flights_mcp.tools import FlightServices
from starlette.testclient import TestClient

from tests.mcp_http import TEST_MCP_TOKEN


def test_health_route_reports_provider(services: FlightServices, settings: FlightSettings) -> None:
    client = TestClient(create_server(services, settings=settings.model_copy(update={"mcp_auth_token": TEST_MCP_TOKEN})).streamable_http_app())

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "server": SERVER_NAME, "provider": "mock"}


@pytest.mark.parametrize("host, rejected", [("127.0.0.1", True), ("0.0.0.0", False)])
def test_transport_host_security(services: FlightServices, settings: FlightSettings, host, rejected) -> None:
    server = create_server(services, host=host, port=8765,
                           settings=settings.model_copy(update={"mcp_auth_token": TEST_MCP_TOKEN}))
    with TestClient(server.streamable_http_app()) as client:
        response = client.post("/mcp", headers={
            "Host": "flights-mcp:8765", "Authorization": f"Bearer {TEST_MCP_TOKEN}",
        }, json={})
    assert (response.status_code == 421) is rejected
    assert (server.host, server.port) == (host, 8765)


def test_agent_uses_http_when_url_is_set(monkeypatch) -> None:
    monkeypatch.setenv("FLIGHT_MCP_URL", "http://flights-mcp:8765/mcp")

    assert flight_mcp.flight_server_connection().url == "http://flights-mcp:8765/mcp"


def test_agent_requires_service_url(monkeypatch) -> None:
    monkeypatch.delenv("FLIGHT_MCP_URL", raising=False)

    with pytest.raises(ValueError, match="FLIGHT_MCP_URL"):
        flight_mcp.flight_server_connection()
