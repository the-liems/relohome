"""Exercise the SDK auth stack over HTTP with the shared bearer test vectors."""

import json
from pathlib import Path

import pytest
from mcp.server import MCPServer
from mcp.server.auth.middleware.auth_context import get_access_token
from relohome_mcp_http import create_http_app
from starlette.responses import JSONResponse
from starlette.testclient import TestClient

CASES = json.loads((Path(__file__).parent / "fixtures/internal-mcp-auth.json").read_text())


def auth_app():
    server = MCPServer("auth-test")

    @server.custom_route("/mcp/whoami", methods=["GET"])
    async def whoami(request):
        return JSONResponse({"client_id": get_access_token().client_id})

    @server.custom_route("/health", methods=["GET"])
    async def health(request):
        return JSONResponse({"status": "ok"})

    return create_http_app(server, CASES["token"])


@pytest.mark.parametrize("case", CASES["headers"], ids=lambda case: case["name"])
def test_bearer_contract(case):
    headers = {b"Authorization": case["header"].encode("utf-8")} if case["header"] is not None else {}
    with TestClient(auth_app()) as client:
        response = client.get("/mcp/whoami", headers=headers)
    assert response.status_code == (200 if case["valid"] else 401)
    if case["valid"]:
        assert response.json() == {"client_id": "internal-service"}
    else:
        assert response.json()["error"] == "invalid_token"
        assert response.headers["www-authenticate"].startswith("Bearer ")


@pytest.mark.parametrize("token", CASES["invalid_tokens"])
def test_invalid_configuration_fails_before_serving(token):
    with pytest.raises(ValueError, match="MCP_AUTH_TOKEN"):
        create_http_app(MCPServer("auth-test"), token)


def test_health_is_public_and_mcp_is_protected():
    with TestClient(auth_app()) as client:
        assert client.get("/health").status_code == 200
        assert client.post("/mcp", json={}).status_code == 401


@pytest.mark.parametrize("headers,status", [
    ([("Authorization", f"Bearer {CASES['token']}")] * 2, 400),
    ({"Authorization": f"Bearer {CASES['token']}", "Origin": "https://example.com"}, 403),
])
def test_rejects_ambiguous_credentials_and_browser_origins(headers, status):
    with TestClient(auth_app()) as client:
        response = client.get("/mcp/whoami", headers=headers)
    assert response.status_code == status
