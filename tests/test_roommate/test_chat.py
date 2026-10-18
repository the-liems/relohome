from datetime import timedelta

import pytest
from relohome_roommate.access import RoommateError
from relohome_roommate.ports import Actor
from relohome_roommate.services.chat import ChatService
from relohome_roommate.services.consent import ConsentService
from relohome_roommate.services.safety import SafetyService
from relohome_roommate.storage import Storage

from tests.test_roommate.test_profile_lifecycle import complete
from tests.test_roommate.test_request_lifecycle import prepare


@pytest.fixture
def chat_context(tmp_path):
    with Storage(tmp_path / "chat.db") as storage:
        ctx = prepare(storage)
        with ctx.transaction():
            storage.connection.execute("DELETE FROM contacts")
        yield ctx


def connect(ctx):
    service = ChatService(ctx)
    sent = service.invite(Actor(id="a"), "b", complete(), "chat-invite-key-001")
    accepted = service.accept(Actor(id="b"), sent["request_id"], "chat-accept-key-001")
    return service, sent, accepted["conversation_id"]


@pytest.fixture(params=["sqlite", "postgres"])
def notification_context(request):
    if request.param == "sqlite":
        yield request.getfixturevalue("chat_context")
    else:
        with request.getfixturevalue("pg_store").storage() as storage:
            yield prepare(storage)


def test_new_message_notifies_again_after_read_but_retry_does_not(notification_context):
    from relohome_roommate.services.notifications import NotificationService

    ctx = notification_context
    chat, _, identifier = connect(ctx)
    sender, recipient = Actor(id="a"), Actor(id="b")
    notices = NotificationService(ctx)
    notices.mark_read(recipient, [item["id"] for item in notices.list(recipient)["items"]])
    first = chat.send(sender, identifier, "First", "chat-notification-001")
    first_notice = next(item for item in notices.list(recipient)["items"] if item["kind"] == "chat_message")
    assert first_notice["resource_id"] == identifier and not first_notice["read"]
    notices.mark_read(recipient, [first_notice["id"]])
    chat.mark_read(recipient, identifier, first["message"]["id"])
    assert chat.send(sender, identifier, "First", "chat-notification-001") == first
    assert notices.list(recipient)["unread"] == 0

    ctx.clock.advance(timedelta(seconds=1))
    second = chat.send(sender, identifier, "First", "chat-notification-002")
    assert second["message"]["id"] != first["message"]["id"]
    assert chat.conversations(recipient)["unread_total"] == 1
    after = notices.list(recipient)
    assert after["unread"] == 1
    unread = [item for item in after["items"] if not item["read"]]
    assert len(unread) == 1 and unread[0]["resource_id"] == identifier
    assert unread[0]["id"] != first_notice["id"]

    assert chat.send(sender, identifier, "First", "chat-notification-002") == second
    assert notices.list(recipient) == after
    notices.mark_read(recipient, [unread[0]["id"]])
    chat.send(sender, identifier, "First", "chat-notification-002")
    assert notices.list(recipient)["unread"] == 0


def test_contactless_connection_is_explicit_idempotent_and_private(chat_context):
    ctx = chat_context
    chat = ChatService(ctx)
    sent = chat.invite(Actor(id="a"), "b", complete(), "chat-invite-key-001")
    assert chat.invite(Actor(id="a"), "b", complete(), "chat-invite-key-001") == sent
    reverse = chat.invite(Actor(id="b"), "a", complete(), "chat-reverse-key-01")
    assert reverse["request_id"] == sent["request_id"]
    with pytest.raises(RoommateError):
        chat.accept(Actor(id="a"), sent["request_id"], "chat-invalid-key-01")
    assert chat.conversations(Actor(id="a"))["items"] == []
    result = chat.accept(Actor(id="b"), sent["request_id"], "chat-accept-key-001")
    assert chat.accept(Actor(id="b"), sent["request_id"], "chat-accept-key-001") == result
    assert ctx.connections.grant(sent["request_id"]) is None
    with pytest.raises(RoommateError):
        ConsentService(ctx).read(Actor(id="a"), sent["request_id"])
    identifier = result["conversation_id"]
    for action in (
        lambda: chat.messages(Actor(id="outsider"), identifier),
        lambda: chat.send(Actor(id="outsider"), identifier, "Hello", "chat-message-key-01"),
    ):
        with pytest.raises(RoommateError):
            action()
    message = chat.send(Actor(id="a"), identifier, "Hello", "chat-message-key-01")
    assert chat.send(Actor(id="a"), identifier, "Hello", "chat-message-key-01") == message
    assert len(chat.messages(Actor(id="b"), identifier)["items"]) == 1
    assert chat.conversations(Actor(id="b"))["items"][0]["unread"] == 1
    chat.mark_read(Actor(id="b"), identifier, message["message"]["id"])
    assert chat.conversations(Actor(id="b"))["items"][0]["unread"] == 0
    assert chat.invite(Actor(id="a"), "b", complete(), "chat-repeat-key-01")["conversation_id"] == identifier


def test_chat_outlives_public_profile_and_contact_grant_deadlines(chat_context):
    ctx = chat_context
    chat, _, identifier = connect(ctx)
    ctx.clock.advance(timedelta(days=31))
    chat.send(Actor(id="b"), identifier, "Still here", "chat-message-key-01")
    assert chat.messages(Actor(id="a"), identifier)["items"][0]["body"] == "Still here"


def test_resolving_own_profile_in_chat_hides_only_own_listing_and_preserves_messages(chat_context):
    from relohome_roommate.models import RoommateSearchCriteria
    from relohome_roommate.policy import TERMS_VERSION
    from relohome_roommate.services.access import AccessService
    from relohome_roommate.services.discovery import DiscoveryService
    from relohome_roommate.services.profiles import ProfileService

    ctx = chat_context
    chat, _, identifier = connect(ctx)
    a, b, viewer = Actor(id="a"), Actor(id="b"), Actor(id="viewer")
    AccessService(ctx).accept(viewer, True, TERMS_VERSION)
    criteria = RoommateSearchCriteria(city="hcm", self_facts=complete().facts)
    original = ctx.profiles.get(a.id)
    assert chat.messages(a, identifier)["own_profile"] == {"state": "active", "version": original.version}
    ProfileService(ctx).transition(a, "resolve", original.version)
    remaining = DiscoveryService(ctx).search(viewer, criteria)["items"]
    assert [item["profile"]["profile_id"] for item in remaining] == [b.id]
    assert chat.messages(a, identifier)["own_profile"]["state"] == "resolved"
    assert chat.messages(b, identifier)["own_profile"]["state"] == "active"
    chat.send(a, identifier, "Moving in tomorrow", "resolved-profile-message-01")
    assert chat.messages(b, identifier)["items"][0]["body"] == "Moving in tomorrow"
    ProfileService(ctx).transition(b, "resolve", ctx.profiles.get(b.id).version)
    assert DiscoveryService(ctx).search(viewer, criteria)["items"] == []
    assert chat.messages(a, identifier)["state"] == "active"
    assert chat.messages(b, identifier)["state"] == "active"


def test_stale_chat_resolution_cannot_remove_a_republished_profile(chat_context):
    from relohome_roommate.profile_repository import VersionConflictError
    from relohome_roommate.services.profiles import ProfileService

    ctx = chat_context
    chat, _, identifier = connect(ctx)
    actor = Actor(id="a")
    service = ProfileService(ctx)
    reviewed_version = chat.messages(actor, identifier)["own_profile"]["version"]
    resolved = service.transition(actor, "resolve", reviewed_version)
    published = service.transition(actor, "resume", resolved.version, True)
    with pytest.raises(VersionConflictError):
        service.transition(actor, "resolve", reviewed_version)
    assert ctx.profiles.get(actor.id).version == published.version
    assert ctx.profiles.get(actor.id).state.value == "active"


def test_counterparty_read_receipt_tracks_the_exact_message_and_never_moves_back(notification_context):
    chat, _, identifier = connect(notification_context)
    sender, recipient = Actor(id="a"), Actor(id="b")
    first = chat.send(sender, identifier, "First", "receipt-message-key-01")["message"]
    second = chat.send(sender, identifier, "Second", "receipt-message-key-02")["message"]
    assert chat.messages(sender, identifier)["counterparty_read_message_id"] is None
    chat.mark_read(recipient, identifier, first["id"])
    assert chat.messages(sender, identifier)["counterparty_read_message_id"] == first["id"]
    assert chat.messages(recipient, identifier)["counterparty_read_message_id"] is None
    chat.mark_read(recipient, identifier, second["id"])
    chat.mark_read(recipient, identifier, first["id"])
    assert chat.messages(sender, identifier, limit=1)["counterparty_read_message_id"] == second["id"]
    with pytest.raises(RoommateError):
        chat.messages(Actor(id="outsider"), identifier)


def test_close_block_and_unblock_do_not_restore_send(chat_context):
    ctx = chat_context
    chat, _, identifier = connect(ctx)
    chat.send(Actor(id="a"), identifier, "Hello", "chat-message-key-01")
    SafetyService(ctx).block(Actor(id="b"), "a", True, "chat-block-key-0001")
    with pytest.raises(RoommateError):
        chat.messages(Actor(id="a"), identifier)
    SafetyService(ctx).block(Actor(id="b"), "a", False, "chat-unblock-key-01")
    with pytest.raises(RoommateError):
        chat.send(Actor(id="a"), identifier, "Again", "chat-message-key-02")
    assert chat.messages(Actor(id="a"), identifier)["state"] == "closed"


def test_pending_expiry_cannot_open_chat(chat_context):
    ctx = chat_context
    chat = ChatService(ctx)
    sent = chat.invite(Actor(id="a"), "b", complete(), "chat-invite-key-001")
    ctx.clock.advance(timedelta(days=7))
    with pytest.raises(RoommateError):
        chat.accept(Actor(id="b"), sent["request_id"], "chat-accept-key-001")
    assert chat.conversations(Actor(id="a"))["items"] == []


def test_delete_profile_closes_chat_and_erase_removes_authored_messages(chat_context):
    from relohome_roommate.services.privacy import PrivacyService

    ctx = chat_context
    chat, _, identifier = connect(ctx)
    chat.send(Actor(id="a"), identifier, "Private introduction", "chat-message-key-01")
    exported = PrivacyService(ctx).export(Actor(id="a"))
    assert exported["chat_messages"][0]["body"] == "Private introduction"
    own = ctx.profiles.get("a")
    PrivacyService(ctx).erase(Actor(id="a"), True, own.version)
    assert not ctx.storage.connection.execute("SELECT 1 FROM chat_messages WHERE sender='a'").fetchone()
    with pytest.raises(RoommateError):
        chat.send(Actor(id="b"), identifier, "Again", "chat-message-key-02")


def test_postgres_chat_parity(pg_store):
    with pg_store.storage() as storage:
        ctx = prepare(storage)
        chat, _, identifier = connect(ctx)
        chat.send(Actor(id="a"), identifier, "Hello PG", "chat-message-key-01")
        assert chat.messages(Actor(id="b"), identifier)["items"][0]["body"] == "Hello PG"
        chat.close(Actor(id="a"), identifier, "chat-close-key-0001")
        with pytest.raises(RoommateError):
            chat.send(Actor(id="b"), identifier, "Closed", "chat-message-key-02")


def test_retention_does_not_replay_deleted_message_and_read_cursor_is_monotonic(chat_context):
    ctx = chat_context
    chat, _, identifier = connect(ctx)
    first = chat.send(Actor(id="a"), identifier, "First", "chat-message-key-01")["message"]
    second = chat.send(Actor(id="a"), identifier, "Second", "chat-message-key-02")["message"]
    chat.mark_read(Actor(id="b"), identifier, second["id"])
    chat.mark_read(Actor(id="b"), identifier, first["id"])
    assert chat.conversations(Actor(id="b"))["unread_total"] == 0
    ctx.clock.advance(timedelta(days=180))
    assert [item["id"] for item in chat.messages(Actor(id="a"), identifier)["items"]] == [second["id"]]
    ctx.clock.advance(timedelta(seconds=1))
    assert chat.messages(Actor(id="a"), identifier)["items"] == []
    assert chat.send(Actor(id="a"), identifier, "First", "chat-message-key-01") == {"message": None, "removed": True}
    assert ctx.storage.connection.execute("SELECT COUNT(*) FROM chat_messages").fetchone()[0] == 0


def test_pagination_unread_and_idempotency_are_scoped_to_conversation(chat_context):
    ctx = chat_context
    chat, _, identifier = connect(ctx)
    for number in range(6):
        chat.send(Actor(id="a"), identifier, f"Message {number}", f"chat-message-{number:04}-key")
    latest = chat.messages(Actor(id="b"), identifier, limit=2)
    assert latest["has_more"] and [m["body"] for m in latest["items"]] == ["Message 4", "Message 5"]
    previous = chat.messages(Actor(id="b"), identifier, before=latest["items"][0]["id"], limit=2)
    assert [m["body"] for m in previous["items"]] == ["Message 2", "Message 3"]
    assert chat.conversations(Actor(id="b"), limit=1)["unread_total"] == 6
    with pytest.raises(RoommateError, match="operation_conflict"):
        chat.send(Actor(id="a"), identifier, "Changed", "chat-message-0000-key")
    with pytest.raises(RoommateError, match="invalid_message"):
        chat.send(Actor(id="a"), identifier, "x" * 2001, "chat-too-long-key1")
    for invalid in ("Hello\x00world", "\ud800"):
        with pytest.raises(RoommateError, match="invalid_message"):
            chat.send(Actor(id="a"), identifier, invalid, "chat-invalid-msg01")


def test_opposite_invites_and_repeated_accept_race_create_one_conversation(tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from relohome_roommate.access import RoommateContext

    path = tmp_path / "race.db"
    with Storage(path) as storage:
        clock = prepare(storage).clock
    barrier = Barrier(2)

    def invite(actor, target):
        with Storage(path, initialize=False) as storage:
            ctx = RoommateContext(storage, clock=clock)
            barrier.wait(timeout=5)
            return ChatService(ctx).invite(Actor(id=actor), target, complete(), f"chat-invite-{actor}-0001")

    with ThreadPoolExecutor(max_workers=2) as pool:
        first, second = pool.submit(invite, "a", "b"), pool.submit(invite, "b", "a")
        first, second = first.result(timeout=15), second.result(timeout=15)
    assert first["request_id"] == second["request_id"]
    with Storage(path) as storage:
        ctx = RoommateContext(storage, clock=clock)
        recipient = ctx.connections.get(first["request_id"]).recipient_id

    def accept(number):
        with Storage(path, initialize=False) as storage:
            ctx = RoommateContext(storage, clock=clock)
            barrier.wait(timeout=5)
            return ChatService(ctx).accept(Actor(id=recipient), first["request_id"], f"chat-accept-{number}-001")

    with ThreadPoolExecutor(max_workers=2) as pool:
        one, two = pool.submit(accept, 1), pool.submit(accept, 2)
        assert one.result(timeout=15)["conversation_id"] == two.result(timeout=15)["conversation_id"]
    with Storage(path) as storage:
        assert storage.connection.execute("SELECT COUNT(*) FROM chat_conversations").fetchone()[0] == 1


def test_legacy_contact_changes_do_not_cancel_chat_requests_or_create_chat_grants(tmp_path):
    from relohome_roommate.connections import ContactRef
    from relohome_roommate.contact_vault import ContactVault
    from relohome_roommate.services.contacts import ContactService
    from relohome_roommate.services.requests import RequestService

    with Storage(tmp_path / "legacy.db") as storage:
        ctx = prepare(storage)
        ctx.vault = ContactVault(tmp_path / "contact.key")
        old = RequestService(ctx).send(
            Actor(id="a"), "b", complete(), ContactRef(channel_id="a", version=1), True, "legacy-contact-send01"
        )
        chat = ChatService(ctx)
        new = chat.invite(Actor(id="a"), "b", complete(), "chat-invite-key-001")
        ContactService(ctx).save(Actor(id="a"), "phone", "0901234567", 1, "legacy-update-key01")
        assert ctx.connections.get(old["request_id"]).state.value == "cancelled"
        assert ctx.connections.get(new["request_id"]).state.value == "pending"
        chat.accept(Actor(id="b"), new["request_id"], "chat-accept-key-001")
        assert ctx.connections.grant(new["request_id"]) is None


def test_private_only_sender_erasure_revokes_chat_without_a_public_profile(chat_context):
    from relohome_roommate.services.inbox import InboxService
    from relohome_roommate.services.privacy import PrivacyService

    ctx = chat_context
    with ctx.transaction():
        ctx.storage.connection.execute("DELETE FROM profiles WHERE owner='a'")
    chat, sent, identifier = connect(ctx)
    chat.send(Actor(id="b"), identifier, "Received private message", "chat-received-key01")
    PrivacyService(ctx).erase(Actor(id="a"), True, None)
    for actor in ("a", "b"):
        with pytest.raises(RoommateError, match="conversation_unavailable"):
            chat.messages(Actor(id=actor), identifier)
        assert not InboxService(ctx).detail(Actor(id=actor), sent["request_id"])["available"]
    assert chat.conversations(Actor(id="b"))["items"] == []


def test_privacy_message_export_is_paged_owner_only_and_not_silently_truncated(chat_context):
    from relohome_roommate.services.privacy import PrivacyService

    ctx = chat_context
    chat, _, identifier = connect(ctx)
    for number in range(5):
        chat.send(Actor(id="a"), identifier, f"Own message {number}", f"chat-own-message-{number:03}")
    chat.send(Actor(id="b"), identifier, "Other person's private content", "chat-other-message1")
    privacy = PrivacyService(ctx)
    first = privacy.export_messages(Actor(id="a"), limit=3)
    assert len(first["chat_messages"]) == 3 and first["chat_messages_next"]
    last = privacy.export_messages(Actor(id="a"), before=first["chat_messages_next"], limit=3)
    assert len(last["chat_messages"]) == 2 and last["chat_messages_next"] is None
    assert "Other person's" not in str(first) + str(last)
    with pytest.raises(RoommateError, match="invalid_cursor"):
        privacy.export_messages(Actor(id="b"), before=first["chat_messages_next"])
