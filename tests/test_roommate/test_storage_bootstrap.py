import sqlite3

import pytest
from relohome_roommate.contact_vault import ContactVault
from relohome_roommate.migrations import migrate
from relohome_roommate.storage import Storage


def test_bootstrap_restart_and_rollback(tmp_path):
    path = tmp_path / "private" / "roommate.sqlite3"
    with Storage(path) as db:
        assert db.connection.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
        assert db.connection.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        with pytest.raises(RuntimeError), db.transaction():
            db.connection.execute("INSERT INTO restrictions VALUES ('u', 1)")
            raise RuntimeError("abort")
        assert db.connection.execute("SELECT COUNT(*) FROM restrictions").fetchone()[0] == 0
    with Storage(path) as db:
        assert db.connection.execute("PRAGMA user_version").fetchone()[0] == 3
        assert db.connection.execute("SELECT COUNT(*) FROM chat_conversations").fetchone()[0] == 0


def test_migration_failure_is_atomic(tmp_path):
    connection = sqlite3.connect(tmp_path / "fail.sqlite3", isolation_level=None)
    with pytest.raises(sqlite3.OperationalError):
        migrate(connection, ("CREATE TABLE should_rollback(id TEXT)", "BROKEN SQL"))
    assert connection.execute("SELECT name FROM sqlite_master WHERE name='should_rollback'").fetchone() is None
    assert connection.execute("PRAGMA user_version").fetchone()[0] == 0
    connection.close()


def test_vault_restart_uses_same_private_key(tmp_path):
    vault = ContactVault(tmp_path / "contact.key")
    sealed = vault.seal("private-phone")
    assert b"private-phone" not in sealed
    assert ContactVault(tmp_path / "contact.key").open(sealed) == "private-phone"
    with pytest.raises(ValueError):
        ContactVault(tmp_path / "other.key").open(sealed)


def test_vault_does_not_recreate_missing_key_for_existing_contacts(tmp_path):
    with pytest.raises(FileNotFoundError):
        ContactVault(tmp_path / "missing.key", create=False)
