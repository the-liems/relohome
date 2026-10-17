import pytest
from relohome_roommate.contact_vault import ContactVault
from relohome_roommate.ports import Actor
from relohome_roommate.storage import Storage

from tests.test_roommate.test_request_lifecycle import prepare


def test_recoverable_draft_is_encrypted_owner_only_and_not_replayed(tmp_path):
    from relohome_roommate.services.operation_drafts import OperationDraftService

    with Storage(tmp_path / "db") as db:
        ctx = prepare(db)
        ctx.vault = ContactVault(tmp_path / "contact.key")
        service = OperationDraftService(ctx)
        body = {"kind": "phone", "value": "0901234567", "expected_version": 1, "operation_key": "draft-test-operation1"}
        service.save(Actor(id="a"), "/me/contacts", "PUT", body)
        raw = db.connection.execute("SELECT ciphertext FROM operation_drafts").fetchone()[0]
        assert b"0901234567" not in raw
        assert service.get(Actor(id="a"), body["operation_key"])["draft"]["body"] == body
        with pytest.raises(ValueError, match="draft_unavailable"):
            service.get(Actor(id="b"), body["operation_key"])
        assert ctx.connections.counts("a", ctx.clock.now()) == (0, 0)
        with pytest.raises(ValueError, match="operation_conflict"):
            service.save(Actor(id="a"), "/me/contacts", "PUT", {**body, "value": "0907654321"})


def test_moderator_can_recover_only_owned_actions_without_personal_roommate_consent(tmp_path):
    from relohome_roommate.services.access import AccessService
    from relohome_roommate.services.moderation import ModerationService
    from relohome_roommate.services.operation_drafts import OperationDraftService
    from relohome_roommate.services.requests import RequestService

    with Storage(tmp_path / "db") as db:
        ctx = prepare(db)
        ctx.vault = ContactVault(tmp_path / "contact.key")
        ctx.moderators = frozenset({"admin", "other-admin"})
        admin = Actor(id="admin")
        assert not AccessService(ctx).status(admin)["eligible"]
        service = OperationDraftService(ctx)
        body = {"selected": True, "reason": "Reported inappropriate content", "operation_key": "admin-restrict-0001"}
        service.save(admin, "/moderation/profiles/b", "POST", body)
        assert service.list(admin)["items"][0]["operation_key"] == body["operation_key"]
        assert service.get(admin, body["operation_key"])["draft"]["body"] == body
        assert service.list(Actor(id="other-admin"))["items"] == []
        with pytest.raises(ValueError, match="draft_unavailable"):
            service.get(Actor(id="other-admin"), body["operation_key"])
        service.discard(Actor(id="other-admin"), body["operation_key"])
        assert service.list(admin)["items"]
        with pytest.raises(ValueError, match="service_terms_required"):
            service.save(admin, "/blocks/b", "PUT", {"selected": True, "operation_key": "admin-consumer-0001"})
        with pytest.raises(ValueError, match="moderator_required"):
            service.save(Actor(id="a"), "/moderation/profiles/b", "POST", body)
        assert RequestService(ctx).operation(admin, body["operation_key"])["status"] == "not_found"
        result = ModerationService(ctx).restrict(admin, "b", True, body["reason"], body["operation_key"])
        assert RequestService(ctx).operation(admin, body["operation_key"])["result"] == result
        assert service.get(admin, body["operation_key"])["status"] == "completed"
        assert RequestService(ctx).operation(Actor(id="other-admin"), body["operation_key"])["status"] == "not_found"
        service.discard(admin, body["operation_key"])
        assert service.list(admin)["items"] == []
