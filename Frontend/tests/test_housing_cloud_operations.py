import json
import sqlite3

import pytest

from Frontend.admin_provision import provision
from Frontend.cloud_backup import backup
from Frontend.store import Store, password_hash


def test_operator_provisioning_preserves_existing_accounts_and_never_grants_public_roles(tmp_path):
    path = tmp_path / "web.db"
    identifier = provision(path, "operator@example.test", "Admin", "a-dedicated-strong-password")
    store = Store(path)
    row = store.one("SELECT * FROM users WHERE id=?", (identifier,))
    assert row["password"] == password_hash("a-dedicated-strong-password", row["salt"])
    assert row["password"] != "a-dedicated-strong-password"
    before = dict(row)
    store.write("INSERT INTO runs VALUES ('active', 'owner', 'thread', 'hash', 'running', NULL)")
    with pytest.raises(ValueError):
        provision(path, "operator@example.test", "Overwrite", "different-password")
    assert provision(path, "operator@example.test", "Ignored", existing=True) == identifier
    assert store.one("SELECT * FROM users WHERE id=?", (identifier,)) == before
    assert store.all("SELECT * FROM sessions") == []
    assert store.one("SELECT status FROM runs WHERE id='active'")["status"] == "running"
    store.db.close()


def test_backup_restores_wal_accounts_media_and_traveler_key(tmp_path, monkeypatch):
    monkeypatch.delenv("SIU_TRAVELER_KEY", raising=False)
    database = tmp_path / "web.db"
    store = Store(database)
    store.write("INSERT INTO users VALUES ('old','user@example.test','User','salt','hash','{}')")
    key = tmp_path / "key"
    key.write_bytes(b"private-encryption-key")
    media = tmp_path / "media"
    media.mkdir()
    (media / "photo.png").write_bytes(b"private-room-photo")
    target = tmp_path / "backup"
    manifest = backup(target, database, media, key)
    restored = sqlite3.connect(target / "siu-web.sqlite3")
    assert restored.execute("SELECT id FROM users").fetchone() == ("old",)
    assert (target / "housing-media/photo.png").read_bytes() == b"private-room-photo"
    assert (target / "siu-web-traveler.key").read_bytes() == b"private-encryption-key"
    assert json.loads((target / "manifest.json").read_text()) == manifest
    assert (target.stat().st_mode & 0o777) == 0o700
    restored.close()
    store.db.close()
