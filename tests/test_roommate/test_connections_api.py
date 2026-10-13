import httpx
import pytest
from relohome_agent.api.roommate_connections import router
from relohome_agent.api.roommate_profiles import router as profile_router

from tests.test_roommate.test_discovery_api import headers, make_app
from tests.test_roommate.test_profile_lifecycle import complete


@pytest.mark.asyncio
async def test_real_api_flow_contact_is_separate_and_idor_denied(tmp_path):
    app, runtime = make_app(tmp_path)
    app.include_router(profile_router, prefix="/api/v1")
    app.include_router(router, prefix="/api/v1")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        contacts = {}
        for actor in ("a", "b", "c"):
            await client.post(
                "/api/v1/roommate/access", json={"adult": True, "terms_version": "roommate-1.0"}, headers=headers(actor)
            )
            await client.put(
                "/api/v1/roommate/me/profile",
                json={"content": complete().model_dump(mode="json")},
                headers=headers(actor),
            )
            await client.post(
                "/api/v1/roommate/me/profile/actions",
                json={"action": "publish", "expected_version": 1, "reviewed": True},
                headers=headers(actor),
            )
            response = await client.put(
                "/api/v1/roommate/me/contacts",
                json={"kind": "phone", "value": "0901234567", "operation_key": f"contact-create-{actor}-001"},
                headers=headers(actor),
            )
            assert response.status_code == 200
            contacts[actor] = {key: response.json()[key] for key in ("channel_id", "version")}
        body = {
            "recipient_id": "b",
            "intro": complete().model_dump(mode="json"),
            "contact": contacts["a"],
            "consent": True,
            "operation_key": "send-operation-0001",
        }
        response = await client.post("/api/v1/roommate/requests", json=body, headers=headers("a"))
        assert response.status_code == 200
        identifier = response.json()["request_id"]
        url = f"/api/v1/roommate/requests/{identifier}"
        assert (await client.get(url + "/contact", headers=headers("b"))).status_code == 404
        assert (await client.get(url, headers=headers("c"))).status_code == 404
        assert (await client.get(url, headers=headers("b"))).json()["intro"]["display_name"] == "Name"
        response = await client.post(
            url + "/accept",
            json={"contact": contacts["b"], "consent": True, "operation_key": "accept-operation001"},
            headers=headers("b"),
        )
        assert response.status_code == 200
        response = await client.get(url + "/contact", headers=headers("a"))
        assert response.json()["contact"]["value"] == "0901234567"
        assert response.headers["cache-control"] == "private, no-store"
        assert "0901234567" not in (await client.get("/api/v1/roommate/me/requests", headers=headers("b"))).text
        response = await client.get("/api/v1/roommate/operations/send-operation-0001", headers=headers("a"))
        assert response.json()["status"] == "completed"
        assert (await client.get("/api/v1/roommate/operations/send-operation-0001", headers=headers("c"))).json()[
            "status"
        ] == "not_found"
