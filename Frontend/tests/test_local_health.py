"""Actual ASGI route with real local SQLite; no provider or storage substitutions."""

import httpx
import pytest

from Frontend.server import create_app


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "environment,enabled,client_host,expected",
    [
        ("development", "true", "127.0.0.1", 200),
        ("production", "true", "127.0.0.1", 404),
        ("development", "false", "127.0.0.1", 404),
        ("development", "true", "192.0.2.1", 404),
    ],
)
async def test_local_probe_is_opt_in_and_not_public(tmp_path, monkeypatch, environment, enabled, client_host, expected):
    monkeypatch.setenv("APP_ENV", environment)
    monkeypatch.setenv("SIU_WEB_LOCAL_HEALTHCHECK", enabled)
    app = create_app(database=tmp_path / "gateway.sqlite3")
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app, client=(client_host, 1234)), base_url="http://local"
        ) as http:
            response = await http.get("/health")
            assert response.status_code == expected
            if expected == 200:
                assert response.json() == {"status": "ok", "service": "siu-web"}
