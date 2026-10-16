"""Every service's private operation stays private even when called outside the UI."""

import httpx
import pytest
from relohome_gateway.server import create_app

PRIVATE = [
    ("GET", "/profile/traveler"),
    ("PUT", "/profile/traveler"),
    ("DELETE", "/profile/traveler"),
    ("PATCH", "/profile"),
    ("PUT", "/saved/home"),
    ("DELETE", "/saved/home"),
    ("POST", "/threads/th/moving/quote"),
    ("POST", "/threads/th/decision"),
    ("POST", "/threads/th/payment/check"),
    ("GET", "/threads/th/payment/qr.svg"),
    ("POST", "/threads/th/checkout/summary"),
    ("POST", "/checkout/tx/pay"),
    ("POST", "/checkout/attempts/attempt/check"),
    ("GET", "/checkout/attempts/attempt/qr.svg"),
    *[
        ("POST", "/threads/th/viewings/" + step)
        for step in ["schedule", "cancel", "visit-review", "decide", "paid", "moving-mode", "landlord-retry"]
    ],
    ("GET", "/landlord/viewing-options"),
    ("POST", "/landlord/listings/listing/media-upload"),
    *[
        ("GET", "/roommate/" + path)
        for path in [
            "access",
            "me/intro",
            "me/profile",
            "me/contacts",
            "me/bookmarks",
            "requests",
            "profiles/profile",
            "media/image",
        ]
    ],
    *[("POST", "/roommate/" + path) for path in ["search", "requests", "requests/request/accept", "media"]],
    ("PUT", "/roommate/me/intro"),
    ("PUT", "/roommate/me/contacts"),
    *[
        ("GET", "/housing-management/" + path)
        for path in [
            "host/profile",
            "landlord/properties",
            "landlord/contact-requests",
            "housing/contact-requests/me",
            "housing/home/reviews",
            "moderation/housing/queue",
        ]
    ],
    ("POST", "/housing-management/housing/home/contact-requests"),
    ("POST", "/housing-management/housing/contact-requests/request/messages"),
]


@pytest.mark.asyncio
@pytest.mark.parametrize("method,path", PRIVATE)
async def test_guest_is_blocked_before_any_upstream_call(method, path, tmp_path, monkeypatch):
    monkeypatch.setenv("RELOHOME_GUEST_ENABLED", "true")
    monkeypatch.setenv("AGENT_API_TOKEN", "test-internal-token")
    calls = []

    def upstream(request):
        calls.append(request)
        return httpx.Response(200, json={})

    app = create_app(tmp_path / "web.sqlite3", httpx.MockTransport(upstream))
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client,
    ):
        await client.get("/web/api/session")
        response = await client.request(
            method, "/web/api" + path, json={}, headers={"X-SIU-Request": "1", "X-User-Id": "spoofed-account"}
        )
        assert response.status_code == 401
        assert response.json()["code"] == "authentication_required"
        assert response.headers["cache-control"] == "no-store"
        assert calls == []


@pytest.mark.asyncio
async def test_public_service_reads_work_without_login(tmp_path, monkeypatch):
    monkeypatch.setenv("RELOHOME_GUEST_ENABLED", "true")
    monkeypatch.setenv("AGENT_API_TOKEN", "test-internal-token")
    owners = []

    def upstream(request):
        owners.append(request.headers["x-user-id"])
        return httpx.Response(200, json={"ok": True})

    app = create_app(tmp_path / "web.sqlite3", httpx.MockTransport(upstream))
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client,
    ):
        guest = (await client.get("/web/api/session")).json()
        for method, path in [
            ("GET", "/housing/home"),
            ("GET", "/flight/offer"),
            ("GET", "/map/search?text=Ocean%20Park"),
            ("GET", "/moving/services?lat=10.84&lng=106.67"),
            *[
                ("POST", "/platform/" + resource)
                for resource in ["housing/map", "housing/search", "places/map", "routes/entities", "routes/device"]
            ],
        ]:
            response = await client.request(method, "/web/api" + path, json={}, headers={"X-SIU-Request": "1"})
            assert response.status_code == 200, response.text
            assert response.headers["cache-control"] == "no-store"
        assert owners == [guest["id"]] * 9
        availability = await client.get("/web/api/roommate/availability")
        assert availability.json() == {"enabled": False, "requires_account": True}
