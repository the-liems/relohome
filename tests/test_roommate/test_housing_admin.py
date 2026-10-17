"""Housing Admin IDs reuse Roommate moderation without discovery consent."""

import httpx
import pytest
from relohome_agent.api import roommate_connections, roommate_media, roommate_operations, roommate_safety
from relohome_roommate.media import MediaService
from relohome_roommate.ports import Actor
from relohome_roommate.services.access import AccessService
from relohome_roommate.services.profiles import ProfileService
from relohome_roommate.services.safety import SafetyService

from tests.test_roommate.test_discovery_api import headers, make_app
from tests.test_roommate.test_media import image_bytes
from tests.test_roommate.test_profile_lifecycle import complete


@pytest.mark.asyncio
async def test_housing_admin_moderates_without_personal_profile_and_users_cannot_spoof_role(tmp_path, monkeypatch):
    monkeypatch.setenv("HOUSING_MODERATOR_IDS", "housing-admin")
    app, runtime = make_app(tmp_path)
    for router in (
        roommate_safety.router,
        roommate_media.router,
        roommate_operations.router,
        roommate_connections.router,
    ):
        app.include_router(router, prefix="/api/v1")
    try:
        with runtime.context() as ctx:
            candidate = Actor(id="candidate")
            reporter = Actor(id="reporter")
            for actor in (candidate, reporter):
                AccessService(ctx).accept(actor, True, "roommate-1.0")
            ProfileService(ctx).save(candidate, complete(), None)
            ProfileService(ctx).transition(candidate, "publish", 1, True)
            media_id = MediaService(ctx).upload(candidate, image_bytes(), "admin-media-test-01")["media_id"]
            report_id = SafetyService(ctx).report(
                reporter, candidate.id, "Content needs review", "admin-report-test-01"
            )["report_id"]
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test/api/v1/roommate/"
        ) as client:
            admin = headers("housing-admin")
            access = (await client.get("access", headers=admin)).json()
            assert access["moderator"] and not access["eligible"]
            for queue in ("summary", "profiles", "reports"):
                response = await client.get("moderation/" + queue, headers=admin)
                assert response.status_code == 200
                assert response.headers["cache-control"] == "private, no-store"
                assert (await client.get("moderation/" + queue, headers=headers("reporter"))).status_code == 403
            assert (
                await client.get("moderation/summary", headers={**admin, "Authorization": "Bearer wrong"})
            ).status_code == 401
            spoof = {**headers("reporter"), "X-User-Role": "admin", "X-Is-Admin": "true"}
            assert (await client.get("moderation/summary", headers=spoof)).status_code == 403
            assert (await client.get("moderation/summary", headers=headers("mod"))).status_code == 200  # legacy IDs
            decision = {"approved": True, "reason": "Reviewed content"}
            assert (await client.post(f"moderation/media/{media_id}", headers=spoof, json=decision)).status_code in (
                404,
                405,
            )
            assert (await client.post(f"moderation/media/{media_id}", headers=admin, json=decision)).status_code in (
                404,
                405,
            )
            assert (await client.post(f"moderation/reports/{report_id}/resolve", headers=admin)).status_code == 200
            body = {"selected": True, "reason": "Reviewed report", "operation_key": "admin-http-restrict-01"}
            path = "/moderation/profiles/candidate"
            assert (
                await client.put("operation-drafts", headers=admin, json={"path": path, "method": "POST", "body": body})
            ).status_code == 200
            assert (await client.post(path.lstrip("/"), headers=spoof, json=body)).status_code == 403
            result = await client.post(path.lstrip("/"), headers=admin, json=body)
            assert result.status_code == 200 and result.json()["restricted"]
            assert (await client.post(path.lstrip("/"), headers=admin, json=body)).json() == result.json()
            status = await client.get("operations/" + body["operation_key"], headers=admin)
            assert status.status_code == 200 and status.json()["result"] == result.json()
            assert (await client.get("operation-drafts/" + body["operation_key"], headers=admin)).json()[
                "status"
            ] == "completed"
            assert (await client.post("search", headers=admin, json={"criteria": {"city": "hcm"}})).status_code == 403
        with runtime.context() as ctx:
            assert ctx.profiles.access("housing-admin") is None
            assert ctx.profiles.get("housing-admin") is None
    finally:
        runtime.close()
