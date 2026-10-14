"""Gateway side of in-app payment: encrypted booker profile, passengers injected server-side, error codes kept."""

import json

import httpx
import pytest
from relohome_gateway.server import create_app

HEADERS = {"X-SIU-Request": "1", "Origin": "http://test"}
BOOKER = {
    "title": "MR",
    "last_name": "Nguyễn",
    "first_name": "Văn An",
    "date_of_birth": "1990-01-01",
    "email": "an@example.test",
    "phone": "0901 234 567",
}


@pytest.mark.asyncio
async def test_booker_profile_is_encrypted_and_injected_into_flight_payment(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENT_API_TOKEN", "private-server-token")
    calls = []

    def provider(request):
        calls.append(request)
        if request.url.path.endswith("/pay"):
            body = json.loads(request.content)
            if "passengers" not in body:
                return httpx.Response(409, json={"detail": "Giá đã thay đổi.", "code": "price_changed"})
            return httpx.Response(200, json={"attempt": {"attempt_id": "pa_x"}, "transaction": {}})
        if request.url.path.endswith("/qr"):
            return httpx.Response(200, json={"qr_code": "zalopay://sandbox/qr"})
        return httpx.Response(404, json={"detail": "x"})

    app = create_app(tmp_path / "web.db", httpx.MockTransport(provider))
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers=HEADERS) as client,
    ):
        await client.post(
            "/web/api/auth/register",
            json={"name": "Test", "email": "pay@example.test", "password": "a-long-password"},
        )
        pay = {"payload_hash": "a" * 64, "request_key": "request-key-0001", "companions": []}
        missing = await client.post("/web/api/checkout/tx_a/pay", json=pay)
        assert missing.status_code == 422 and not calls
        assert (await client.put("/web/api/profile/traveler", json={**BOOKER, "phone": "abc"})).status_code == 422
        too_young = await client.put("/web/api/profile/traveler", json={**BOOKER, "date_of_birth": "2026-01-01"})
        assert too_young.status_code == 422 and "12 tuổi" in too_young.json()["detail"]
        assert (await client.put("/web/api/profile/traveler", json=BOOKER)).status_code == 200
        raw = app.state.store.db.execute("SELECT data FROM traveler_profiles").fetchone()[0]
        assert b"0901" not in raw and b"Nguy" not in raw
        companion = {
            "type": "child",
            "title": "MSTR",
            "last_name": "Nguyen",
            "first_name": "Binh",
            "date_of_birth": "2018-05-01",
        }
        ok = await client.post("/web/api/checkout/tx_a/pay", json={**pay, "companions": [companion]})
        assert ok.status_code == 200
        sent = json.loads(calls[-1].content)["passengers"]
        assert [p["type"] for p in sent["passengers"]] == ["adult", "child"]
        assert sent["passengers"][0]["last_name"] == "NGUYEN" and sent["contact"]["phone"] == "0901234567"
        # Moving: no companions field, so no personal data leaves the gateway; provider error code is kept.
        moving = await client.post(
            "/web/api/checkout/tx_b/pay", json={"payload_hash": "a" * 64, "request_key": "request-key-0002"}
        )
        assert moving.status_code == 409 and moving.json()["code"] == "price_changed"
        assert "passengers" not in json.loads(calls[-1].content)
        qr = await client.get("/web/api/checkout/attempts/pa_x/qr.svg")
        assert qr.status_code == 200 and qr.headers["content-type"].startswith("image/svg+xml")
        # Messages never carry the booker.
        assert "an@example.test" not in json.dumps(app.state.store.all("SELECT content FROM messages"))
        assert (await client.delete("/web/api/profile/traveler")).status_code == 200
        assert (await client.get("/web/api/profile/traveler")).json()["traveler"] is None
