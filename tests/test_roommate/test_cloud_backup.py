from datetime import timedelta

import pytest
from cryptography.fernet import Fernet
from relohome_agent.config import Settings
from relohome_agent.roommate_runtime import RoommateRuntime
from relohome_roommate.connections import ContactRef
from relohome_roommate.operations import backup, import_snapshot
from relohome_roommate.ports import Actor
from relohome_roommate.services.consent import ConsentService
from relohome_roommate.services.requests import RequestService

from tests.test_roommate.test_profile_lifecycle import complete
from tests.test_roommate.test_request_lifecycle import prepare


def test_postgres_portable_backup_restores_sqlite_consent_and_original_retry(tmp_path, pg_store):
    from relohome_roommate.contact_vault import ContactVault
    from relohome_roommate.location_catalog import AreaCatalog

    key = Fernet.generate_key().decode()
    vault = ContactVault(tmp_path / "unused", key_value=key)
    runtime = RoommateRuntime(
        tmp_path / "source", vault, AreaCatalog(), frozenset({"mod"}), "test-token", postgres=pg_store
    )
    with runtime.context() as ctx:
        ctx = prepare(ctx.storage)
        ctx.vault = vault
        runtime.clock = ctx.clock
        with ctx.transaction():
            ctx.storage.connection.execute("UPDATE contacts SET ciphertext=?", (vault.seal("0901234567"),))
        payload = (Actor(id="a"), "b", complete(), ContactRef(channel_id="a", version=1), True, "cloud-send-operation1")
        sent = RequestService(ctx).send(*payload)
        ConsentService(ctx).accept(
            Actor(id="b"), sent["request_id"], ContactRef(channel_id="b", version=1), True, "cloud-accept-operation1"
        )
        expires = ctx.connections.grant(sent["request_id"]).expires_at
    directory = tmp_path / "snapshot"
    assert backup(runtime, directory)["integrity"] == "ok"
    target = RoommateRuntime.open(
        Settings(
            _env_file=None,
            roommate_enabled=True,
            roommate_state_dir=tmp_path / "target",
            roommate_moderators="mod",
            agent_api_token="test-token",
            roommate_contact_key=key,
        )
    )
    target.clock = runtime.clock
    try:
        import_snapshot(target, directory)
        with target.context() as ctx:
            assert ctx.connections.grant(sent["request_id"]).expires_at == expires
            assert ConsentService(ctx).read(Actor(id="a"), sent["request_id"])["contact"]["value"] == "0901234567"
            assert RequestService(ctx).send(*payload) == sent
        with pytest.raises(ValueError, match="empty destination"):
            import_snapshot(target, directory)
    finally:
        target.close()


def test_cleanup_removes_expired_encrypted_draft_but_retains_operation_and_quota(tmp_path):
    from relohome_roommate.contact_vault import ContactVault
    from relohome_roommate.maintenance import reconcile
    from relohome_roommate.services.operation_drafts import OperationDraftService
    from relohome_roommate.storage import Storage

    with Storage(tmp_path / "db") as db:
        ctx = prepare(db)
        ctx.vault = ContactVault(tmp_path / "key")
        body = {"kind": "phone", "value": "0901234567", "expected_version": 1, "operation_key": "cleanup-operation-1"}
        OperationDraftService(ctx).save(Actor(id="a"), "/me/contacts", "PUT", body)
        ctx.clock.advance(timedelta(minutes=31))
        with ctx.transaction():
            reconcile(ctx)
        assert db.connection.execute("SELECT COUNT(*) FROM operation_drafts").fetchone()[0] == 0
        assert db.connection.execute("SELECT COUNT(*) FROM contacts").fetchone()[0] == 2


def test_sqlite_snapshot_imports_postgres_without_mutating_backup(tmp_path, pg_store):
    from relohome_roommate.contact_vault import ContactVault
    from relohome_roommate.location_catalog import AreaCatalog
    from relohome_roommate.storage import Storage

    vault = ContactVault(tmp_path / "key")
    source = RoommateRuntime(tmp_path / "source.sqlite3", vault, AreaCatalog(), frozenset({"mod"}), "test-token")
    with Storage(source.path) as db:
        ctx = prepare(db)
        source.clock = ctx.clock
        with ctx.transaction():
            db.connection.execute("UPDATE contacts SET ciphertext=?", (vault.seal("0901234567"),))
        sent = RequestService(ctx).send(
            Actor(id="a"), "b", complete(), ContactRef(channel_id="a", version=1), True, "import-pg-operation1"
        )
    directory = tmp_path / "snapshot"
    backup(source, directory)
    original = (directory / "roommate.sqlite3").read_bytes()
    target = RoommateRuntime(
        tmp_path / "unused",
        vault,
        AreaCatalog(),
        frozenset({"mod"}),
        "test-token",
        clock=source.clock,
        postgres=pg_store,
    )
    counts = import_snapshot(target, directory)["imported"]
    assert counts["requests"] == 1
    assert (directory / "roommate.sqlite3").read_bytes() == original
    with target.context() as ctx:
        assert ctx.connections.get(sent["request_id"]).state.value == "pending"
        assert (
            ctx.vault.open(
                bytes(ctx.storage.connection.execute("SELECT ciphertext FROM contacts WHERE owner='a'").fetchone()[0])
            )
            == "0901234567"
        )
