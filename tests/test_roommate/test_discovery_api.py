from datetime import timedelta

import httpx
import pytest
from fastapi import FastAPI
from relohome_agent.api.roommate_access import router as access_router
from relohome_agent.api.roommate_discovery import router as discovery_router
from relohome_agent.config import Settings
from relohome_agent.roommate_runtime import RoommateRuntime
from relohome_roommate.models import RoommateProfile
from relohome_roommate.ports import ProfileRecord


def make_app(tmp_path):
    app = FastAPI()
    runtime = RoommateRuntime.open(
        Settings(
            _env_file=None,
            roommate_enabled=True,
            agent_api_token="test-token",
            roommate_moderators="mod",
            roommate_state_dir=tmp_path,
        )
    )
    app.state.roommate_runtime = runtime
    app.include_router(access_router, prefix="/api/v1")
    app.include_router(discovery_router, prefix="/api/v1")
    return app, runtime


def headers(actor="viewer"):
    return {"Authorization": "Bearer test-token", "X-User-Id": actor}


@pytest.mark.asyncio
async def test_private_auth_terms_and_safe_search(tmp_path):
    app, runtime = make_app(tmp_path)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.get("/api/v1/roommate/availability")).json()["enabled"] is True
        assert (await client.get("/api/v1/roommate/access")).status_code == 401
        assert (await client.get("/api/v1/roommate/access", headers=headers("anonymous"))).status_code == 401
        payload = {"criteria": {"city": "hcm"}}
        assert (await client.post("/api/v1/roommate/search", json=payload, headers=headers())).status_code == 403
        response = await client.post(
            "/api/v1/roommate/access", json={"adult": True, "terms_version": "roommate-1.0"}, headers=headers()
        )
        assert response.status_code == 200 and response.headers["cache-control"] == "private, no-store"
        now = runtime.clock.now()
        with runtime.context() as ctx, ctx.transaction():
            ctx.profiles.save(
                ProfileRecord(
                    owner_id="candidate",
                    version=1,
                    state="active",
                    updated_at=now,
                    confirmed_at=now,
                    expires_at=now + timedelta(days=30),
                    content=RoommateProfile(
                        display_name="Name", facts={"city": "hcm"}, preferences={"gender": {"value": "female"}}
                    ),
                ),
                None,
            )
        response = await client.post("/api/v1/roommate/search", json=payload, headers=headers())
        assert response.json()["total"] == 1
        assert "preferences" not in response.text and "contact" not in response.text
        assert (
            await client.post("/api/v1/roommate/search", json={**payload, "actor_id": "spoof"}, headers=headers())
        ).status_code == 422
        response = await client.post(
            "/api/v1/roommate/search",
            json={"criteria": {"city": "hcm", "preferences": {"areas": {"value": {"area_ids": ["invented"]}}}}},
            headers=headers(),
        )
        assert response.status_code == 422


@pytest.mark.asyncio
async def test_disabled_and_wrong_token_never_return_profiles(tmp_path):
    app, runtime = make_app(tmp_path)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        assert (
            await client.get("/api/v1/roommate/access", headers={**headers(), "Authorization": "Bearer wrong"})
        ).status_code == 401
        app.state.roommate_runtime = None
        assert (await client.get("/api/v1/roommate/availability")).json()["enabled"] is False
        assert (await client.get("/api/v1/roommate/access", headers=headers())).status_code == 503
