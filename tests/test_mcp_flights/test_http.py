import pytest
from relohome_flight.settings import FlightSettings
from relohome_flights_mcp.server import SERVER_NAME, create_server
from relohome_flights_mcp.tools import FlightServices
from relohome_mcp_http import create_http_app
from starlette.testclient import TestClient

from tests.mcp_http import TEST_MCP_TOKEN


def test_health_route_reports_provider(services: FlightServices, settings: FlightSettings) -> None:
    client = TestClient(create_http_app(create_server(services, settings=settings), TEST_MCP_TOKEN))

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "server": SERVER_NAME, "provider": "mock"}


@pytest.mark.parametrize("host, rejected", [("127.0.0.1", True), ("0.0.0.0", False)])
def test_transport_host_security(services: FlightServices, settings: FlightSettings, host, rejected) -> None:
    server = create_server(services, settings=settings)
    with TestClient(create_http_app(server, TEST_MCP_TOKEN, host=host)) as client:
        response = client.post("/mcp", headers={
            "Host": "flights-mcp:8765", "Authorization": f"Bearer {TEST_MCP_TOKEN}",
        }, json={})
    assert (response.status_code == 421) is rejected

