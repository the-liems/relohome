import json
import os
import sqlite3
import subprocess

import pytest
from relohome_gateway.admin_provision import provision
from relohome_gateway.cloud_backup import _restrict_windows_directory, backup
from relohome_gateway.store import Store, password_hash


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
    if os.name == "nt":
        # NTFS permissions are ACLs, not the POSIX mode returned by stat().
        probe = subprocess.run(
            [
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "& { $acl = Get-Acl -LiteralPath $env:RELOHOME_BACKUP_TEST_PATH\n"
                "$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value\n"
                "@{ protected = $acl.AreAccessRulesProtected; operator = $sid; rules = @($acl.Access | "
                "ForEach-Object { @{ sid = $_.IdentityReference.Translate("
                "[System.Security.Principal.SecurityIdentifier]).Value; type = $_.AccessControlType.ToString() } }) } "
                "| ConvertTo-Json -Depth 4 }",
            ],
            env={**os.environ, "RELOHOME_BACKUP_TEST_PATH": str(target)},
            check=True,
            capture_output=True,
            text=True,
            timeout=15,
        )
        acl = json.loads(probe.stdout)
        assert acl["protected"] is True
        assert {rule["sid"] for rule in acl["rules"]} == {acl["operator"], "S-1-5-18"}
        assert all(rule["type"] == "Allow" for rule in acl["rules"])
    else:
        assert (target.stat().st_mode & 0o777) == 0o700
        assert all((path.stat().st_mode & 0o777) == 0o600 for path in target.rglob("*") if path.is_file())
    restored.close()
    store.db.close()


def test_windows_backup_acl_uses_operator_sid_and_disables_inheritance(tmp_path, monkeypatch):
    calls = []

    def run(command, **options):
        calls.append((command, options))
        return subprocess.CompletedProcess(command, 0, '"test-user","S-1-5-21-1-2-3-1001"\n', "")

    monkeypatch.setattr("relohome_gateway.cloud_backup.subprocess.run", run)
    _restrict_windows_directory(tmp_path)
    assert calls[0][0] == ["whoami.exe", "/user", "/fo", "csv", "/nh"]
    assert calls[1][0] == [
        "icacls.exe",
        str(tmp_path.resolve()),
        "/inheritance:r",
        "/grant:r",
        "*S-1-5-21-1-2-3-1001:(OI)(CI)F",
        "*S-1-5-18:(OI)(CI)F",
        "/q",
    ]
    assert all(options["check"] and options["timeout"] == 10 for _, options in calls)


@pytest.mark.parametrize("outcome", ["missing_tool", "acl_denied", "invalid_sid"])
def test_windows_backup_acl_failure_is_explicit(tmp_path, monkeypatch, outcome):
    def run(command, **options):
        if outcome == "missing_tool":
            raise FileNotFoundError("missing")
        if command[0] == "icacls.exe":
            raise subprocess.CalledProcessError(1, command)
        sid = "not-a-sid" if outcome == "invalid_sid" else "S-1-5-21-1-2-3-1001"
        return subprocess.CompletedProcess(command, 0, f'"test-user","{sid}"\n', "")

    monkeypatch.setattr("relohome_gateway.cloud_backup.subprocess.run", run)
    with pytest.raises(ValueError, match="Cannot secure the Windows backup directory"):
        _restrict_windows_directory(tmp_path)


def test_backup_validates_key_before_creating_an_archive(tmp_path, monkeypatch):
    monkeypatch.delenv("SIU_TRAVELER_KEY", raising=False)
    database = tmp_path / "web.db"
    database.write_bytes(b"source-is-not-copied")
    destination = tmp_path / "backup"
    with pytest.raises(ValueError, match="encryption key is missing"):
        backup(destination, database, tmp_path / "media", tmp_path / "missing-key")
    assert not destination.exists()


@pytest.mark.skipif(os.name != "nt", reason="NTFS-specific fail-closed backup test")
def test_backup_does_not_copy_data_when_windows_acl_cannot_be_secured(tmp_path, monkeypatch):
    database = tmp_path / "web.db"
    database.write_bytes(b"private-data")
    key = tmp_path / "key"
    key.write_bytes(b"private-key")

    def denied(directory):
        raise ValueError("Cannot secure the Windows backup directory")

    monkeypatch.setattr("relohome_gateway.cloud_backup._restrict_windows_directory", denied)
    destination = tmp_path / "backup"
    with pytest.raises(ValueError, match="Cannot secure"):
        backup(destination, database, tmp_path / "media", key)
    assert list(destination.iterdir()) == []
