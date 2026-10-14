import asyncio
import json

import httpx
import pytest
from relohome_gateway.server import create_app

HEADERS = {"X-SIU-Request": "1"}
CREDENTIALS = {"name": "An", "email": "guest-upgrade@example.test", "password": "a-strong-password"}


@pytest.mark.asyncio
async def test_public_guest_chat_private_actions_and_claim_keep_history(tmp_path, monkeypatch):
    monkeypatch.setenv("RELOHOME_GUEST_ENABLED", "true")
    monkeypatch.setenv("AGENT_API_TOKEN", "internal-token")
    calls = []

    def upstream(request):
        assert request.headers["authorization"] == "Bearer internal-token"
        calls.append(request)
        if request.url.path.endswith("/guest-claim"):
            return httpx.Response(200, json={"claimed": True})
        if request.url.path.endswith("/state"):
            return httpx.Response(200, json={"plan": {"version": 1, "tasks": []}})
        return httpx.Response(200, json={"status": "done", "response": {"kind": "ANSWER", "text": "Kết quả thật"}})

    app = create_app(tmp_path / "web.db", httpx.MockTransport(upstream))
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers=HEADERS) as client,
    ):
        guest = (await client.get("/web/api/session")).json()
        assert guest["is_guest"] and guest["id"].startswith("guest_")
        assert not app.state.store.all("SELECT * FROM users")
        guest_cookie = dict(client.cookies)
        thread = (await client.post("/web/api/threads")).json()["id"]
        assert (await client.post("/web/api/threads")).json()["id"] == thread
        turn = {"message": "Tìm nhà", "request_id": "guest-turn-000000001"}
        reply = await client.post(f"/web/api/threads/{thread}/chat", json=turn)
        assert reply.status_code == 200, reply.text
        assert len(reply.json()["messages"]) == 2
        assert (await client.post(f"/web/api/threads/{thread}/chat", json=turn)).status_code == 200
        assert len([call for call in calls if call.url.path.endswith("/chat")]) == 1
        for path, method in [
            ("/roommate/search", "POST"),
            ("/housing-management/landlord/properties", "GET"),
            (f"/threads/{thread}/viewings/schedule", "POST"),
            ("/saved/home", "PUT"),
            (f"/threads/{thread}/checkout/summary", "POST"),
            ("/profile/traveler", "GET"),
        ]:
            denied = await client.request(method, "/web/api" + path, json={})
            assert denied.status_code == 401 and denied.json()["code"] == "authentication_required"
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as other:
            await other.get("/web/api/session")
            assert (await other.get(f"/web/api/threads/{thread}")).status_code == 404
        account = (await client.post("/web/api/auth/register", json=CREDENTIALS)).json()
        assert not account.get("is_guest")
        claim = next(call for call in calls if call.url.path.endswith("/guest-claim"))
        assert claim.headers["x-user-id"] == guest["id"]
        assert json.loads(claim.content)["target_user"] == account["id"]
        assert app.state.store.one("SELECT owner FROM threads WHERE id=?", (thread,))["owner"] == account["id"]
        assert len((await client.get(f"/web/api/threads/{thread}")).json()["messages"]) == 2
        assert (await client.get("/web/api/session")).json()["id"] == account["id"]
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test", cookies=guest_cookie
        ) as old:
            assert (await old.get(f"/web/api/threads/{thread}")).status_code == 401


@pytest.mark.asyncio
async def test_claim_retry_uses_persisted_key_and_fences_old_guest(tmp_path, monkeypatch):
    monkeypatch.setenv("RELOHOME_GUEST_ENABLED", "true")
    monkeypatch.setenv("AGENT_API_TOKEN", "internal-token")
    keys = []

    def upstream(request):
        if request.url.path.endswith("/guest-claim"):
            keys.append(json.loads(request.content)["operation_key"])
            return (
                httpx.Response(503, json={"detail": "temporary failure"})
                if len(keys) == 1
                else httpx.Response(200, json={"claimed": True})
            )
        return httpx.Response(200, json={})

    app = create_app(tmp_path / "web.db", httpx.MockTransport(upstream))
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers=HEADERS) as client,
    ):
        await client.get("/web/api/session")
        thread = (await client.post("/web/api/threads")).json()["id"]
        assert (await client.post("/web/api/auth/register", json=CREDENTIALS)).status_code == 503
        assert (await client.get(f"/web/api/threads/{thread}")).status_code == 409
        assert (await client.post("/web/api/auth/login", json=CREDENTIALS)).status_code == 200
        assert len(keys) == 2 and keys[0] == keys[1]
        assert (await client.get(f"/web/api/threads/{thread}")).status_code == 200


@pytest.mark.asyncio
async def test_concurrent_guest_thread_creation_and_expiry_cleanup_retry(tmp_path, monkeypatch):
    monkeypatch.setenv("RELOHOME_GUEST_ENABLED", "true")
    monkeypatch.setenv("AGENT_API_TOKEN", "internal-token")
    deletions = []

    def upstream(request):
        if request.method == "DELETE":
            deletions.append(request.url.path)
            if len(deletions) == 1:
                return httpx.Response(503, json={"detail": "Agent temporarily unavailable"})
        return httpx.Response(200, json={})

    app = create_app(tmp_path / "web.db", httpx.MockTransport(upstream))
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers=HEADERS) as client,
    ):
        guest = (await client.get("/web/api/session")).json()
        results = await asyncio.gather(*(client.post("/web/api/threads") for _ in range(3)))
        assert all(result.status_code == 200 for result in results)
        ids = {result.json()["id"] for result in results}
        assert len(ids) == 1
        thread = ids.pop()
        assert len(app.state.store.all("SELECT id FROM threads WHERE owner=?", (guest["id"],))) == 1
        # A real chat creates a checkpoint; expired cleanup must delete it first.
        app.state.store.write("UPDATE threads SET revision=1 WHERE id=?", (thread,))
        app.state.store.write("UPDATE guest_sessions SET expires=0 WHERE id=?", (guest["id"],))
        assert (await client.get(f"/web/api/threads/{thread}")).status_code == 401
        await app.state.cleanup_guests()
        assert app.state.store.one("SELECT id FROM threads WHERE id=?", (thread,))
        await app.state.cleanup_guests()
        assert not app.state.store.one("SELECT id FROM threads WHERE id=?", (thread,))
        assert not app.state.store.one("SELECT id FROM guest_sessions WHERE id=?", (guest["id"],))
        assert len(deletions) == 2
