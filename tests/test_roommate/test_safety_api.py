import httpx
import pytest
from relohome_agent.api.roommate_safety import router

from tests.test_roommate.test_discovery_api import headers, make_app


@pytest.mark.asyncio
async def test_moderation_guard_and_report_is_private_not_auto_block(tmp_path):
    app, runtime = make_app(tmp_path)
    app.include_router(router, prefix="/api/v1")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        await client.post(
            "/api/v1/roommate/access", json={"adult": True, "terms_version": "roommate-1.0"}, headers=headers()
        )
        response = await client.post(
            "/api/v1/roommate/reports",
            json={"profile_id": "candidate", "reason": "Review", "operation_key": "report-operation-01"},
            headers=headers(),
        )
        assert response.status_code == 200
        assert (await client.get("/api/v1/roommate/moderation/reports", headers=headers())).status_code == 403
        reports = (await client.get("/api/v1/roommate/moderation/reports", headers=headers("mod"))).json()
        assert reports["items"][0]["reason"] == "Review"
        body = {"selected": True, "reason": "Reviewed", "operation_key": "moderation-operation01"}
        assert (
            await client.post("/api/v1/roommate/moderation/profiles/candidate", json=body, headers=headers())
        ).status_code == 403
        assert (
            await client.post("/api/v1/roommate/moderation/profiles/candidate", json=body, headers=headers("mod"))
        ).status_code == 200
        with runtime.context() as ctx:
            assert not ctx.safety.blocked("viewer", "candidate")
            assert ctx.safety.restricted("candidate")
