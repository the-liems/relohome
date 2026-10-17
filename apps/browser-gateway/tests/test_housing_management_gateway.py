import io
import json
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from PIL import Image
from relohome_gateway.server import create_app

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
        response = await client.get("/web/api/housing-management/landlord/revenue?months=6")
        assert response.status_code == 200
        assert response.json()["path"].endswith("/v1/landlord/revenue")
        assert calls[-1].url.params["months"] == "6"
        assert (await client.get("/web/api/housing-management/arbitrary/admin")).status_code == 404
        response = await client.patch(
            f"/web/api/housing-management/landlord/listings/{LISTING}",
            json={"revision": 1, "title": "Nhà mới"},
        )
        assert response.status_code == 200
        assert json.loads(calls[-1].content)["revision"] == 1


@pytest.mark.asyncio
# An empty public URL (as in the env template) falls back to the request origin.
@pytest.mark.parametrize(("public_base", "origin"), [("https://example.test", "https://example.test"), ("", "http://test")])
async def test_housing_image_upload_is_sanitized_and_registered(tmp_path, monkeypatch, public_base, origin):
    monkeypatch.setenv("AGENT_API_TOKEN", "server-token")
    monkeypatch.setenv("SIU_PUBLIC_BASE_URL", public_base)
    monkeypatch.setenv("SIU_HOUSING_MEDIA_DIR", str(tmp_path / "media"))

    def provider(request):
        if request.method == "GET":
            return httpx.Response(200, json={"public": False})
        body = json.loads(request.content)
        assert body["url"].startswith(origin + "/web/media/housing/")
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
        assert review.status_code == 403
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
        if request.url.path.endswith("/housing/privacy-projections"):
            return httpx.Response(200, json={"items": []})
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
@pytest.mark.parametrize("test_anytime", [False, True])
@pytest.mark.parametrize("hidden", [False, True])
async def test_visit_needs_landlord_confirmation_for_managed_homes(tmp_path, monkeypatch, test_anytime, hidden):
    monkeypatch.setenv("AGENT_API_TOKEN", "server-token")
    monkeypatch.setenv("HOUSING_VIEWING_TEST_VISIT_ANYTIME", "true" if test_anytime else "false")
    managed, crawled = "aaaaaaaa-1111-4111-8111-111111111111", "bbbbbbbb-1111-4111-8111-111111111111"
    slot = "2026-10-10T13:00:00+07:00"
    view = {
        "test_visit_anytime": test_anytime,
        "items": [
            {"listing_id": managed, "status": "visit_due", "viewing": {"slot": slot}},
            {"listing_id": crawled, "status": "visit_due", "viewing": {"slot": slot}},
        ],
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
            if hidden:
                return httpx.Response(404, json={"message": "Not public"})
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
            "viewing_options": [],
        }
        # Even a confirmed contact cannot stand in for a missing booked slot.
        view["items"][0].pop("viewing")
        missing = await client.post(url, json={"listing_id": managed, "outcome": "met_agreed"})
        assert missing.status_code == 409 and visits == [crawled, managed]


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
        assert (await client.get("/web/api/housing-management/moderation/housing/reviews")).status_code == 403
        assert (
            await client.post(
                f"/web/api/housing-management/housing/reviews/{listing}/report", json={"reason": "Cần kiểm tra."}
            )
        ).status_code == 200
        assert (await client.get("/web/api/housing-management/housing/reviews/export")).status_code == 404


@pytest.mark.asyncio
async def test_review_gateway_names_public_authors_and_drops_ids(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENT_API_TOKEN", "server-token")
    authors = {}

    def provider(request):
        if request.method == "PUT":
            return httpx.Response(200, json={
                "id": "r1", "author_user_id": authors["public"],
                "is_anonymous": json.loads(request.content)["is_anonymous"],
            })
        return httpx.Response(
            200,
            json={
                "items": [
                    {"id": "r1", "is_anonymous": False, "author_user_id": authors["public"]},
                    {"id": "r2", "is_anonymous": True, "author_user_id": authors["public"]},
                    {"id": "r3", "is_anonymous": True},
                ],
                "mine": {"id": "r1", "is_anonymous": False, "author_user_id": authors["public"]},
            },
        )

    app = create_app(tmp_path / "review-names.db", httpx.MockTransport(provider))
    listing = "aaaaaaaa-1111-4111-8111-111111111111"
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
            headers=HEADERS,
        ) as client,
    ):
        registered = (
            await client.post(
                "/web/api/auth/register",
                json={"email": "named@example.test", "password": "a-long-password", "name": "Lan Anh"},
            )
        ).json()
        authors["public"] = registered["id"]
        for path in [f"housing/{listing}/reviews", "landlord/reviews"]:
            body = (await client.get(f"/web/api/housing-management/{path}")).json()
            assert registered["id"] not in json.dumps(body)
            assert [r["author_name"] for r in body["items"]] == ["Lan Anh", None, None]
            assert body["mine"]["author_name"] == "Lan Anh"
        for anonymous in [False, True]:
            saved = await client.put(
                f"/web/api/housing-management/housing/{listing}/review",
                json={"rating": 4, "body": "Phòng sáng.", "is_anonymous": anonymous},
            )
            assert saved.status_code == 200
            assert "author_user_id" not in saved.json()
            assert saved.json()["author_name"] == (None if anonymous else "Lan Anh")


@pytest.mark.asyncio
async def test_unchanged_rejected_listing_keeps_its_code_for_the_browser(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENT_API_TOKEN", "server-token")

    def provider(request):
        return httpx.Response(
            409,
            json={"code": "listing_unchanged", "message": "Bạn phải bổ sung thêm thông tin phù hợp.", "secret": "x"},
        )

    app = create_app(tmp_path / "unchanged.db", httpx.MockTransport(provider))
    listing = "aaaaaaaa-1111-4111-8111-111111111111"
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers=HEADERS) as client,
    ):
        await client.post(
            "/web/api/auth/register",
            json={"email": "owner@example.test", "password": "a-long-password", "name": "Owner"},
        )
        response = await client.post(f"/web/api/housing-management/landlord/listings/{listing}/submit", json={})
        assert response.status_code == 409
        assert response.json() == {"detail": "Bạn phải bổ sung thêm thông tin phù hợp.", "code": "listing_unchanged"}


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
        if request.url.path.endswith("/housing/privacy-projections"):
            return httpx.Response(200, json={"items": []})
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


@pytest.mark.asyncio
async def test_failed_landlord_send_is_reported_and_retried_only_by_viewing_actions(tmp_path, monkeypatch):
    """Review PR #88: a booked time the landlord inbox did not receive is reported, kept, and retried on
    the tenant's next viewing action; reads stay read-only and a changed booking drops the retry."""
    monkeypatch.setenv("AGENT_API_TOKEN", "server-token")
    listing = "aaaaaaaa-1111-4111-8111-111111111111"
    slot = (datetime.now(UTC) + timedelta(days=1)).isoformat()
    scheduled = {"items": [{"listing_id": listing, "status": "viewing_scheduled", "viewing": {"slot": slot}}]}
    state = {"view": scheduled, "platform": "down", "me": "up", "rows": []}
    writes = []

    def provider(request):
        if request.url.path.endswith("/housing/privacy-projections"):
            return httpx.Response(200, json={"items": []})
        path = request.url.path
        if path.startswith("/api/v1/ui/chat/"):
            return httpx.Response(200, json=state["view"])
        if path.startswith("/api/v1/chat/") and path.endswith("/state"):
            return httpx.Response(200, json={"viewing": state["view"]})
        if path.endswith("/housing/contact-requests/me"):
            if state["me"] == "down":
                return httpx.Response(503, json={"message": "unavailable"})
            return httpx.Response(200, json={"items": state["rows"]})
        writes.append((request.method, path))
        if state["platform"] == "down":
            return httpx.Response(503, json={"message": "unavailable"})
        state["rows"] = [
            {"id": "r1", "listing_id": listing, "status": "new", "viewing_status": "requested", "viewing_slot": slot}
        ]
        return httpx.Response(201, json={"viewing_status": "requested"})

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
        url = f"/web/api/threads/{thread}/viewings"
        booked = await client.post(url + "/schedule", json={"listing_id": listing, "slot": slot})
        assert booked.status_code == 200
        assert booked.json()["items"][0]["landlord"] == {"sync": "failed"}  # not a silent success
        # Reads show the pending send but never write.
        writes.clear()
        assert (await client.get(url)).json()["items"][0]["landlord"] == {"sync": "failed"}
        snapshot = (await client.get(f"/web/api/threads/{thread}")).json()
        assert snapshot["state"]["viewing"]["items"][0]["landlord"] == {"sync": "failed"}
        assert writes == []
        # The tenant's next viewing action retries the same booking once the platform is back.
        state["platform"] = "up"
        retried = await client.post(url + "/landlord-retry", json={})
        assert writes == [("PUT", f"/v1/housing/{listing}/viewing")]
        assert retried.json()["items"][0]["landlord"]["viewing_status"] == "requested"
        writes.clear()
        await client.post(url + "/moving-mode", json={"mode": None})
        assert writes == []  # delivered: nothing left to retry


@pytest.mark.asyncio
async def test_contact_list_outage_is_reported_and_a_changed_booking_drops_the_retry(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENT_API_TOKEN", "server-token")
    listing = "aaaaaaaa-1111-4111-8111-111111111111"
    slot = (datetime.now(UTC) + timedelta(days=1)).isoformat()
    state = {
        "view": {"items": [{"listing_id": listing, "status": "viewing_scheduled", "viewing": {"slot": slot}}]},
        "me": "down",
    }
    writes = []

    def provider(request):
        path = request.url.path
        if path.startswith("/api/v1/ui/chat/"):
            return httpx.Response(200, json=state["view"])
        if path.endswith("/housing/contact-requests/me"):
            if state["me"] == "down":
                return httpx.Response(503, json={"message": "unavailable"})
            return httpx.Response(200, json={"items": []})
        writes.append((request.method, path))
        return httpx.Response(201, json={})

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
        url = f"/web/api/threads/{thread}/viewings"
        booked = await client.post(url + "/schedule", json={"listing_id": listing, "slot": slot})
        assert booked.status_code == 503  # cannot bypass unknown owner-proposed restrictions
        assert writes == []
        # The tenant cancels before the platform recovers: the pending send must not reopen it.
        state["view"] = {"items": [{"listing_id": listing, "status": "selected"}]}
        state["me"] = "up"
        await client.post(url + "/cancel", json={"listing_id": listing})
        assert writes == []


@pytest.mark.asyncio
async def test_timed_out_send_that_landed_is_not_resent_after_the_landlord_closed_it(tmp_path, monkeypatch):
    """Review PR #88: the PUT commits but its response times out; the landlord then closes the request.
    Later unrelated viewing actions must not recreate it; only an explicit booking may."""
    monkeypatch.setenv("AGENT_API_TOKEN", "server-token")
    listing = "aaaaaaaa-1111-4111-8111-111111111111"
    slot = (datetime.now(UTC) + timedelta(days=1)).isoformat()
    view = {"items": [{"listing_id": listing, "status": "viewing_scheduled", "viewing": {"slot": slot}}]}
    rows, puts, mode = [], [], {"timeout": True}

    def provider(request):
        path = request.url.path
        if path.startswith("/api/v1/ui/chat/"):
            return httpx.Response(200, json=view)
        if path.endswith("/housing/contact-requests/me"):
            return httpx.Response(200, json={"items": rows})
        if request.method == "PUT":
            puts.append(path)
            rows[:] = [
                {
                    "id": f"r{len(puts)}",
                    "listing_id": listing,
                    "status": "new",
                    "viewing_status": "requested",
                    "viewing_slot": slot,
                    "viewing_updated_at": f"2026-10-09T18:0{len(puts)}:00Z",
                }
            ]
            if mode["timeout"]:
                raise httpx.ReadTimeout("response lost", request=request)  # committed upstream
            return httpx.Response(201, json={"viewing_status": "requested"})
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
        url = f"/web/api/threads/{thread}/viewings"
        booked = (await client.post(url + "/schedule", json={"listing_id": listing, "slot": slot})).json()
        assert booked["items"][0]["landlord"] == {"sync": "failed"} and len(puts) == 1
        rows[0]["status"] = "resolved"  # the landlord closes the request that did arrive
        mode["timeout"] = False
        after = (await client.post(url + "/moving-mode", json={"mode": None})).json()
        await client.post(url + "/landlord-retry", json={})
        assert len(puts) == 1  # not recreated by unrelated actions or the retry button
        assert after["items"][0]["landlord"]["request_status"] == "resolved"
        # Booking the same time again is an explicit choice and may recreate it.
        await client.post(url + "/schedule", json={"listing_id": listing, "slot": slot})
        assert len(puts) == 2


@pytest.mark.asyncio
async def test_failed_withdrawal_is_reported_and_retried(tmp_path, monkeypatch):
    """A cancelled booking whose withdrawal failed must not stay requested in the landlord inbox."""
    monkeypatch.setenv("AGENT_API_TOKEN", "server-token")
    listing = "aaaaaaaa-1111-4111-8111-111111111111"
    slot = (datetime.now(UTC) + timedelta(days=1)).isoformat()
    view = {"items": [{"listing_id": listing, "status": "selected"}]}
    row = {"id": "r1", "listing_id": listing, "status": "new", "viewing_status": "requested", "viewing_slot": slot}
    deletes, mode = [], {"down": True}

    def provider(request):
        path = request.url.path
        if path.startswith("/api/v1/ui/chat/"):
            return httpx.Response(200, json=view)
        if path.endswith("/housing/contact-requests/me"):
            return httpx.Response(200, json={"items": [row]})
        if request.method == "DELETE":
            deletes.append(path)
            if mode["down"]:
                return httpx.Response(503, json={"message": "unavailable"})
            row.update(viewing_status="cancelled", status="declined")
            return httpx.Response(200, json={"changed": True})
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
        url = f"/web/api/threads/{thread}/viewings"
        cancelled = (await client.post(url + "/cancel", json={"listing_id": listing})).json()
        assert cancelled["landlord_withdraw_pending"] == [listing] and len(deletes) == 1
        assert (await client.get(url)).json()["landlord_withdraw_pending"] == [listing]
        assert len(deletes) == 1  # reads never write
        mode["down"] = False
        retried = (await client.post(url + "/landlord-retry", json={})).json()
        assert len(deletes) == 2 and "landlord_withdraw_pending" not in retried
        await client.post(url + "/moving-mode", json={"mode": None})
        assert len(deletes) == 2


def test_store_adds_the_sync_baseline_to_existing_databases(tmp_path):
    import sqlite3

    from relohome_gateway.store import Store

    path = tmp_path / "old.db"
    old = sqlite3.connect(path)
    old.execute(
        "CREATE TABLE landlord_sync (owner TEXT NOT NULL, thread TEXT NOT NULL, listing TEXT NOT NULL,"
        " slot TEXT NOT NULL, updated REAL NOT NULL, PRIMARY KEY(owner, thread, listing))"
    )
    old.execute("INSERT INTO landlord_sync VALUES ('u', 't', 'l', 's', 1)")
    old.commit()
    old.close()
    store = Store(path)
    assert store.one("SELECT baseline FROM landlord_sync") == {"baseline": ""}


@pytest.mark.parametrize(
    "request_status,viewing_status", [("resolved", "confirmed"), ("declined", "confirmed"), ("contacted", "cancelled")]
)
@pytest.mark.asyncio
async def test_retry_changed_time_respects_a_closed_request_even_when_remote_keeps_old_time(
    tmp_path, monkeypatch, request_status, viewing_status
):
    monkeypatch.setenv("AGENT_API_TOKEN", "server-token")
    listing = "aaaaaaaa-1111-4111-8111-111111111111"
    old_slot = (datetime.now(UTC) + timedelta(days=1)).isoformat()
    new_slot = (datetime.now(UTC) + timedelta(days=2)).isoformat()
    view = {"items": [{"listing_id": listing, "status": "viewing_scheduled", "viewing": {"slot": new_slot}}]}
    row = {
        "id": "bbbbbbbb-1111-4111-8111-111111111111",
        "listing_id": listing,
        "status": "viewing",
        "viewing_status": "confirmed",
        "viewing_slot": old_slot,
        "viewing_updated_at": "2026-10-09T18:00:00Z",
    }
    writes, mode = [], {"down": True}

    def provider(request):
        path = request.url.path
        if path.startswith("/api/v1/ui/chat/"):
            return httpx.Response(200, json=view)
        if path.endswith("/housing/contact-requests/me"):
            return httpx.Response(200, json={"items": [row]})
        if request.method == "PUT":
            writes.append(path)
            if mode["down"]:
                return httpx.Response(503, json={"message": "unavailable"})
            row.update(
                id="cccccccc-1111-4111-8111-111111111111",
                status="new",
                viewing_status="requested",
                viewing_slot=new_slot,
            )
            return httpx.Response(201, json={"viewing_status": "requested"})
        return httpx.Response(200, json={})

    app = create_app(tmp_path / "web.db", httpx.MockTransport(provider))
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers=HEADERS) as client,
    ):
        await client.post(
            "/web/api/auth/register",
            json={"email": "retry@example.test", "password": "a-long-password", "name": "Tenant"},
        )
        thread = (await client.post("/web/api/threads")).json()["id"]
        url = f"/web/api/threads/{thread}/viewings"
        booked = await client.post(url + "/schedule", json={"listing_id": listing, "slot": new_slot})
        assert booked.json()["items"][0]["landlord"] == {"sync": "failed"}
        assert len(writes) == 1
        row.update(status=request_status, viewing_status=viewing_status)
        mode["down"] = False

        retried = (await client.post(url + "/landlord-retry", json={})).json()
        assert len(writes) == 1  # a retry must not recreate the closed request
        assert retried["items"][0]["viewing"]["slot"] == new_slot  # preserve the tenant's draft booking
        assert retried["items"][0]["landlord"]["request_status"] == request_status
        assert "sync" not in retried["items"][0]["landlord"]  # show closure, not an endlessly retryable outage
        assert app.state.store.all("SELECT * FROM landlord_sync WHERE thread=?", (thread,)) == []
        await client.post(url + "/moving-mode", json={"mode": None})
        assert len(writes) == 1

        # A fresh explicit schedule, even for the same new time, may create a new request.
        explicit = (await client.post(url + "/schedule", json={"listing_id": listing, "slot": new_slot})).json()
        assert len(writes) == 2
        assert explicit["items"][0]["landlord"]["viewing_status"] == "requested"


@pytest.mark.asyncio
async def test_closed_confirmed_request_does_not_authorize_recording_a_visit(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENT_API_TOKEN", "server-token")
    listing = "aaaaaaaa-1111-4111-8111-111111111111"
    slot = (datetime.now(UTC) - timedelta(hours=1)).isoformat()
    view = {"items": [{"listing_id": listing, "status": "visit_due", "viewing": {"slot": slot}}]}
    visits = []

    def provider(request):
        path = request.url.path
        if path.endswith("/viewings/visit"):
            visits.append(path)
            return httpx.Response(200, json=view)
        if path.startswith("/api/v1/ui/chat/"):
            return httpx.Response(200, json=view)
        if path.endswith("/housing/contact-requests/me"):
            return httpx.Response(
                200,
                json={
                    "items": [
                        {
                            "listing_id": listing,
                            "status": "resolved",
                            "viewing_status": "confirmed",
                            "viewing_slot": slot,
                        }
                    ]
                },
            )
        if path == f"/v1/housing/{listing}":
            return httpx.Response(200, json={"listing_id": listing, "management": {"accepts_contact_requests": True}})
        return httpx.Response(200, json={})

    app = create_app(tmp_path / "web.db", httpx.MockTransport(provider))
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers=HEADERS) as client,
    ):
        await client.post(
            "/web/api/auth/register",
            json={"email": "visit@example.test", "password": "a-long-password", "name": "Tenant"},
        )
        thread = (await client.post("/web/api/threads")).json()["id"]
        response = await client.post(
            f"/web/api/threads/{thread}/viewings/visit", json={"listing_id": listing, "outcome": "met_agreed"}
        )
        assert response.status_code == 409
        assert visits == []


@pytest.mark.asyncio
async def test_handoff_allowlist_and_stale_browser_session_cannot_send_as_another_account(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENT_API_TOKEN", "server-token")
    calls = []

    def provider(request):
        calls.append(request)
        return httpx.Response(200, json={"ok": True})

    app = create_app(tmp_path / "web.db", httpx.MockTransport(provider))
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers=HEADERS) as client,
    ):
        registered = (
            await client.post(
                "/web/api/auth/register",
                json={"email": "handoff@example.test", "password": "a-long-password", "name": "Tenant"},
            )
        ).json()
        path = f"/web/api/housing-management/housing/contact-requests/{LISTING}/messages"
        assert (
            await client.post(path, json={"body": "Hello"}, headers={"X-SIU-User": "old-account"})
        ).status_code == 409
        assert calls == []
        assert (
            await client.post(path, json={"body": "Hello"}, headers={"X-SIU-User": registered["id"]})
        ).status_code == 200
        assert calls[-1].headers["X-User-Id"] == registered["id"]
        for suffix in ["viewing-options", "payment-review", "archive"]:
            assert (
                await client.post(f"/web/api/housing-management/landlord/contact-requests/{LISTING}/{suffix}", json={})
            ).status_code == 200
        assert (await client.get("/web/api/housing-management/housing/contact-notifications")).status_code == 200
        assert (
            await client.post(f"/web/api/housing-management/housing/{LISTING}/payment-reports", json={})
        ).status_code == 404


@pytest.mark.asyncio
async def test_owner_proposals_limit_calendar_and_block_non_proposed_slot_before_agent_write(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENT_API_TOKEN", "server-token")
    old = "2026-10-14T09:00:00+07:00"
    suggested = "2026-10-15T10:00:00+07:00"
    row = {
        "id": LISTING,
        "listing_id": LISTING,
        "status": "new",
        "viewing_status": "declined",
        "viewing_slot": old,
        "viewing_options": ["2026-10-15T03:00:00Z"],
    }
    view = {
        "items": [{"listing_id": LISTING, "status": "visit_due", "viewing": {"slot": old}}],
        "slots": [old, suggested],
    }
    writes = []

    def provider(request):
        if request.url.path.endswith("/housing/contact-requests/me"):
            return httpx.Response(200, json={"items": [row]})
        if request.method == "POST" and request.url.path.endswith("/viewings/schedule"):
            writes.append(json.loads(request.content))
        return httpx.Response(200, json=view)

    app = create_app(tmp_path / "web.db", httpx.MockTransport(provider))
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers=HEADERS) as client,
    ):
        await client.post(
            "/web/api/auth/register",
            json={"email": "proposal@example.test", "password": "a-long-password", "name": "Tenant"},
        )
        thread = (await client.post("/web/api/threads")).json()["id"]
        path = f"/web/api/threads/{thread}/viewings"
        assert (await client.get(path)).json()["items"][0]["available_slots"] == [suggested]
        assert (await client.post(path + "/schedule", json={"listing_id": LISTING, "slot": old})).status_code == 409
        assert writes == []
        row["viewing_options"] = []
        assert (await client.get(path)).json()["items"][0]["available_slots"] == []


@pytest.mark.asyncio
@pytest.mark.parametrize("legacy", [False, True])
async def test_reported_money_sync_retries_and_confirmed_reports_cannot_be_overwritten(tmp_path, monkeypatch, legacy):
    monkeypatch.setenv("AGENT_API_TOKEN", "server-token")
    slot = "2026-10-14T09:00:00+07:00"
    item = {
        "listing_id": LISTING,
        "status": "agreed",
        "viewing": {"slot": slot},
        "agreement": {"deposit_vnd": 5, "first_month_vnd": 5},
    }
    view = {"items": [item]}
    row = {
        "id": LISTING,
        "listing_id": LISTING,
        "status": "viewing",
        "viewing_status": "confirmed",
        "viewing_slot": slot,
    }
    state, writes = {"fail": True, "hidden": False}, []

    def provider(request):
        path = request.url.path
        if path.endswith("/housing/contact-requests/me"):
            return httpx.Response(200, json={"items": [row]})
        if path == f"/v1/housing/{LISTING}":
            if state["hidden"]:
                return httpx.Response(404, json={"message": "Not public"})
            return httpx.Response(200, json={"management": {"accepts_contact_requests": True}})
        if path.endswith("/payment-reports"):
            writes.append(json.loads(request.content))
            if state["fail"]:
                return httpx.Response(503, json={"message": "unavailable"})
            report = {"id": LISTING, "status": "pending", **writes[-1]}
            row["payment_report"] = report
            return httpx.Response(201, json=report)
        if path.endswith("/viewings/paid"):
            data = json.loads(request.content)
            item.update(
                status="reported_paid",
                reported_payment={
                    "report_key": data["request_id"],
                    "amount_vnd": data["amount_vnd"],
                    "paid_on": data["paid_on"],
                },
            )
        return httpx.Response(200, json=view)

    app = create_app(tmp_path / "web.db", httpx.MockTransport(provider))
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers=HEADERS) as client,
    ):
        await client.post(
            "/web/api/auth/register",
            json={"email": "money@example.test", "password": "a-long-password", "name": "Tenant"},
        )
        thread = (await client.post("/web/api/threads")).json()["id"]
        path = f"/web/api/threads/{thread}/viewings"
        body = {"request_id": "report-key-one", "amount_vnd": 10, "paid_on": "2026-10-13"}
        first = await client.post(path + "/paid", json=body)
        assert first.status_code == 200 and first.json()["items"][0]["payment_sync"] == "failed"
        state["fail"], state["hidden"] = False, True
        if legacy:
            item["reported_payment"].pop("report_key")
            item["transaction_id"] = body["request_id"]
        retried = await client.post(path + "/payment-retry", json={})
        assert retried.json()["items"][0]["payment_report"]["status"] == "pending"
        assert writes[0] == writes[1] and writes[1]["agreement"]["first_month_vnd"] == 5
        assert (await client.post(path + "/paid", json={**body, "request_id": "another-key"})).status_code == 409
        row["payment_report"]["status"], row["status"] = "confirmed", "resolved"
        assert (await client.post(path + "/paid", json=body)).status_code == 200  # retry after lost response
        assert (await client.post(path + "/paid", json={**body, "amount_vnd": 11})).status_code == 409


@pytest.mark.asyncio
async def test_contact_names_only_enrich_authorized_participants(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENT_API_TOKEN", "server-token")
    participants = {}
    denied = False

    def provider(request):
        if denied:
            return httpx.Response(404, json={"message": "Không tìm thấy cuộc trò chuyện."})
        other = next(identity for identity in participants if identity != request.headers["X-User-Id"])
        contact = {"id": LISTING, "title": "Phòng cửa sổ", "counterparty_user_id": other}
        return httpx.Response(
            200, json={"items": [contact]} if request.url.path.endswith("contact-notifications") else contact
        )

    app = create_app(tmp_path / "web.db", httpx.MockTransport(provider))
    async with app.router.lifespan_context(app):
        async with (
            httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers=HEADERS) as owner,
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://test", headers=HEADERS
            ) as tenant,
        ):
            for client, name, email in [(owner, "Mai", "owner@example.test"), (tenant, "Khánh", "tenant@example.test")]:
                await client.post(
                    "/web/api/auth/register", json={"email": email, "password": "a-long-password", "name": name}
                )
                session = (await client.get("/web/api/session")).json()
                participants[session["id"]] = name
            for client, expected_name in [(owner, "Khánh"), (tenant, "Mai")]:
                for path in ["housing/contact-notifications", f"housing/contact-requests/{LISTING}/messages"]:
                    # Client input cannot replace the server-authorized counterparty.
                    result = await client.get(f"/web/api/housing-management/{path}?counterparty_user_id=spoof")
                    assert result.status_code == 200
                    contact = result.json().get("items", [result.json()])[0]
                    assert contact["counterparty_name"] == expected_name
                    assert not {"email", "password", "phone"}.intersection(contact)
            denied = True
            response = await owner.get(f"/web/api/housing-management/housing/contact-requests/{LISTING}/messages")
            assert response.status_code == 404
            assert "counterparty_name" not in response.json()
