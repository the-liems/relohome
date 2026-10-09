import io
import json
from datetime import UTC, datetime, timedelta

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
        result = (
            await client.post(
                f"/web/api/threads/{thread}/viewings/schedule", json={"listing_id": managed, "slot": slot}
            )
        ).json()
        # Only the home just booked is sent; the home that lost its time is withdrawn.
        assert sorted(platform_calls) == [
            ("DELETE", f"/v1/housing/{dropped}/viewing"),
            ("PUT", f"/v1/housing/{managed}/viewing"),
        ]
        assert result["items"][0]["landlord"]["viewing_status"] == "requested"
        assert "landlord" not in result["items"][1]  # other sources stay in test mode
        # The landlord confirmed; an unchanged slot is not sent again and the answer is shown.
        mine[0]["viewing_status"], mine[0]["status"] = "confirmed", "viewing"
        mine.pop()  # the dropped home's request was cancelled
        platform_calls.clear()
        result = (await client.get(f"/web/api/threads/{thread}/viewings")).json()
        assert ("PUT", f"/v1/housing/{managed}/viewing") not in platform_calls
        assert result["items"][0]["landlord"]["viewing_status"] == "confirmed"
        # The plan tab reads the thread snapshot; it carries the same answer.
        snapshot = (await client.get(f"/web/api/threads/{thread}")).json()
        assert snapshot["state"]["viewing"]["items"][0]["landlord"]["viewing_status"] == "confirmed"


@pytest.mark.parametrize(
    "request_status,viewing_status,resend",
    [
        ("new", "requested", False),
        ("viewing", "confirmed", False),
        ("new", "declined", False),
        ("declined", "cancelled", True),
        ("contacted", "cancelled", True),
        ("resolved", "confirmed", True),
    ],
)
@pytest.mark.asyncio
async def test_rebooking_same_time_resends_cancelled_or_closed_requests(
    tmp_path, monkeypatch, request_status, viewing_status, resend
):
    monkeypatch.setenv("AGENT_API_TOKEN", "server-token")
    listing = "aaaaaaaa-1111-4111-8111-111111111111"
    slot = (datetime.now(UTC) + timedelta(days=1)).isoformat()
    view = {"items": [{"listing_id": listing, "status": "viewing_scheduled", "viewing": {"slot": slot}}]}
    row = {"listing_id": listing, "status": request_status, "viewing_status": viewing_status, "viewing_slot": slot}
    sent = []

    def provider(request):
        if request.url.path.startswith("/api/v1/ui/chat/"):
            return httpx.Response(200, json=view)
        if request.url.path.endswith("/housing/contact-requests/me"):
            return httpx.Response(200, json={"items": [row]})
        if request.method == "PUT":
            sent.append(request.url.path)
            row.update(status="new", viewing_status="requested")
            return httpx.Response(201, json={"viewing_status": "requested"})
        return httpx.Response(200, json={})

    app = create_app(tmp_path / "web.db", httpx.MockTransport(provider))
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
            headers=HEADERS,
        ) as client,
    ):
        await client.post(
            "/web/api/auth/register",
            json={"email": "tenant@example.test", "password": "a-long-password", "name": "Tenant"},
        )
        thread = (await client.post("/web/api/threads")).json()["id"]
        response = await client.post(
            f"/web/api/threads/{thread}/viewings/schedule", json={"listing_id": listing, "slot": slot}
        )
        assert response.status_code == 200
        assert len(sent) == int(resend)
        assert response.json()["items"][0]["landlord"]["viewing_status"] == ("requested" if resend else viewing_status)


@pytest.mark.asyncio
async def test_visit_needs_landlord_confirmation_for_managed_homes(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENT_API_TOKEN", "server-token")
    managed, crawled = "aaaaaaaa-1111-4111-8111-111111111111", "bbbbbbbb-1111-4111-8111-111111111111"
    slot = "2026-10-10T13:00:00+07:00"
    view = {
        "items": [
            {"listing_id": managed, "status": "visit_due", "viewing": {"slot": slot}},
            {"listing_id": crawled, "status": "visit_due", "viewing": {"slot": slot}},
        ]
    }
    row = {
        "id": "r1",
        "listing_id": managed,
        "status": "new",
        "viewing_status": "requested",
        "viewing_slot": "2026-10-10T06:00:00.000Z",
        "unread": 2,
    }
    visits = []

    def provider(request):
        path = request.url.path
        if path.endswith("/viewings/visit"):
            visits.append(json.loads(request.content)["listing_id"])
            return httpx.Response(200, json=view)
        if path.startswith("/api/v1/ui/chat/"):
            return httpx.Response(200, json=view)
        if path.endswith("/housing/contact-requests/me"):
            return httpx.Response(200, json={"items": [row]})
        if path == f"/v1/housing/{managed}":
            return httpx.Response(200, json={"listing_id": managed, "management": {"accepts_contact_requests": True}})
        if path == f"/v1/housing/{crawled}":
            return httpx.Response(200, json={"listing_id": crawled, "management": None})
        return httpx.Response(409, json={"code": "not_managed", "message": "x"})

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
        url = f"/web/api/threads/{thread}/viewings/visit"
        blocked = await client.post(url, json={"listing_id": managed, "outcome": "met_agreed"})
        assert blocked.status_code == 409 and visits == []
        # Homes from other sources keep the test-mode flow.
        assert (await client.post(url, json={"listing_id": crawled, "outcome": "met_agreed"})).status_code == 200
        row["viewing_status"], row["status"] = "confirmed", "viewing"
        allowed = await client.post(url, json={"listing_id": managed, "outcome": "met_agreed"})
        assert allowed.status_code == 200 and visits == [crawled, managed]
        assert allowed.json()["items"][0]["landlord"] == {
            "viewing_status": "confirmed",
            "request_status": "viewing",
            "request_id": "r1",
            "unread": 2,
        }


@pytest.mark.asyncio
async def test_review_gateway_preserves_session_identity_and_pagination(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENT_API_TOKEN", "server-token")
    captured = []

    def provider(request):
        captured.append(request)
        return httpx.Response(200, json={"ok": True})

    app = create_app(tmp_path / "reviews.db", httpx.MockTransport(provider))
    listing = "aaaaaaaa-1111-4111-8111-111111111111"
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
            headers=HEADERS,
        ) as client,
    ):
        assert (await client.get(f"/web/api/housing-management/housing/{listing}/reviews")).status_code == 401
        registered = (
            await client.post(
                "/web/api/auth/register",
                json={"email": "reviews@example.test", "password": "a-long-password", "name": "Tenant"},
            )
        ).json()
        response = await client.get(
            f"/web/api/housing-management/housing/{listing}/reviews?sort=lowest&limit=20&offset=10",
            headers={"X-User-Id": "forged"},
        )
        assert response.status_code == 200
        assert captured[-1].url.params == httpx.QueryParams("sort=lowest&limit=20&offset=10")
        assert captured[-1].headers["x-user-id"] == registered["id"]
        assert (
            await client.put(f"/web/api/housing-management/housing/{listing}/review", json={"rating": 4, "body": ""})
        ).status_code == 200
        assert json.loads(captured[-1].content) == {"rating": 4, "body": ""}
        withdrawn = await client.request("DELETE", f"/web/api/housing-management/housing/{listing}/review", json={})
        assert withdrawn.status_code == 200
        assert (await client.get("/web/api/housing-management/moderation/housing/reviews")).status_code == 200
        assert (
            await client.post(
                f"/web/api/housing-management/housing/reviews/{listing}/report", json={"reason": "Cần kiểm tra."}
            )
        ).status_code == 200
        assert (await client.get("/web/api/housing-management/housing/reviews/export")).status_code == 404


@pytest.mark.parametrize(
    "request_status,viewing_status", [("declined", "requested"), ("resolved", "confirmed"), ("new", "cancelled")]
)
@pytest.mark.asyncio
async def test_reads_never_reopen_closed_or_cancelled_requests(tmp_path, monkeypatch, request_status, viewing_status):
    """Review PR #88: opening the Viewings tab or the thread must not recreate a request the tenant
    cancelled or the landlord closed; only an explicit booking sends the time again."""
    monkeypatch.setenv("AGENT_API_TOKEN", "server-token")
    listing = "aaaaaaaa-1111-4111-8111-111111111111"
    slot = (datetime.now(UTC) + timedelta(days=1)).isoformat()
    view = {"items": [{"listing_id": listing, "status": "viewing_scheduled", "viewing": {"slot": slot}}]}
    row = {
        "id": "r1",
        "listing_id": listing,
        "status": request_status,
        "viewing_status": viewing_status,
        "viewing_slot": slot,
    }
    writes = []

    def provider(request):
        path = request.url.path
        if path.startswith("/api/v1/ui/chat/"):
            return httpx.Response(200, json=view)
        if path.startswith("/api/v1/chat/") and path.endswith("/state"):
            return httpx.Response(200, json={"viewing": view})
        if path.endswith("/housing/contact-requests/me"):
            return httpx.Response(200, json={"items": [row]})
        writes.append((request.method, path))
        return httpx.Response(200, json={})

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
        tab = (await client.get(f"/web/api/threads/{thread}/viewings")).json()
        snapshot = (await client.get(f"/web/api/threads/{thread}")).json()
        assert writes == []
        # The tab shows the closed state instead of pretending the time is still pending.
        assert tab["items"][0]["landlord"]["request_status"] == request_status
        assert snapshot["state"]["viewing"]["items"][0]["landlord"]["viewing_status"] == viewing_status
        # Other steps (e.g. visit, unselect another home) do not resend it either.
        await client.post(f"/web/api/threads/{thread}/viewings/moving-mode", json={"mode": None})
        assert writes == []
