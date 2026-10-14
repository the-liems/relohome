"""Scoped activity links and reviewed viewing decisions never trust a client's participant identity."""

import json
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from relohome_gateway.server import create_app

HEADERS = {"X-SIU-Request": "1", "Origin": "http://test"}
LISTING = "aaaaaaaa-1111-4111-8111-111111111111"


@pytest.mark.asyncio
@pytest.mark.parametrize("outcome", ["met_agreed", "met_rejected"])
async def test_review_is_saved_before_visit_and_retry_does_not_duplicate(tmp_path, monkeypatch, outcome):
    monkeypatch.setenv("AGENT_API_TOKEN", "trusted-token")
    calls = []
    slot = (datetime.now(UTC) + timedelta(days=1)).isoformat()
    item = {"listing_id": LISTING, "status": "visit_due", "viewing": {"slot": slot}, "landlord": {}}
    view = {"items": [item], "history": [], "test_visit_anytime": True}

    def provider(request):
        path = request.url.path
        if path.endswith("/contact-requests/me"):
            return httpx.Response(
                200,
                json={
                    "items": [
                        {
                            "listing_id": LISTING,
                            "status": "viewing",
                            "viewing_status": "confirmed",
                            "viewing_slot": slot,
                        }
                    ]
                },
            )
        if path.endswith("/housing/" + LISTING):
            return httpx.Response(200, json={"management": {"accepts_contact_requests": True}})
        if path.endswith("/review"):
            calls.append("review")
            return httpx.Response(200, json={"rating": 4, "stage": "viewed"})
        if path.endswith("/visit"):
            calls.append("visit")
            payload = json.loads(request.content)
            item.update(
                visit_review=payload["review"],
                visit_outcome={"outcome": payload["outcome"]},
                status="visited" if outcome == "met_agreed" else "dropped",
            )
            if outcome == "met_rejected":
                view["items"] = []
                view["history"] = [item]
            return httpx.Response(200, json=view)
        if path.endswith("/viewing") and request.method == "DELETE":
            return httpx.Response(200, json={"withdrawn": True})
        if path.endswith("/viewings"):
            return httpx.Response(200, json=view)
        return httpx.Response(200, json={})

    app = create_app(tmp_path / "web.db", httpx.MockTransport(provider))
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers=HEADERS) as client,
    ):
        await client.post(
            "/web/api/auth/register",
            json={"email": "review@example.test", "password": "a-long-password", "name": "Tenant"},
        )
        thread = (await client.post("/web/api/threads")).json()["id"]
        path = f"/web/api/threads/{thread}/viewings/visit-review"
        body = {"listing_id": LISTING, "outcome": outcome, "rating": 4, "body": "Trải nghiệm tốt"}
        assert (await client.post(path, json={**body, "rating": 0})).status_code == 422
        view["test_visit_anytime"] = False
        assert (await client.post(path, json=body)).status_code == 409
        assert calls == []
        view["test_visit_anytime"] = True
        assert (await client.post(path, json=body)).status_code == 200
        assert calls == ["review", "visit"]
        assert (await client.post(path, json=body)).status_code == 200
        assert calls == ["review", "visit"]
