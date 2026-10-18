import httpx
import pytest
from relohome_agent.api.roommate_connections import router
from relohome_agent.api.roommate_privacy import router as privacy_router
from relohome_agent.api.roommate_profiles import router as profile_router

from tests.test_roommate.test_discovery_api import headers, make_app
from tests.test_roommate.test_profile_lifecycle import complete


@pytest.mark.asyncio
async def test_chat_api_without_contact_and_server_derived_membership(tmp_path):
    app, runtime = make_app(tmp_path)
    app.include_router(profile_router, prefix="/api/v1")
    app.include_router(router, prefix="/api/v1")
    app.include_router(privacy_router, prefix="/api/v1")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        root = "/api/v1/roommate"
        for actor in ("a", "b", "outsider"):
            assert (
                await client.post(
                    root + "/access", json={"adult": True, "terms_version": "roommate-1.0"}, headers=headers(actor)
                )
            ).status_code == 200
            assert (
                await client.put(
                    root + "/me/profile", json={"content": complete().model_dump(mode="json")}, headers=headers(actor)
                )
            ).status_code == 200
            assert (
                await client.post(
                    root + "/me/profile/actions",
                    json={"action": "publish", "expected_version": 1, "reviewed": True},
                    headers=headers(actor),
                )
            ).status_code == 200
        invite = {
            "recipient_id": "b",
            "intro": complete().model_dump(mode="json"),
            "operation_key": "chat-invite-test-01",
        }
        response = await client.post(root + "/chat/requests", json=invite, headers=headers("a"))
        assert response.status_code == 200, response.text
        identifier = response.json()["request_id"]
        request = root + "/requests/" + identifier
        detail = (await client.get(request, headers=headers("b"))).json()
        assert detail["mode"] == "chat" and detail["actions"] == ["accept", "reject"]
        conversation = root + "/chat/conversations/" + identifier
        assert (await client.get(conversation + "/messages", headers=headers("b"))).status_code == 404
        response = await client.post(
            root + f"/chat/requests/{identifier}/accept",
            json={"operation_key": "chat-accept-test-01"},
            headers=headers("b"),
        )
        assert response.status_code == 200, response.text
        assert response.json()["conversation_id"] == identifier
        assert (await client.get(request + "/contact", headers=headers("a"))).status_code == 404
        body = {"body": "Hello <script>plain text</script>", "client_message_id": "chat-message-test01"}
        response = await client.post(conversation + "/messages", json={**body, "sender_id": "b"}, headers=headers("a"))
        assert response.status_code == 422
        response = await client.post(conversation + "/messages", json=body, headers=headers("a"))
        assert response.status_code == 200
        assert response.json()["message"]["sender_id"] == "a"
        assert (await client.get(conversation + "/messages", headers=headers("outsider"))).status_code == 404
        response = await client.get(conversation + "/messages", headers=headers("b"))
        assert len(response.json()["items"]) == 1
        assert response.headers["cache-control"] == "private, no-store"
        message_id = response.json()["items"][0]["id"]
        assert (await client.get(conversation + "/messages", headers=headers("a"))).json()[
            "counterparty_read_message_id"
        ] is None
        assert (await client.post(conversation + "/read", json={"message_id": message_id}, headers=headers("b"))).status_code == 200
        assert (await client.get(conversation + "/messages", headers=headers("a"))).json()[
            "counterparty_read_message_id"
        ] == message_id
        own_export = await client.get(root + "/me/privacy/chat-messages?limit=1", headers=headers("a"))
        assert own_export.status_code == 200 and own_export.json()["chat_messages"][0]["body"] == body["body"]
        assert (await client.get(root + "/me/privacy/chat-messages", headers=headers("b"))).json()[
            "chat_messages"
        ] == []
        assert (await client.get(root + "/me/privacy/chat-messages?limit=501", headers=headers("a"))).status_code == 422
        own_status = (await client.get(conversation + "/messages", headers=headers("a"))).json()["own_profile"]
        assert own_status == {"state": "active", "version": 2}
        response = await client.post(
            root + "/me/profile/actions",
            json={"action": "resolve", "expected_version": own_status["version"]},
            headers=headers("a"),
        )
        assert response.status_code == 200, response.text
        assert (await client.get(root + "/me/profile", headers=headers("b"))).json()["state"] == "active"
        chat = (await client.get(conversation + "/messages", headers=headers("a"))).json()
        assert chat["own_profile"] == {"state": "resolved", "version": 3}
        assert chat["state"] == "active" and len(chat["items"]) == 1
        response = await client.post(
            conversation + "/messages",
            json={"body": "We can still chat", "client_message_id": "chat-after-resolve01"},
            headers=headers("a"),
        )
        assert response.status_code == 200, response.text
        with runtime.context() as ctx:
            assert ctx.storage.connection.execute("SELECT COUNT(*) FROM contacts").fetchone()[0] == 0
