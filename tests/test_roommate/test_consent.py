from datetime import timedelta

import pytest
from relohome_roommate.access import RoommateError
from relohome_roommate.connections import ContactRef
from relohome_roommate.contact_vault import ContactVault
from relohome_roommate.ports import Actor
from relohome_roommate.services.consent import ConsentService
from relohome_roommate.services.requests import RequestService
from relohome_roommate.storage import Storage

from tests.test_roommate.test_profile_lifecycle import complete
from tests.test_roommate.test_request_lifecycle import prepare


def test_two_way_consent_exact_grant_expiry_and_no_contact_before_accept(tmp_path):
    with Storage(tmp_path / "db") as db:
        ctx = prepare(db)
        ctx.vault = ContactVault(tmp_path / "key")
        with ctx.transaction():
            for identifier in ("a", "b"):
                db.connection.execute(
                    "UPDATE contacts SET ciphertext=? WHERE id=?", (ctx.vault.seal("private-" + identifier), identifier)
                )
        service = ConsentService(ctx)
        sent = RequestService(ctx).send(
            Actor(id="a"), "b", complete(), ContactRef(channel_id="a", version=1), True, "send-operation-001"
        )
        identifier = sent["request_id"]
        with pytest.raises(RoommateError, match="contact_unavailable"):
            service.read(Actor(id="b"), identifier)
        with pytest.raises(RoommateError, match="consent_required"):
            service.accept(
                Actor(id="b"), identifier, ContactRef(channel_id="b", version=1), False, "accept-operation-01"
            )
        ctx.clock.advance(timedelta(days=1))
        service.accept(Actor(id="b"), identifier, ContactRef(channel_id="b", version=1), True, "accept-operation-01")
        assert service.read(Actor(id="a"), identifier)["contact"]["value"] == "private-b"
        assert service.read(Actor(id="b"), identifier)["contact"]["value"] == "private-a"
        grant = ctx.connections.grant(identifier)
        assert grant.expires_at == ctx.clock.now() + timedelta(days=7)
        with pytest.raises(RoommateError):
            service.read(Actor(id="outsider"), identifier)
        ctx.clock.advance(timedelta(days=7))
        with pytest.raises(RoommateError, match="contact_unavailable"):
            service.read(Actor(id="a"), identifier)
        assert ctx.connections.get(identifier).state.value == "accepted"


def test_accept_changed_sender_contact_rolls_back_both_grants(tmp_path):
    with Storage(tmp_path / "db") as db:
        ctx = prepare(db)
        sent = RequestService(ctx).send(
            Actor(id="a"), "b", complete(), ContactRef(channel_id="a", version=1), True, "send-operation-001"
        )
        with ctx.transaction():
            db.connection.execute("UPDATE contacts SET version=2 WHERE id='a'")
        with pytest.raises(RoommateError, match="contact_changed"):
            ConsentService(ctx).accept(
                Actor(id="b"), sent["request_id"], ContactRef(channel_id="b", version=1), True, "accept-operation-01"
            )
        assert ctx.connections.grant(sent["request_id"]) is None
        assert ctx.connections.get(sent["request_id"]).state.value == "pending"
