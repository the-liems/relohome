"""Real SQLite/ASGI policy checks; no provider or LLM responses are mocked."""

from datetime import timedelta

import httpx
import pytest
from pydantic import ValidationError
from relohome_agent.api.roommate_map import router
from relohome_roommate.clock import FrozenClock
from relohome_roommate.models import RoommateProfile
from relohome_roommate.policy import TERMS_VERSION
from relohome_roommate.ports import Actor
from relohome_roommate.services.access import AccessService
from relohome_roommate.services.profiles import ProfileService

from tests.test_roommate.test_discovery_api import headers, make_app
from tests.test_roommate.test_profile_lifecycle import complete


def test_binding_requires_having_room_and_explicit_consent():
    body = complete().model_dump(mode="json")
    body["room"] = {"listing_id": "contract-only-room", "public_location_consent": True}
    with pytest.raises(ValidationError, match="has_room"):
        RoommateProfile.model_validate(body)
    body["facts"]["need"] = {"kind": "has_room", "willing_to_move": False}
    body["room"]["public_location_consent"] = False
    with pytest.raises(ValidationError, match="explicit location consent"):
        RoommateProfile.model_validate(body)


@pytest.mark.asyncio
async def test_map_lifecycle_consent_blocks_expiry_and_minimal_disclosure(tmp_path):
    app, runtime = make_app(tmp_path)
    app.include_router(router, prefix="/api/v1")
    runtime.clock = FrozenClock(runtime.clock.now())
    owner, viewer = Actor(id="owner"), Actor(id="viewer")
    body = complete().model_dump(mode="json")
    body["facts"]["need"] = {"kind": "has_room", "willing_to_move": False}
    body["room"] = {"listing_id": "contract-only-room", "public_location_consent": True}
    content = RoommateProfile.model_validate(body)
    # Exercise the real domain persistence/lifecycle, not the provider validation endpoint.
    # This binding is private to the temporary test database, never a production housing claim.
    with runtime.context() as ctx:
        AccessService(ctx).accept(owner, True, TERMS_VERSION)
        service = ProfileService(ctx)
        draft = service.save(owner, content, None)
        published = service.transition(owner, "publish", draft.version, True)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:

        async def markers():
            response = await client.post(
                "/api/v1/roommate/map/rooms",
                json={"listing_ids": [content.room.listing_id]},
                headers=headers(),
            )
            assert response.status_code == 200
            return response.json()["items"]

        assert await markers() == []  # No viewer consent, even for a published room.
        with runtime.context() as ctx:
            AccessService(ctx).accept(viewer, True, TERMS_VERSION)
        shown = await markers()
        assert len(shown) == 1 and shown[0]["source_kind"] == "real"
        own = await client.post(
            "/api/v1/roommate/map/rooms",
            json={"listing_ids": [content.room.listing_id]},
            headers=headers("owner"),
        )
        assert own.status_code == 200 and own.json()["items"] == []
        legacy = await client.post(
            "/api/v1/roommate/map/rooms",
            json={"listing_ids": [content.room.listing_id], "include_demo": True},
            headers=headers(),
        )
        assert legacy.json() == {"items": shown, "demo_enabled": False}
        assert set(shown[0]) == {
            "listing_id",
            "profile_id",
            "display_name",
            "source_kind",
            "label",
            "connections_enabled",
        }
        assert "chưa xác minh" in shown[0]["label"]
        with runtime.context() as ctx, ctx.transaction():
            ctx.safety.block(owner.id, viewer.id, True)
        assert await markers() == []  # Both block directions matter.
        with runtime.context() as ctx, ctx.transaction():
            ctx.safety.block(owner.id, viewer.id, False)
        with runtime.context() as ctx:
            paused = ProfileService(ctx).transition(owner, "pause", published.version)
        assert await markers() == []
        with runtime.context() as ctx:
            ProfileService(ctx).transition(owner, "resume", paused.version, True)
        assert len(await markers()) == 1
        with runtime.context() as ctx:
            current = ctx.profiles.get(owner.id)
            resolved = ProfileService(ctx).transition(owner, "resolve", current.version)
        assert await markers() == []
        with runtime.context() as ctx:
            ProfileService(ctx).transition(owner, "resume", resolved.version, True)
        assert len(await markers()) == 1
        with runtime.context() as ctx, ctx.transaction():
            ctx.safety.moderate("mod", owner.id, True, "contract policy check", ctx.clock.now())
        assert await markers() == []
        with runtime.context() as ctx, ctx.transaction():
            ctx.safety.moderate("mod", owner.id, False, "contract policy check", ctx.clock.now())
        with runtime.context() as ctx:
            AccessService(ctx).accept(owner, False, TERMS_VERSION)
        assert await markers() == []
        with runtime.context() as ctx:
            AccessService(ctx).accept(owner, True, TERMS_VERSION)
            current = ctx.profiles.get(owner.id)
            ProfileService(ctx).transition(owner, "resume", current.version, True)
        runtime.clock.advance(timedelta(days=31))
        assert await markers() == []
        assert (
            await client.post("/api/v1/roommate/demo/search", json={"criteria": {"city": "hcm"}}, headers=headers())
        ).status_code == 404
        assert (
            await client.post(
                "/api/v1/roommate/map/rooms", json={"listing_ids": [], "include_demo": "true"}, headers=headers()
            )
        ).status_code == 422
        assert (
            await client.post(
                "/api/v1/roommate/map/rooms", json={"listing_ids": []}, headers=headers("demo_person_001")
            )
        ).status_code == 401


@pytest.mark.asyncio
async def test_shared_room_excludes_only_viewers_own_post_and_rejects_spoofed_owner(tmp_path):
    app, runtime = make_app(tmp_path)
    app.include_router(router, prefix="/api/v1")
    body = complete().model_dump(mode="json")
    body["facts"]["need"] = {"kind": "has_room", "willing_to_move": False}
    body["room"] = {"listing_id": "shared-room", "public_location_consent": True}
    content = RoommateProfile.model_validate(body)
    with runtime.context() as ctx:
        for owner_id in ("viewer", "other-poster"):
            actor = Actor(id=owner_id)
            AccessService(ctx).accept(actor, True, TERMS_VERSION)
            service = ProfileService(ctx)
            draft = service.save(actor, content, None)
            service.transition(actor, "publish", draft.version, True)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        for actor_id, expected in (("viewer", "other-poster"), ("other-poster", "viewer")):
            response = await client.post(
                "/api/v1/roommate/map/rooms",
                json={"listing_ids": ["shared-room"]},
                headers=headers(actor_id),
            )
            assert response.status_code == 200
            assert [p["profile_id"] for p in response.json()["items"]] == [expected]
        spoof = await client.post(
            "/api/v1/roommate/map/rooms",
            json={"listing_ids": ["shared-room"], "actor_id": "other-poster"},
            headers=headers(),
        )
        assert spoof.status_code == 422


@pytest.mark.asyncio
async def test_room_binding_fails_closed_without_housing_service(tmp_path):
    from relohome_agent.api.roommate_profiles import router as profile_router

    app, runtime = make_app(tmp_path)
    app.include_router(profile_router, prefix="/api/v1")
    with runtime.context() as ctx:
        AccessService(ctx).accept(Actor(id="viewer"), True, TERMS_VERSION)
    body = complete().model_dump(mode="json")
    body["facts"]["need"] = {"kind": "has_room", "willing_to_move": False}
    body["room"] = {"listing_id": "contract-only-room", "public_location_consent": True}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.put(
            "/api/v1/roommate/me/profile",
            json={"content": body, "expected_version": None},
            headers=headers(),
        )
        assert response.status_code == 503
    with runtime.context() as ctx:
        assert ctx.profiles.get("viewer") is None


@pytest.mark.asyncio
@pytest.mark.parametrize("app_env", ["production", "test"])
async def test_legacy_demo_env_cannot_enable_synthetic_profiles(tmp_path, monkeypatch, app_env):
    from relohome_agent.config import Settings
    from relohome_agent.roommate_runtime import RoommateRuntime

    monkeypatch.setenv("ROOMMATE_DEMO_ENABLED", "true")
    monkeypatch.setenv("ROOMMATE_DEMO_DATASET", str(tmp_path / "missing-demo.json"))
    app, _ = make_app(tmp_path)
    runtime = RoommateRuntime.open(
        Settings(
            _env_file=None,
            app_env=app_env,
            roommate_enabled=True,
            agent_api_token="test-token",
            roommate_moderators="mod",
            roommate_state_dir=tmp_path,
        )
    )
    app.state.roommate_runtime = runtime
    app.include_router(router, prefix="/api/v1")
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            availability = (await client.get("/api/v1/roommate/availability")).json()
            assert availability["enabled"] and availability["demo_enabled"] is False
            assert (
                await client.post("/api/v1/roommate/demo/search", json={"criteria": {"city": "hcm"}}, headers=headers())
            ).status_code == 404
    finally:
        runtime.close()
