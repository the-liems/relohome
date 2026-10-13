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


def test_loopback_host_only_accepts_localhost(services: FlightServices, settings: FlightSettings) -> None:
    security = create_server(services, settings=settings).settings.transport_security

    assert security is not None and security.enable_dns_rebinding_protection
    assert "localhost:*" in security.allowed_hosts


def test_container_host_accepts_docker_service_name(services: FlightServices, settings: FlightSettings) -> None:
    """Trong container (host 0.0.0.0) service khác gọi bằng Host `flights-mcp:8765` phải không bị chặn."""
    server = create_server(services, host="0.0.0.0", port=8765, settings=settings)

    assert server.settings.transport_security is None
    assert (server.settings.host, server.settings.port) == ("0.0.0.0", 8765)


def test_agent_uses_http_when_url_is_set(monkeypatch) -> None:
    monkeypatch.setenv("FLIGHT_MCP_URL", "http://flights-mcp:8765/mcp")

    assert flight_mcp.flight_server_connection() == {
        "transport": "streamable_http",
        "url": "http://flights-mcp:8765/mcp",
    }


def test_agent_requires_service_url(monkeypatch) -> None:
    monkeypatch.delenv("FLIGHT_MCP_URL", raising=False)

    with pytest.raises(ValueError, match="FLIGHT_MCP_URL"):
        flight_mcp.flight_server_connection()
