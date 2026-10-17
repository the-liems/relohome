"""Gateway contract tests use explicit HTTP fixtures; no live provider calls."""

import json
import logging

import httpx
import pytest
from relohome_gateway.server import create_app

HEADERS = {"X-SIU-Request": "1", "Origin": "http://test"}
HOUSE = {"id": "house-1", "title": "Tin nhà kiểm thử", "address": "Hà Nội", "price_vnd": 4000000}


@pytest.mark.asyncio
async def test_moving_catalog_and_structured_options_use_authenticated_gateway(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENT_API_TOKEN", "private-server-token")
    calls = []

    def provider(request):
        assert request.headers["Authorization"] == "Bearer private-server-token"
        assert request.headers["X-User-Id"]
        calls.append(request)
        if request.url.path.endswith("/moving/services"):
            assert float(request.url.params["lat"]) == 10.77
            return httpx.Response(200, json={"services": [{"service_id": "SGN-TRUCK"}]})
        if request.url.path.endswith("/state"):
            return httpx.Response(200, json={"intake": {}, "pending": None})
        body = json.loads(request.content)
        assert body["moving_options"]["service_id"] == "SGN-TRUCK"
        assert body["moving_options"]["requests"] == [
            {"request_id": "tip", "quantity": 2, "tier_code": None, "option_id": None}
        ]
        assert "0901234567" not in request.content.decode()
        return httpx.Response(200, json={"status": "done", "response": {"kind": "ANSWER", "text": "Đã đọc yêu cầu"}})

    app = create_app(tmp_path / "web.db", httpx.MockTransport(provider))
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers=HEADERS) as client,
    ):
        url = "/web/api/moving/services?lat=10.77&lng=106.7"
        assert (await client.get(url)).status_code == 401
        await client.post(
            "/web/api/auth/register",
            json={"name": "Test", "email": "moving@example.test", "password": "a-long-password"},
        )
        assert (await client.get(url)).json()["services"][0]["service_id"] == "SGN-TRUCK"
        tid = (await client.post("/web/api/threads")).json()["id"]
        turn = {
            "request_id": "moving-form-request-00001",
            "message": "Báo giá chuyển đồ",
            "moving_options": {
                "service_id": "SGN-TRUCK",
                "requests": [{"request_id": "tip", "quantity": 2}],
                "packages": [{"weight_kg": 12}],
                "remarks": "Gọi 0901234567",
            },
        }
        assert (await client.post(f"/web/api/threads/{tid}/chat", json=turn)).status_code == 200
        turn["moving_options"]["payment_method"] = "BALANCE"
        assert (await client.post(f"/web/api/threads/{tid}/chat", json=turn)).status_code == 422
        assert len([r for r in calls if r.url.path.endswith("/chat")]) == 1


@pytest.mark.asyncio
async def test_health_reports_store_readiness(tmp_path):
    app = create_app(tmp_path / "web.db")
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client,
    ):
        ready = await client.get("/health")
        assert (ready.status_code, ready.json()) == (200, {"status": "ok"})
        app.state.store.db.close()
        failed = await client.get("/health")
        assert (failed.status_code, failed.json()) == (503, {"status": "not_ready"})


@pytest.mark.asyncio
async def test_session_history_ownership_idempotency_saved_and_restart(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENT_API_TOKEN", "private-server-token")
    database = tmp_path / "web.db"
    calls = []

    def provider(request):
        assert request.headers["Authorization"] == "Bearer private-server-token"
        calls.append(request)
        if request.url.path.endswith("/state"):
            return httpx.Response(200, json={"plan": {"version": 1, "tasks": []}, "intake": {}, "pending": None})
        if request.url.path.endswith("/chat"):
            body = json.loads(request.content)
            return httpx.Response(
                200,
                json={
                    "thread_id": body["thread_id"],
                    "status": "done",
                    "response": {
                        "kind": "ANSWER",
                        "text": "Đã có kết quả",
                        "data": {
                            "results": {
                                "t1": {
                                    "agent": "property",
                                    "fetched_at": "2026-09-30T00:00:00+00:00",
                                    "data": {"candidates": [HOUSE]},
                                }
                            }
                        },
                    },
                },
            )
        return httpx.Response(
            200, json={"status": "done", "response": {"kind": "ANSWER", "text": "Đã nhận quyết định"}}
        )

    app = create_app(database, httpx.MockTransport(provider))
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers=HEADERS) as a,
    ):
        assert (await a.get("/web/api/threads")).status_code == 401
        registered = await a.post(
            "/web/api/auth/register", json={"name": "Bạn A", "email": "a@example.test", "password": "a-strong-password"}
        )
        assert registered.status_code == 200
        assert "httponly" in registered.headers["set-cookie"].lower()
        assert "password" not in registered.text and "private-server-token" not in registered.text
        cookies = dict(a.cookies)
        tid = (await a.post("/web/api/threads")).json()["id"]
        turn = {"request_id": "request-000000000001", "message": "Tìm phòng, số liên hệ 0901234567"}
        result = await a.post(f"/web/api/threads/{tid}/chat", json=turn)
        assert result.status_code == 200, result.text
        assert result.json()["messages"][-1]["content"]["ui"]["components"][0]["type"] == "property"
        assert "0901234567" not in result.text
        assert (await a.post(f"/web/api/threads/{tid}/chat", json=turn)).status_code == 200
        assert len([c for c in calls if c.url.path.endswith("/chat")]) == 1
        assert (await a.put("/web/api/saved/house-1", json={"thread_id": tid})).status_code == 200
        assert (await a.get("/web/api/saved")).json()[0]["house"]["title"] == HOUSE["title"]
        assert (await a.put("/web/api/saved/invented", json={"thread_id": tid})).status_code == 404
        csrf = await a.post("/web/api/threads", headers={"Origin": "http://evil.test"})
        assert csrf.status_code == 403
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test", headers=HEADERS
        ) as b:
            await b.post(
                "/web/api/auth/register",
                json={"name": "Bạn B", "email": "b@example.test", "password": "b-strong-password"},
            )
            assert (await b.get(f"/web/api/threads/{tid}")).status_code == 404
            assert (await b.post(f"/web/api/threads/{tid}/chat", json=turn)).status_code == 404
            assert (await b.get("/web/api/saved")).json() == []
        pii = {
            "request_id": "request-000000000002",
            "kind": "CONFIRM",
            "plan_version": 1,
            "payload_hash": "hash",
            "pii_forms": {"action": {"mobile": "0909876543", "name": "Private Person"}},
        }
        assert (await a.post(f"/web/api/threads/{tid}/decision", json=pii)).status_code == 200
        history = (await a.get(f"/web/api/threads/{tid}")).text
        assert "Private Person" not in history and "0909876543" not in history

    reopened = create_app(database, httpx.MockTransport(provider))
    async with (
        reopened.router.lifespan_context(reopened),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=reopened), base_url="http://test", cookies=cookies, headers=HEADERS
        ) as a,
    ):
        assert (await a.get("/web/api/session")).status_code == 200
        thread = (await a.get(f"/web/api/threads/{tid}")).json()
        assert len(thread["messages"]) == 4
        assert (await a.get("/web/api/saved")).json()[0]["id"] == HOUSE["id"]


@pytest.mark.asyncio
async def test_unknown_result_is_not_retried_automatically(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENT_API_TOKEN", "test-token")
    calls = []

    def unavailable(request):
        calls.append(request)
        raise httpx.ReadTimeout("connection lost")

    app = create_app(tmp_path / "web.db", httpx.MockTransport(unavailable))
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers=HEADERS) as client,
    ):
        await client.post(
            "/web/api/auth/register", json={"name": "Test", "email": "test@example.test", "password": "a-long-password"}
        )
        tid = (await client.post("/web/api/threads")).json()["id"]
        body = {"request_id": "request-unknown-0001", "message": "Tìm nhà"}
        assert (await client.post(f"/web/api/threads/{tid}/chat", json=body)).status_code == 502
        assert (await client.post(f"/web/api/threads/{tid}/chat", json=body)).status_code == 409
        assert len(calls) == 1


@pytest.mark.asyncio
async def test_delete_and_reset_conversations(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENT_API_TOKEN", "test-token")
    calls, blocked = [], set()

    def provider(request):
        calls.append((request.method, request.url.path))
        if request.method == "DELETE" and request.url.path.endswith("/memory"):
            return httpx.Response(200, json={"forgotten": True})
        if request.method == "DELETE":
            if request.url.path.rsplit("/", 1)[-1] in blocked:
                return httpx.Response(409, json={"detail": "Hội thoại đang có thanh toán chờ xử lý."})
            return httpx.Response(200, json={"deleted": True})
        if request.url.path.endswith("/state"):
            return httpx.Response(200, json={"plan": None, "intake": {}, "pending": None})
        body = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "thread_id": body["thread_id"],
                "status": "done",
                "response": {
                    "kind": "ANSWER",
                    "text": "Đã có kết quả",
                    "data": {"results": {"t1": {"agent": "property", "data": {"candidates": [HOUSE]}}}},
                },
            },
        )

    app = create_app(tmp_path / "web.db", httpx.MockTransport(provider))
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers=HEADERS) as a,
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers=HEADERS) as b,
    ):
        for client, email in ((a, "a@example.test"), (b, "b@example.test")):
            await client.post(
                "/web/api/auth/register", json={"name": "Bạn", "email": email, "password": "a-long-password"}
            )

        async def chatted(n):
            tid = (await a.post("/web/api/threads")).json()["id"]
            turn = {"request_id": f"request-delete-{n:04d}", "message": "Tìm phòng"}
            assert (await a.post(f"/web/api/threads/{tid}/chat", json=turn)).status_code == 200
            return tid

        first = await chatted(1)
        await a.put("/web/api/saved/house-1", json={"thread_id": first})
        assert (await b.delete(f"/web/api/threads/{first}")).status_code == 404
        assert (await a.delete(f"/web/api/threads/{first}")).status_code == 200
        assert ("DELETE", f"/api/v1/chat/{first}") in calls
        assert (await a.get(f"/web/api/threads/{first}")).status_code == 404
        saved = (await a.get("/web/api/saved")).json()
        assert saved[0]["id"] == HOUSE["id"] and saved[0]["thread_id"] == ""

        # A thread the agent never saw is removed locally without an upstream call.
        empty = (await a.post("/web/api/threads")).json()["id"]
        before = len(calls)
        assert (await a.delete(f"/web/api/threads/{empty}")).status_code == 200
        assert len(calls) == before

        # The agent refuses (pending payment): the conversation stays, nothing local is dropped.
        paying, other = await chatted(2), await chatted(3)
        blocked.add(paying)
        assert (await a.delete(f"/web/api/threads/{paying}")).status_code == 409
        assert len((await a.get(f"/web/api/threads/{paying}")).json()["messages"]) == 2

        reset = (await a.delete("/web/api/threads")).json()
        assert reset["deleted"] == 1 and reset["memory_forgotten"] is True
        assert [k["id"] for k in reset["kept"]] == [paying]
        assert [t["id"] for t in (await a.get("/web/api/threads")).json()] == [paying]
        assert (await a.get(f"/web/api/threads/{other}")).status_code == 404
        assert ("DELETE", "/api/v1/memory") in calls


@pytest.mark.asyncio
async def test_unreachable_upstream_is_logged(tmp_path, monkeypatch, caplog):
    monkeypatch.setenv("AGENT_API_TOKEN", "private-server-token")

    def offline(request):
        raise httpx.ConnectError("backend offline", request=request)

    caplog.set_level(logging.WARNING, logger="relohome_gateway.server")
    app = create_app(tmp_path / "web.db", httpx.MockTransport(offline))
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers=HEADERS) as client,
    ):
        await client.post(
            "/web/api/auth/register",
            json={"name": "Test", "email": "offline@example.test", "password": "a-long-password"},
        )
        assert (await client.get("/web/api/moving/services?lat=10.77&lng=106.7")).status_code == 502
    upstream = next(r for r in caplog.records if r.getMessage().startswith("upstream request failed"))
    assert upstream.getMessage().startswith(
        "upstream request failed target=backend method=GET path=/ui/moving/services"
    )
    assert upstream.exc_info and isinstance(upstream.exc_info[1], httpx.ConnectError)
