from datetime import timedelta

import httpx
import pytest
from relohome_agent.api import roommate_media, roommate_safety
from relohome_roommate.ports import Actor
from relohome_roommate.services.moderation import ModerationService
from relohome_roommate.storage import Storage

from tests.test_roommate.test_discovery_api import headers, make_app
from tests.test_roommate.test_request_lifecycle import prepare


@pytest.mark.asyncio
async def test_image_upload_attachment_and_review_are_retired(tmp_path):
    app, runtime = make_app(tmp_path)
    app.include_router(roommate_media.router, prefix="/api/v1")
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test/api/v1/roommate/"
        ) as client:
            assert "media" not in (await client.get("availability")).json()["features"]
            for method, path, body in (
                ("POST", "media", {}),
                ("PUT", "me/profile/avatar", {"media_id": "old-image", "expected_version": 1}),
                ("POST", "moderation/media/old-image", {"approved": True, "reason": "Review"}),
                ("GET", "moderation/media", None),
            ):
                response = await client.request(method, path, headers=headers("mod"), json=body)
                assert response.status_code in (404, 405)
    finally:
        runtime.close()


@pytest.mark.parametrize("backend", ["sqlite", "postgres"])
def test_admin_filters_counts_details_and_history_use_current_state(tmp_path, backend, request):
    def check(db):
        ctx = prepare(db)
        ctx.moderators = frozenset({"admin"})
        a = ctx.profiles.get("a")
        b = ctx.profiles.get("b")
        with ctx.transaction():
            ctx.profiles.save(
                a.model_copy(
                    update={
                        "version": a.version + 1,
                        "confirmed_at": ctx.clock.now() - timedelta(days=31),
                        "expires_at": ctx.clock.now() - timedelta(seconds=1),
                    }
                ),
                a.version,
            )
            previous = b
            b = b.model_copy(
                update={"version": b.version + 1, "content": b.content.model_copy(update={"display_name": "Đỗ Ngọc"})}
            )
            ctx.profiles.save(b, previous.version)
        service = ModerationService(ctx)
        admin = Actor(id="admin")
        active = service.queue(
            admin, "profiles", status="active", q=b.content.display_name, city="hcm", sort="updated_desc"
        )
        assert [p["profile_id"] for p in active["items"]] == ["b"]
        assert active["total"] == service.summary(admin)["active_profiles"] == 1
        assert service.queue(admin, "profiles", status="expired")["items"][0]["profile_id"] == "a"
        assert service.queue(admin, "profiles", q="%_' OR 1=1--")["total"] == 0
        assert service.queue(admin, "profiles", city="hanoi")["total"] == 0
        assert service.queue(admin, "profiles", q="đỗ ngọc")["total"] == 1
        page = service.queue(admin, "profiles", offset=1, limit=1)
        assert page["total"] == 2 and len(page["items"]) == 1
        assert service.queue(admin, "profiles", max_budget=1000)["total"] == 2  # The ranges overlap [0, 4m].
        assert service.queue(admin, "profiles", min_budget=5000000)["total"] == 0
        details = service.detail(admin, "b")
        assert details["profile"]["version"] == b.version
        assert "preferences" not in str(details) and "ciphertext" not in str(details)
        with pytest.raises(ValueError, match="Profile version changed"):
            service.restrict(admin, "b", True, "Stale review", "redesign-stale-key-01", expected_version=b.version + 1)
        assert not ctx.safety.restricted("b")
        service.restrict(admin, "b", True, "Reviewed report", "redesign-restrict-key")
        assert service.summary(admin)["restricted_profiles"] == 1
        history = service.history(admin, "b", offset=0, limit=20)
        assert history["items"][0]["action"] == "restrict"
        assert history["items"][0]["reason"] == "Reviewed report"
        with pytest.raises(ValueError, match="moderator_required"):
            service.detail(Actor(id="a"), "b")
        service.restrict(admin, "b", False, "Resolved", "redesign-restore-key")
        assert service.detail(admin, "b")["profile"]["state"] == "paused"

    if backend == "postgres":
        with request.getfixturevalue("pg_store").storage() as db:
            check(db)
    else:
        with Storage(tmp_path / "db") as db:
            check(db)


@pytest.mark.asyncio
async def test_admin_read_api_is_bounded_and_rejects_spoofed_roles(tmp_path):
    app, runtime = make_app(tmp_path)
    app.include_router(roommate_safety.router, prefix="/api/v1")
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test/api/v1/roommate/"
        ) as client:
            for suffix in ("moderation/profiles", "moderation/profiles/target", "moderation/profiles/target/history"):
                assert (await client.get(suffix)).status_code == 401
                assert (await client.get(suffix, headers={**headers(), "X-Role": "admin"})).status_code == 403
            for query in (
                "sort=arbitrary_sql",
                "status=deleted",
                "q=" + "a" * 101,
                "limit=51",
                "min_budget=-1",
                "min_budget=1000&max_budget=10",
            ):
                assert (await client.get("moderation/profiles?" + query, headers=headers("mod"))).status_code == 422
            assert (
                await client.get("moderation/profiles/target/history?limit=51", headers=headers("mod"))
            ).status_code == 422
    finally:
        runtime.close()
