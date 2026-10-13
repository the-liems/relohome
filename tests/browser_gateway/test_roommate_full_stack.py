"""Real session gateway -> real Roommate API -> file DB; no mocked Roommate responses."""

import httpx
import pytest
from relohome_agent.api.roommate_connections import router as connection_router
from relohome_agent.api.roommate_profiles import router as profile_router
from relohome_agent.api.roommate_safety import router as safety_router
from relohome_gateway.server import create_app

from tests.test_roommate.test_discovery_api import make_app
from tests.test_roommate.test_profile_lifecycle import complete

HEADERS = {"X-SIU-Request": "1", "Origin": "http://test"}


@pytest.mark.asyncio
async def test_real_session_consent_and_block_flow(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENT_API_TOKEN", "test-token")
    api, runtime = make_app(tmp_path / "private")
    for router in (connection_router, profile_router, safety_router):
        api.include_router(router, prefix="/api/v1")
    api_client = httpx.AsyncClient(transport=httpx.ASGITransport(app=api), base_url="http://backend")

    async def forward(request):
        return await api_client.request(
            request.method, request.url.path, headers=request.headers, content=request.content
        )

    gateway = create_app(tmp_path / "web.db", transport=httpx.MockTransport(forward))
    clients = []
    try:
        async with gateway.router.lifespan_context(gateway):
            contacts, owners = [], []
            for index in range(3):
                client = httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=gateway), base_url="http://test", headers=HEADERS
                )
                clients.append(client)
                response = await client.post(
                    "/web/api/auth/register",
                    json={"email": f"person{index}@example.test", "password": "long-enough-password", "name": "Test"},
                )
                assert response.status_code == 200
                owners.append(response.json()["id"])
                path = "/web/api/roommate"
                assert (await client.post(path + "/search", json={"criteria": {"city": "hcm"}})).status_code == 403
                assert (
                    await client.post(path + "/access", json={"adult": True, "terms_version": "roommate-1.0"})
                ).status_code == 200
                await client.put(path + "/me/profile", json={"content": complete().model_dump(mode="json")})
                assert (
                    await client.post(
                        path + "/me/profile/actions",
                        json={"action": "publish", "expected_version": 1, "reviewed": True},
                    )
                ).status_code == 200
                response = await client.put(
                    path + "/me/contacts",
                    json={"kind": "phone", "value": "0901234567", "operation_key": f"contact-create-{index}-001"},
                )
                assert response.status_code == 200
                contacts.append({key: response.json()[key] for key in ("channel_id", "version")})
            a, b, outsider = clients
            response = await a.post(path + "/search", json={"criteria": {"city": "hcm"}})
            assert response.status_code == 200 and response.json()["total"] == 2
            assert "0901234567" not in response.text
            body = {
                "recipient_id": owners[1],
                "intro": complete().model_dump(mode="json"),
                "contact": contacts[0],
                "consent": True,
                "operation_key": "send-operation-0001",
            }
            sent = await a.post(path + "/requests", json=body)
            assert sent.status_code == 200
            assert (await a.post(path + "/requests", json=body)).json() == sent.json()
            url = path + "/requests/" + sent.json()["request_id"]
            assert (await a.get(url + "/contact")).status_code == 404
            assert (await outsider.get(url)).status_code == 404
            response = await b.post(
                url + "/accept", json={"contact": contacts[1], "consent": True, "operation_key": "accept-operation001"}
            )
            assert response.status_code == 200
            for client in (a, b):
                response = await client.get(url + "/contact")
                assert response.status_code == 200 and response.headers["cache-control"] == "no-store"
                assert response.json()["contact"]["value"] == "0901234567"
            assert (await outsider.get(url + "/contact")).status_code == 404
            response = await a.put(
                path + "/blocks/" + owners[1], json={"selected": True, "operation_key": "block-operation001"}
            )
            assert response.status_code == 200
            assert (await b.get(url + "/contact")).status_code == 404
            assert (await a.get(path + "/profiles/" + owners[1])).json()["available"] is False
            assert (await a.post("/web/api/logout")).status_code == 200
            assert (await a.get(url + "/contact")).status_code == 401
    finally:
        for client in clients:
            await client.aclose()
        await api_client.aclose()
        runtime.close()
