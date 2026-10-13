import pytest
from relohome_roommate.access import RoommateError
from relohome_roommate.connections import ContactRef
from relohome_roommate.contact_vault import ContactVault
from relohome_roommate.policy import ContactKind
from relohome_roommate.ports import Actor
from relohome_roommate.services.consent import ConsentService
from relohome_roommate.services.contacts import ContactService
from relohome_roommate.services.requests import RequestService
from relohome_roommate.storage import Storage

from tests.test_roommate.test_profile_lifecycle import complete
from tests.test_roommate.test_request_lifecycle import prepare


def test_channel_change_revokes_only_that_channel_connections_and_no_restore(tmp_path):
    with Storage(tmp_path / "db") as db:
        ctx = prepare(db)
        ctx.vault = ContactVault(tmp_path / "key")
        contacts = ContactService(ctx)
        # Replace fixture contacts before granting.
        for actor in ("a", "b"):
            contacts.save(Actor(id=actor), ContactKind.PHONE, "0901234567", 1, f"contact-save-{actor}-0001")
        sent = RequestService(ctx).send(
            Actor(id="a"), "b", complete(), ContactRef(channel_id="a", version=2), True, "send-operation-001"
        )
        ConsentService(ctx).accept(
            Actor(id="b"), sent["request_id"], ContactRef(channel_id="b", version=2), True, "accept-operation-01"
        )
        contacts.save(Actor(id="a"), ContactKind.ZALO, "zalo.me/user", None, "contact-save-zalo-001")
        assert ctx.connections.grant(sent["request_id"]).state.value == "active"
        contacts.save(Actor(id="a"), ContactKind.PHONE, "0907654321", 2, "contact-save-phone02")
        assert ctx.connections.grant(sent["request_id"]).state.value == "revoked"
        assert ctx.connections.cooldown("b", "a") is not None
        with pytest.raises(RoommateError):
            ConsentService(ctx).read(Actor(id="b"), sent["request_id"])
        assert b"0907654321" not in db.connection.execute("SELECT ciphertext FROM contacts WHERE id='a'").fetchone()[0]


def test_contact_save_idempotent_version_and_delete(tmp_path):
    with Storage(tmp_path / "db") as db:
        ctx = prepare(db)
        ctx.vault = ContactVault(tmp_path / "key")
        service = ContactService(ctx)
        # Fixture ciphertext is not Fernet; delete it before the production vault owns it.
        with ctx.transaction():
            db.connection.execute("UPDATE contacts SET ciphertext=NULL WHERE owner='a'")
        result = service.save(Actor(id="a"), ContactKind.PHONE, "0901234567", 1, "contact-save-op0001")
        assert service.save(Actor(id="a"), ContactKind.PHONE, "0901234567", 1, "contact-save-op0001") == result
        with pytest.raises(RoommateError, match="contact_version_conflict"):
            service.save(Actor(id="a"), ContactKind.PHONE, "0907654321", 1, "contact-save-op0002")
        service.save(Actor(id="a"), ContactKind.PHONE, None, 2, "contact-delete-op001")
        assert service.own(Actor(id="a"))[0]["value"] is None
