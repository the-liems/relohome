"""Local MCP children need the Python loader path without unrelated credentials."""

from contextlib import asynccontextmanager

import pytest

from src.services.adapters import mcp


@pytest.mark.asyncio
@pytest.mark.parametrize("service,prefix,other", [("flight", "FLIGHT_", "PAYMENT_"),
                                               ("payment", "PAYMENT_", "FLIGHT_")])
async def test_stdio_preserves_python_loader_path_and_filters_other_credentials(monkeypatch, service, prefix, other):
    monkeypatch.setenv("LD_LIBRARY_PATH", "/toolcache/python/lib")
    monkeypatch.setenv("OPENAI_API_KEY", "unrelated-ai-key")
    monkeypatch.setenv("DATABASE_ADMIN_PASSWORD", "unrelated-db-password")
    monkeypatch.setenv(prefix + "PROVIDER", "mock")
    monkeypatch.setenv(other + "TOKEN", "unrelated-provider-token")
    captured = {}

    @asynccontextmanager
    async def capture(params):
        captured.update(params.env)
        raise RuntimeError("captured stdio environment")
        yield  # pragma: no cover

    monkeypatch.setattr(mcp, "stdio_client", capture)
    endpoint = mcp.McpEndpoint(service, frozenset(), stdio_module="unused.test.module")
    with pytest.raises(RuntimeError, match="captured stdio environment"):
        async with mcp.McpToolClient(endpoint)._session():
            pass

    assert captured["LD_LIBRARY_PATH"] == "/toolcache/python/lib"
    assert captured[prefix + "PROVIDER"] == "mock"
    assert "OPENAI_API_KEY" not in captured
    assert "DATABASE_ADMIN_PASSWORD" not in captured
    assert other + "TOKEN" not in captured
