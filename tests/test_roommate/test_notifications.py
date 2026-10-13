from relohome_roommate.connections import ContactRef
from relohome_roommate.ports import Actor
from relohome_roommate.services.consent import ConsentService
from relohome_roommate.services.requests import RequestService
from relohome_roommate.storage import Storage

from tests.test_roommate.test_request_lifecycle import prepare


def test_request_events_are_actor_private_idempotent_and_contain_no_intro_or_contact(tmp_path):
    from relohome_roommate.services.notifications import NotificationService

    with Storage(tmp_path / "db") as db:
        ctx = prepare(db)
        service = RequestService(ctx)
        from tests.test_roommate.test_profile_lifecycle import complete

        sent = service.send(
            Actor(id="a"), "b", complete(), ContactRef(channel_id="a", version=1), True, "notification-send-0001"
        )
        service.send(
            Actor(id="a"), "b", complete(), ContactRef(channel_id="a", version=1), True, "notification-send-0001"
        )
        notifications = NotificationService(ctx)
        page = notifications.list(Actor(id="b"))
        assert page["unread"] == 1 and len(page["items"]) == 1
        assert page["items"][0]["kind"] == "request_received"
        assert set(page["items"][0]) == {"id", "kind", "resource_id", "created_at", "read"}
        assert notifications.list(Actor(id="a"))["items"] == []
        notifications.mark_read(Actor(id="a"), [page["items"][0]["id"]])
        assert notifications.list(Actor(id="b"))["unread"] == 1
        notifications.mark_read(Actor(id="b"), [page["items"][0]["id"]])
        assert notifications.list(Actor(id="b"))["unread"] == 0
        ConsentService(ctx).accept(
            Actor(id="b"), sent["request_id"], ContactRef(channel_id="b", version=1), True, "notification-accept-0001"
        )
        assert notifications.list(Actor(id="a"))["items"][0]["kind"] == "request_accepted"
        ConsentService(ctx).revoke(Actor(id="b"), sent["request_id"], "notification-revoke-0001")
        assert any(item["kind"] == "contact_revoked" for item in notifications.list(Actor(id="a"))["items"])
