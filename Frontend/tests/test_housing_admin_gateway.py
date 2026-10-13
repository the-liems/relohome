import hashlib
import hmac
import io
import json
import sqlite3
import time

import httpx
import pytest
from PIL import Image
from relohome_gateway.server import create_app
from relohome_gateway.store import Store

HEADERS = {"X-SIU-Request": "1", "Origin": "http://test"}
CREDS = {"email": "admin@example.test", "password": "a-long-password", "name": "Operator"}
LISTING = "11111111-1111-4111-8111-111111111111"


@pytest.mark.asyncio
async def test_admin_login_is_separate_and_capability_is_rechecked(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENT_API_TOKEN", "server-token")
    allowed = False
    calls = []

    def provider(request):
        calls.append(request)
        if request.url.path.endswith("/admin/session"):
            return (
                httpx.Response(200, json={"can_moderate_housing": True})
                if allowed
                else httpx.Response(403, json={"code": "HOUSING_MANAGEMENT_ERROR", "message": "Không có quyền Admin."})
            )
        return httpx.Response(200, json={"items": []})

    app = create_app(tmp_path / "web.db", httpx.MockTransport(provider))
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers=HEADERS) as client,
    ):
        registered = await client.post("/web/api/auth/register", json={**CREDS, "is_admin": True, "role": "admin"})
        assert registered.status_code == 200
        assert "is_admin" not in registered.json()
        allowed = True
        # A configured moderator still needs an Admin session for browser moderation.
        assert (await client.get("/web/api/housing-management/moderation/housing/queue")).status_code == 403
        await client.post("/web/api/logout")
        allowed = False
        denied = await client.post("/web/api/auth/admin", json=CREDS)
        assert denied.status_code == 403
        assert "set-cookie" not in denied.headers
        assert (await client.get("/web/api/session")).status_code == 401
        allowed = True
        login = await client.post("/web/api/auth/admin", json=CREDS)
        assert login.json()["is_admin"] is True
        assert "HttpOnly" in login.headers["set-cookie"]
        assert (await client.get("/web/api/housing-management/moderation/housing/queue")).status_code == 200
        allowed = False
        assert (await client.get("/web/api/session")).status_code == 403
        assert all(request.headers["authorization"] == "Bearer server-token" for request in calls)


@pytest.mark.asyncio
async def test_media_access_fails_closed_and_uploads_are_signed_and_deduplicated(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENT_API_TOKEN", "server-token")
    monkeypatch.setenv("SIU_HOUSING_MEDIA_DIR", str(tmp_path / "media"))
    mode = "owner"
    first_url = None
    calls = []

    def provider(request):
        nonlocal first_url
        calls.append(request)
        if request.method == "GET":
            if mode == "private":
                return httpx.Response(403, json={"code": "HOUSING_MANAGEMENT_ERROR", "message": "Không có quyền."})
            if mode == "bad":
                return httpx.Response(200, json={})
            return httpx.Response(200, json={"public": mode == "public"})
        body = json.loads(request.content)
        expected = hmac.new(
            b"server-token", f"{LISTING}\n{body['url']}\n{body['content_sha256']}".encode(), hashlib.sha256
        ).hexdigest()
        assert request.headers["x-housing-media-signature"] == expected
        stored = (tmp_path / "media" / body["url"].rsplit("/", 1)[1]).read_bytes()
        assert body["content_sha256"] == hashlib.sha256(stored).hexdigest()
        if first_url is None:
            first_url = body["url"]
        return httpx.Response(201, json={"id": "media", "url": first_url})

    source = io.BytesIO()
    Image.new("RGB", (8, 8), "green").save(source, "JPEG")
    app = create_app(tmp_path / "web.db", httpx.MockTransport(provider))
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers=HEADERS) as client,
    ):
        await client.post("/web/api/auth/register", json=CREDS)
        raw = await client.post(
            f"/web/api/housing-management/landlord/listings/{LISTING}/media", json={"url": "https://evil.test/image"}
        )
        assert raw.status_code == 403 and not calls
        for _ in range(2):
            uploaded = await client.post(
                f"/web/api/landlord/listings/{LISTING}/media-upload", content=source.getvalue()
            )
            assert uploaded.status_code == 201
            assert len(list((tmp_path / "media").glob("*.png"))) == 1
        path = uploaded.json()["url"].removeprefix("http://test")
        assert (await client.get(path)).status_code == 200
        await client.post("/web/api/logout")
        mode = "private"
        denied = await client.get(path)
        assert denied.status_code == 403 and denied.headers["content-type"] != "image/png"
        mode = "bad"
        assert (await client.get(path)).status_code == 502
        mode = "public"
        visible = await client.get(path)
        assert visible.status_code == 200 and "no-store" in visible.headers["cache-control"]


def test_session_migration_keeps_existing_customer_sessions(tmp_path):
    path = tmp_path / "web.db"
    db = sqlite3.connect(path)
    db.execute("CREATE TABLE sessions(token TEXT PRIMARY KEY,owner TEXT NOT NULL,expires REAL NOT NULL)")
    db.execute("INSERT INTO sessions VALUES(?,?,?)", ("hash", "old", time.time() + 300))
    db.commit()
    db.close()
    store = Store(path)
    assert store.one("SELECT owner,workspace FROM sessions WHERE token='hash'") == {
        "owner": "old",
        "workspace": "customer",
    }
    store.db.close()
