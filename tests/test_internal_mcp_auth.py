"""Python and TypeScript use these same internal authentication vectors."""

import json
from pathlib import Path

import pytest
from starlette.applications import Starlette
from starlette.testclient import TestClient

from src.mcp_servers.http_service import (
    HttpServiceMCP,
    ServiceTokenMiddleware,
    require_service_token,
    valid_bearer_token,
)

CASES = json.loads((Path(__file__).parent / "fixtures/internal-mcp-auth.json").read_text())


@pytest.mark.parametrize("case", CASES["headers"], ids=lambda case: case["name"])
def test_bearer_contract(case):
    assert valid_bearer_token(case["header"], CASES["token"]) is case["valid"]


@pytest.mark.parametrize("token", CASES["invalid_tokens"])
def test_invalid_configuration_fails_before_serving(token):
    with pytest.raises(ValueError, match="MCP_AUTH_TOKEN"):
        HttpServiceMCP("auth-test", service_token=token).streamable_http_app()


def test_valid_configuration():
    assert require_service_token(CASES["token"]) == CASES["token"]


@pytest.mark.parametrize("headers", [[], [("Authorization", "Bearer wrong")], [
    ("Authorization", f"Bearer {CASES['token']}"), ("Authorization", f"Bearer {CASES['token']}")
]])
def test_rejection_contract_and_duplicate_credentials(headers):
    app = Starlette()
    app.add_middleware(ServiceTokenMiddleware, token=CASES["token"])
    with TestClient(app) as client:
        response = client.post("/mcp", headers=headers)
    assert response.status_code == 401
    assert response.json() == {"status": "error", "code": "UNAUTHORIZED"}
    assert response.headers["www-authenticate"] == "Bearer"
    assert response.headers["cache-control"] == "no-store"
