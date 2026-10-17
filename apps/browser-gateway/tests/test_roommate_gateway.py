import httpx
import pytest
from relohome_gateway.server import create_app

HEADERS = {"X-SIU-Request": "1", "Origin": "http://test"}


@pytest.mark.asyncio
async def test_gateway_session_csrf_whitelist_and_binary(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENT_API_TOKEN", "server-token")
    calls = []

    def provider(request):
        calls.append(request)
        if request.url.path.endswith("/availability"):
            return httpx.Response(200, json={"enabled": True})
        assert request.headers["Authorization"] == "Bearer server-token"
        assert request.headers["X-User-Id"] not in ("spoof", "anonymous")
        if request.url.path.endswith("/media"):
            assert request.content == b"image-bytes"
            assert request.headers["X-Roommate-Operation"] == "image-operation-001"
            return httpx.Response(200, json={"media_id": "image1"})
        if request.url.path.endswith("/media/image1"):
            return httpx.Response(200, content=b"png-bytes", headers={"Content-Type": "image/png"})
        return httpx.Response(200, json={"actor": request.headers["X-User-Id"]})

    app = create_app(tmp_path / "web.db", httpx.MockTransport(provider))
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client,
    ):
        assert (await client.get("/web/api/roommate/availability")).status_code == 200
        assert (await client.get("/web/api/roommate/access")).status_code == 401
        assert (await client.get("/web/api/roommate/chat/conversations")).status_code == 401
        assert (await client.post("/web/api/roommate/chat/requests", json={}, headers=HEADERS)).status_code == 401
        await client.post(
            "/web/api/auth/register",
            json={"email": "roommate@example.test", "password": "a-long-password", "name": "Test"},
            headers=HEADERS,
        )
        assert (await client.post("/web/api/roommate/search", json={})).status_code == 403
        response = await client.get(
            "/web/api/roommate/access", headers={"Authorization": "Bearer fake", "X-User-Id": "spoof"}
        )
        assert response.status_code == 200 and response.json()["actor"] != "spoof"
        assert response.headers["cache-control"] == "no-store"
        assert (await client.post("/web/api/roommate/chat/requests", json={})).status_code == 403
        before = len(calls)
        response = await client.post(
            "/web/api/roommate/chat/requests", json={}, headers={**HEADERS, "X-Roommate-Actor": "previous-account"}
        )
        assert response.status_code == 409 and response.json()["detail"]["code"] == "actor_changed"
        assert len(calls) == before
        response = await client.get(
            "/web/api/roommate/chat/conversations/conversation-one/messages?limit=20&before=message-one",
            headers={"X-User-Id": "spoof"},
        )
        assert response.status_code == 200 and response.json()["actor"] != "spoof"
        assert (await client.get("/web/api/roommate/chat/conversations?actor=spoof")).status_code == 422
        assert (await client.get("/web/api/roommate/chat/conversations?limit=1&limit=2")).status_code == 422
        assert (await client.get("/web/api/roommate/arbitrary/path")).status_code == 404
        before = len(calls)
        assert (await client.post("/web/api/roommate/demo/search", json={}, headers=HEADERS)).status_code == 404
        assert len(calls) == before
        assert (await client.get("/web/api/roommate/access?actor=spoof")).status_code == 422
        assert (await client.get("/web/api/roommate/me/privacy")).status_code == 200
        response = await client.post(
            "/web/api/roommate/media",
            content=b"image-bytes",
            headers={**HEADERS, "X-Roommate-Operation": "image-operation-001"},
        )
        assert response.status_code == 404
        response = await client.get("/web/api/roommate/media/image1")
        assert response.content == b"png-bytes" and response.headers["content-type"] == "image/png"
        assert (await client.post("/web/api/logout", headers=HEADERS)).status_code == 200
        assert (await client.get("/web/api/roommate/access")).status_code == 401
