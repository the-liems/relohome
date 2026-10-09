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
    monkeypatch.setenv("SIU_HOUSING_MEDIA_DIR", str(tmp_path / "media"))

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


@pytest.mark.asyncio
async def test_oversized_upload_is_rejected_before_any_upstream_call(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENT_API_TOKEN", "server-token")
    monkeypatch.setenv("SIU_HOUSING_MEDIA_DIR", str(tmp_path / "media"))
    calls = []
    app = create_app(tmp_path / "web.db", httpx.MockTransport(lambda request: calls.append(request)))
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers=HEADERS) as client,
    ):
        await client.post(
            "/web/api/auth/register",
            json={"email": "big@example.test", "password": "a-long-password", "name": "Owner"},
        )
        response = await client.post(
            f"/web/api/landlord/listings/{LISTING}/media-upload",
            content=b"0" * (5 * 1024 * 1024 + 1),
            headers={**HEADERS, "Content-Type": "image/jpeg"},
        )
        assert response.status_code == 413
        assert not calls and not (tmp_path / "media").exists()


@pytest.mark.asyncio
async def test_host_profile_routes_and_outcome_codes(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENT_API_TOKEN", "server-token")

    def provider(request):
        if request.url.path.endswith("/landlord/properties"):
            return httpx.Response(
                409, json={"code": "host_profile_required", "message": "Hãy hoàn tất hồ sơ.", "internal": "x"}
            )
        if request.url.path.endswith("/landlord/overview"):
            return httpx.Response(409, json={"code": "SOMETHING_ELSE", "message": "Lỗi"})
        return httpx.Response(200, json={"method": request.method, "path": request.url.path})

    app = create_app(tmp_path / "web.db", httpx.MockTransport(provider))
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers=HEADERS) as client,
    ):
        await client.post(
            "/web/api/auth/register",
            json={"email": "host@example.test", "password": "a-long-password", "name": "Host"},
        )
        saved = await client.put("/web/api/housing-management/host/profile", json={"poster_type": "owner"})
        assert saved.json() == {"method": "PUT", "path": "/v1/host/profile"}
        review = await client.post("/web/api/housing-management/moderation/host/abc123/review", json={})
        assert review.json()["path"] == "/v1/moderation/host/abc123/review"
        assert (await client.post("/web/api/housing-management/moderation/host/a.b/review", json={})).status_code == 404
        # The workspace needs the outcome code; nothing else from upstream is forwarded.
        blocked = await client.post("/web/api/housing-management/landlord/properties", json={})
        assert blocked.status_code == 409
        assert blocked.json() == {"detail": "Hãy hoàn tất hồ sơ.", "code": "host_profile_required"}
        other = await client.get("/web/api/housing-management/landlord/overview")
        assert other.json() == {"detail": "Lỗi"}


@pytest.mark.asyncio
async def test_viewing_slots_sync_to_landlord_and_show_the_answer(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENT_API_TOKEN", "server-token")
    managed, crawled, dropped = (f"{n}{n}{n}{n}{n}{n}{n}{n}-1111-4111-8111-111111111111" for n in "abc")
    slot = "2026-10-10T13:00:00+07:00"
    view = {
        "items": [
            {"listing_id": managed, "status": "viewing_scheduled", "viewing": {"slot": slot}},
            {"listing_id": crawled, "status": "viewing_scheduled", "viewing": {"slot": slot}},
        ],
        "history": [{"listing_id": dropped, "status": "unselected"}],
    }
    platform_calls, mine = (
        [],
        [
            {
                "listing_id": dropped,
                "status": "new",
                "viewing_status": "requested",
                "viewing_slot": "2026-10-09T06:00:00.000Z",
            }
        ],
    )

    def provider(request):
        path = request.url.path
        if path.startswith("/api/v1/ui/chat/"):
            return httpx.Response(200, json=view)
        if path.startswith("/api/v1/chat/") and path.endswith("/state"):
            return httpx.Response(200, json={"viewing": view})
        if path.endswith("/housing/contact-requests/me"):
            return httpx.Response(200, json={"items": mine})
        platform_calls.append((request.method, path))
        if request.method == "PUT" and managed in path:
            mine.insert(
                0,
                {
                    "listing_id": managed,
                    "status": "new",
                    "viewing_status": "requested",
                    "viewing_slot": "2026-10-10T06:00:00.000Z",
                },
            )
            return httpx.Response(201, json={"viewing_status": "requested"})
        if request.method == "PUT":
            return httpx.Response(409, json={"code": "not_managed", "message": "Tin này không nhận lịch xem."})
        return httpx.Response(200, json={"changed": True})

    app = create_app(tmp_path / "web.db", httpx.MockTransport(provider))
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers=HEADERS) as client,
    ):
        await client.post(
            "/web/api/auth/register",
            json={"email": "tenant@example.test", "password": "a-long-password", "name": "Tenant"},
        )
        thread = (await client.post("/web/api/threads")).json()["id"]
        result = (await client.post(f"/web/api/threads/{thread}/viewings/schedule", json={})).json()
        assert sorted(platform_calls) == [
            ("DELETE", f"/v1/housing/{dropped}/viewing"),
            ("PUT", f"/v1/housing/{managed}/viewing"),
            ("PUT", f"/v1/housing/{crawled}/viewing"),
        ]
        assert result["items"][0]["landlord"] == {"viewing_status": "requested", "request_status": "new"}
        assert "landlord" not in result["items"][1]  # other sources stay in test mode
        # The landlord confirmed; an unchanged slot is not sent again and the answer is shown.
        mine[0]["viewing_status"], mine[0]["status"] = "confirmed", "viewing"
        mine.pop()  # the dropped home's request was cancelled
        platform_calls.clear()
        result = (await client.get(f"/web/api/threads/{thread}/viewings")).json()
        assert ("PUT", f"/v1/housing/{managed}/viewing") not in platform_calls
        assert result["items"][0]["landlord"] == {"viewing_status": "confirmed", "request_status": "viewing"}
        # The plan tab reads the thread snapshot; it carries the same answer.
        snapshot = (await client.get(f"/web/api/threads/{thread}")).json()
        assert snapshot["state"]["viewing"]["items"][0]["landlord"]["viewing_status"] == "confirmed"
