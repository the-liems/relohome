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
