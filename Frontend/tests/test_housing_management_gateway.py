import io
import json

import httpx
import pytest
from PIL import Image

from Frontend.server import create_app


HEADERS = {"X-SIU-Request": "1", "Origin": "http://test"}
LISTING = "11111111-1111-4111-8111-111111111111"


@pytest.mark.asyncio
async def test_management_gateway_uses_session_actor_and_strict_allowlist(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENT_API_TOKEN", "server-token")
    calls = []

    def provider(request):
        calls.append(request)
        assert request.headers["Authorization"] == "Bearer server-token"
        assert request.headers["X-User-Id"] not in ("spoof", "")
        return httpx.Response(200, json={"method": request.method, "path": request.url.path})

    app = create_app(tmp_path / "web.db", httpx.MockTransport(provider))
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers=HEADERS) as client,
    ):
        assert (await client.get("/web/api/housing-management/landlord/overview")).status_code == 401
        await client.post(
            "/web/api/auth/register",
            json={"email": "owner@example.test", "password": "a-long-password", "name": "Owner"},
        )
        response = await client.get(
            "/web/api/housing-management/landlord/overview",
            headers={**HEADERS, "X-User-Id": "spoof"},
        )
        assert response.status_code == 200
        assert response.json()["path"].endswith("/v1/landlord/overview")
        assert (await client.get("/web/api/housing-management/arbitrary/admin")).status_code == 404
        response = await client.patch(
            f"/web/api/housing-management/landlord/listings/{LISTING}",
            json={"revision": 1, "title": "Nhà mới"},
        )
        assert response.status_code == 200
        assert json.loads(calls[-1].content)["revision"] == 1


@pytest.mark.asyncio
async def test_housing_image_upload_is_sanitized_and_registered(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENT_API_TOKEN", "server-token")
    monkeypatch.setenv("SIU_PUBLIC_BASE_URL", "https://example.test")

    def provider(request):
        body = json.loads(request.content)
        assert body["url"].startswith("https://example.test/web/media/housing/")
        assert body["url"].endswith(".png")
        return httpx.Response(201, json={"id": "media-1", "url": body["url"]})

    source = io.BytesIO()
    Image.new("RGB", (8, 8), "#14543c").save(source, "JPEG")
    app = create_app(tmp_path / "web.db", httpx.MockTransport(provider))
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers=HEADERS) as client,
    ):
        await client.post(
            "/web/api/auth/register",
            json={"email": "media@example.test", "password": "a-long-password", "name": "Owner"},
        )
        response = await client.post(
            f"/web/api/landlord/listings/{LISTING}/media-upload?alt=Ph%C3%B2ng%20ng%E1%BB%A7",
            content=source.getvalue(),
            headers={**HEADERS, "Content-Type": "image/jpeg"},
        )
        assert response.status_code == 201
        media_path = response.json()["url"].removeprefix("https://example.test")
        image = await client.get(media_path)
        assert image.status_code == 200
        assert image.headers["content-type"] == "image/png"
        assert image.headers["x-content-type-options"] == "nosniff"
