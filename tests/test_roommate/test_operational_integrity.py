import shutil
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from relohome_roommate.access import RoommateContext, RoommateError
from relohome_roommate.connections import ContactRef
from relohome_roommate.contact_vault import ContactVault
from relohome_roommate.ports import Actor
from relohome_roommate.services.consent import ConsentService
from relohome_roommate.services.contacts import ContactService
from relohome_roommate.services.requests import RequestService
from relohome_roommate.services.safety import SafetyService
from relohome_roommate.storage import Storage

from tests.test_roommate.test_profile_lifecycle import complete
from tests.test_roommate.test_request_lifecycle import prepare


def pending(path, key):
    with Storage(path) as db:
        ctx = prepare(db)
        ctx.vault = ContactVault(key)
        with ctx.transaction():
            for identifier in ("a", "b"):
                db.connection.execute(
                    "UPDATE contacts SET ciphertext=? WHERE id=?", (ctx.vault.seal("0901234567"), identifier)
                )
        sent = RequestService(ctx).send(
            Actor(id="a"), "b", complete(), ContactRef(channel_id="a", version=1), True, "send-operation-001"
        )
        return sent["request_id"], ctx.clock


@pytest.mark.parametrize("change", ["block", "contact"])
def test_accept_racing_safety_change_never_leaves_contact_open(tmp_path, change):
    path, key = tmp_path / "db", tmp_path / "key"
    identifier, clock = pending(path, key)
    barrier = Barrier(2)

    def perform(accept):
        with Storage(path) as db:
            ctx = RoommateContext(db, clock=clock, vault=ContactVault(key, create=False))
            barrier.wait(timeout=5)
            if accept:
                try:
                    return ConsentService(ctx).accept(
                        Actor(id="b"), identifier, ContactRef(channel_id="b", version=1), True, "accept-operation001"
                    )
                except RoommateError as error:
                    assert error.code == "request_not_pending"
                    return None
            if change == "block":
                return SafetyService(ctx).block(Actor(id="a"), "b", True, "block-operation001")
            return ContactService(ctx).save(Actor(id="a"), "phone", "0901234568", 1, "contact-operation01")

    with ThreadPoolExecutor(max_workers=2) as pool:
        accepting, changing = pool.submit(perform, True), pool.submit(perform, False)
        accepting.result(timeout=15)
        changing.result(timeout=15)
    with Storage(path) as db:
        ctx = RoommateContext(db, clock=clock, vault=ContactVault(key, create=False))
        for actor in ("a", "b"):
            with pytest.raises(RoommateError, match="contact_unavailable"):
                ConsentService(ctx).read(Actor(id=actor), identifier)
        grant = ctx.connections.grant(identifier)
        assert grant is None or grant.state.value == "revoked"


def test_sqlite_backup_and_vault_key_restore_preserve_consent_and_retry(tmp_path):
    original, key = tmp_path / "db", tmp_path / "key"
    identifier, clock = pending(original, key)
    backup = tmp_path / "backup"
    backup.mkdir()
    with Storage(original) as db:
        ctx = RoommateContext(db, clock=clock, vault=ContactVault(key, create=False))
        result = ConsentService(ctx).accept(
            Actor(id="b"), identifier, ContactRef(channel_id="b", version=1), True, "accept-operation001"
        )
        with sqlite3.connect(backup / "db") as destination:
            db.connection.backup(destination)
    shutil.copyfile(key, backup / "key")
    with Storage(backup / "db") as db:
        ctx = RoommateContext(db, clock=clock, vault=ContactVault(backup / "key", create=False))
        assert ConsentService(ctx).read(Actor(id="a"), identifier)["contact"]["value"] == "0901234567"
        assert (
            ConsentService(ctx).accept(
                Actor(id="b"), identifier, ContactRef(channel_id="b", version=1), True, "accept-operation001"
            )
            == result
        )
        assert db.connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert db.connection.execute("PRAGMA foreign_key_check").fetchall() == []
