import httpx
import pytest
from relohome_agent.api.roommate_profiles import router

from tests.test_roommate.test_discovery_api import headers, make_app
from tests.test_roommate.test_profile_lifecycle import complete


@pytest.mark.asyncio
@pytest.mark.parametrize("listing_city,status", [("Hà Nội", 422), ("Hồ Chí Minh", 200), (None, 200)])
async def test_binding_checks_known_listing_city_without_inventing_unknown_city(
    tmp_path, monkeypatch, listing_city, status
):
    from types import SimpleNamespace

    app, runtime = make_app(tmp_path)
    app.include_router(router, prefix="/api/v1")
    app.state.agent_service = SimpleNamespace()

    async def listing(*_):
        return {"id": "room", "city": listing_city}

    monkeypatch.setattr("relohome_agent.api.roommate_profiles.explored_listing", listing)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        await client.post(
            "/api/v1/roommate/access", json={"adult": True, "terms_version": "roommate-1.0"}, headers=headers()
        )
        content = complete().model_dump(mode="json")
        content["facts"]["need"] = {"kind": "has_room", "willing_to_move": False}
        content["room"] = {"listing_id": "room", "public_location_consent": True}
        response = await client.put(
            "/api/v1/roommate/me/profile", json={"content": content, "expected_version": None}, headers=headers()
        )
        assert response.status_code == status
        if status == 422:
            assert response.json()["detail"]["code"] == "room_city_mismatch"


@pytest.mark.asyncio
async def test_own_profile_preview_lifecycle_and_no_actor_body(tmp_path):
    app, runtime = make_app(tmp_path)
    app.include_router(router, prefix="/api/v1")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        await client.post(
            "/api/v1/roommate/access", json={"adult": True, "terms_version": "roommate-1.0"}, headers=headers()
        )
        body = {"content": complete().model_dump(mode="json"), "expected_version": None}
        response = await client.put("/api/v1/roommate/me/profile", json=body, headers=headers())
        assert response.json()["state"] == "draft" and response.json()["version"] == 1
        preview = await client.post("/api/v1/roommate/me/profile/preview", json=body["content"], headers=headers())
        assert "preferences" not in preview.text
        response = await client.post(
            "/api/v1/roommate/me/profile/actions",
            json={"action": "publish", "expected_version": 1, "reviewed": True},
            headers=headers(),
        )
        assert response.json()["state"] == "active"
        assert (await client.put("/api/v1/roommate/me/profile", json=body, headers=headers())).status_code == 409
        response = await client.put(
            "/api/v1/roommate/me/profile", json={**body, "owner_id": "other"}, headers=headers()
        )
        assert response.status_code == 422
        assert (await client.get("/api/v1/roommate/me/intro", headers=headers())).json() is None
        response = await client.put("/api/v1/roommate/me/intro", json=body["content"], headers=headers())
        assert response.status_code == 200
