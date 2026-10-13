"""Installed demo imports and first render stay offline and preserve service configuration."""

import importlib
from importlib.resources import files

import pytest
from streamlit.testing.v1 import AppTest


@pytest.mark.parametrize("domain,mode", [("flight", "serpapi"), ("payment", "zalopay")])
def test_clients_keep_service_url_and_auth_precedence(monkeypatch, domain, mode):
    client = importlib.import_module(f"relohome_demos.{domain}_client")
    prefix = domain.upper()
    monkeypatch.setenv(f"{prefix}_MCP_URL", "http://127.0.0.1:1/default/mcp")
    monkeypatch.setenv(f"{prefix}_MCP_AUTH_TOKEN", "demo-test-token")
    monkeypatch.delenv(f"{prefix}_{mode.upper()}_MCP_URL", raising=False)
    assert client.server_params(mode).url == "http://127.0.0.1:1/default/mcp"
    assert client.server_params(mode).token == "demo-test-token"
    monkeypatch.setenv(f"{prefix}_{mode.upper()}_MCP_URL", "http://127.0.0.1:1/provider/mcp")
    assert client.server_params(mode).url == "http://127.0.0.1:1/provider/mcp"


@pytest.mark.parametrize("demo", ["flight_demo", "payment_demo", "agent_chat"])
def test_installed_demo_first_render_without_provider_calls(monkeypatch, tmp_path, demo):
    import httpx
    from relohome_demos import mcp_client

    def forbidden(*args, **kwargs):
        raise AssertionError("First render attempted a provider/MCP request")

    monkeypatch.setattr(mcp_client, "call_tool", forbidden)
    monkeypatch.setattr(mcp_client, "inspect_server", forbidden)
    monkeypatch.setattr(httpx, "request", forbidden)
    monkeypatch.setattr(httpx, "post", forbidden)
    monkeypatch.delenv("AGENT_API_TOKEN", raising=False)
    monkeypatch.chdir(tmp_path)
    page = AppTest.from_file(str(files("relohome_demos") / f"{demo}.py")).run(timeout=10)
    assert not page.exception
    assert "ReloHome" in page.title[0].value
    if demo == "agent_chat":
        assert page.error  # Missing token stops local chat before making HTTP calls.
