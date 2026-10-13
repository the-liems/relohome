"""Operator CLIs must use the live gateway's state, regardless of terminal cwd."""

import sqlite3
import sys

import pytest
from relohome_gateway import admin_provision, cloud_backup
from relohome_gateway.runtime_paths import database_path, media_path, traveler_key_path
from relohome_gateway.store import Store


@pytest.fixture
def deployment(tmp_path, monkeypatch):
    root = tmp_path / "deployment"
    root.mkdir()
    terminal = tmp_path / "terminal"
    terminal.mkdir()
    monkeypatch.chdir(terminal)
    monkeypatch.setenv("RELOHOME_RUNTIME_ROOT", str(root))
    for name in ("SIU_WEB_DB", "SIU_HOUSING_MEDIA_DIR", "SIU_TRAVELER_KEY_FILE", "SIU_TRAVELER_KEY"):
        monkeypatch.delenv(name, raising=False)
    return root, terminal


@pytest.mark.parametrize("configuration", ["default", "relative_environment", "relative_cli", "coolify"])
def test_admin_cli_selects_live_account_and_preserves_sessions(deployment, monkeypatch, capsys, configuration):
    root, terminal = deployment
    options = []
    override = None
    if configuration == "relative_environment":
        monkeypatch.setenv("SIU_WEB_DB", "existing/accounts.db")
    elif configuration == "relative_cli":
        monkeypatch.setenv("SIU_WEB_DB", "unused/accounts.db")
        override = "existing/accounts.db"
        options = ["--database", override]
    elif configuration == "coolify":
        monkeypatch.setenv("SIU_WEB_DB", str(root / "data/siu-web.sqlite3"))
    database = database_path(root, override)
    identifier = admin_provision.provision(database, "admin@example.test", "Admin", "fixture-strong-password")
    store = Store(database)
    token = store.create_session(identifier)
    original = store.one("SELECT * FROM users WHERE id=?", (identifier,))
    store.write("INSERT INTO runs VALUES ('active', 'owner', 'thread', 'hash', 'running', NULL)")
    monkeypatch.setattr(sys, "argv", ["admin_provision", "--email", "admin@example.test", "--existing", *options])
    monkeypatch.setattr(admin_provision.getpass, "getpass", lambda _: pytest.fail("Existing account must not prompt"))

    admin_provision.main()

    assert identifier in capsys.readouterr().out
    assert store.one("SELECT * FROM users WHERE id=?", (identifier,)) == original
    assert store.session_user(token)["id"] == identifier
    assert store.one("SELECT status FROM runs WHERE id='active'")["status"] == "running"
    store.db.close()
    assert list(terminal.iterdir()) == []
    assert list(root.rglob("*.db")) + list(root.rglob("*.sqlite3")) == [database]


def test_admin_creation_uses_gateway_default_and_never_prints_password(deployment, monkeypatch, capsys):
    root, terminal = deployment
    password = "fixture-private-password"
    monkeypatch.setattr(sys, "argv", ["admin_provision", "--email", "admin@example.test"])
    monkeypatch.setattr(admin_provision.getpass, "getpass", lambda _: password)

    admin_provision.main()

    output = capsys.readouterr().out
    assert "Operator account ID:" in output and "redeploy/recreate" in output
    assert password not in output
    with sqlite3.connect(database_path(root)) as connection:
        assert connection.execute("SELECT email FROM users").fetchall() == [("admin@example.test",)]
    assert list(terminal.iterdir()) == []


@pytest.mark.parametrize("configuration", ["default", "relative_environment", "relative_cli", "coolify"])
def test_backup_cli_keeps_accounts_photos_and_correct_key_together(deployment, monkeypatch, configuration):
    root, terminal = deployment
    options = []
    database_override = media_override = key_override = None
    if configuration == "relative_environment":
        monkeypatch.setenv("SIU_WEB_DB", "existing/accounts.db")
        monkeypatch.setenv("SIU_HOUSING_MEDIA_DIR", "existing/photos")
        monkeypatch.setenv("SIU_TRAVELER_KEY_FILE", "private/traveler.key")
    elif configuration == "relative_cli":
        monkeypatch.setenv("SIU_WEB_DB", "unused/accounts.db")
        monkeypatch.setenv("SIU_HOUSING_MEDIA_DIR", "unused/photos")
        monkeypatch.setenv("SIU_TRAVELER_KEY_FILE", "unused/key")
        database_override, media_override, key_override = (
            "existing/accounts.db",
            "existing/photos",
            "private/traveler.key",
        )
        options = ["--database", database_override, "--media", media_override, "--key", key_override]
    elif configuration == "coolify":
        monkeypatch.setenv("SIU_WEB_DB", str(root / "data/siu-web.sqlite3"))
        monkeypatch.setenv("SIU_HOUSING_MEDIA_DIR", str(root / "data/housing-media"))
    database = database_path(root, database_override)
    media = media_path(root, media_override)
    key = traveler_key_path(database, root, key_override)
    identifier = admin_provision.provision(database, "admin@example.test", "Admin", "fixture-strong-password")
    media.mkdir(parents=True)
    (media / "room.png").write_bytes(b"private-photo-fixture")
    key.parent.mkdir(parents=True, exist_ok=True)
    key.write_bytes(b"original-traveler-key-fixture")
    destination = root / "backup"
    monkeypatch.setattr(sys, "argv", ["cloud_backup", "--output", str(destination), *options])

    cloud_backup.main()

    with sqlite3.connect(destination / "siu-web.sqlite3") as connection:
        assert connection.execute("SELECT id FROM users").fetchall() == [(identifier,)]
    assert (destination / "housing-media/room.png").read_bytes() == b"private-photo-fixture"
    assert (destination / "siu-web-traveler.key").read_bytes() == key.read_bytes()
    assert list(terminal.iterdir()) == []


@pytest.mark.parametrize("module", [admin_provision, cloud_backup])
def test_cli_requires_explicit_runtime_root_before_writes_or_password_prompt(deployment, monkeypatch, module):
    root, terminal = deployment
    monkeypatch.delenv("RELOHOME_RUNTIME_ROOT")
    options = ["--email", "admin@example.test"] if module is admin_provision else ["--output", str(root / "backup")]
    monkeypatch.setattr(sys, "argv", [module.__name__, *options])
    monkeypatch.setattr(
        admin_provision.getpass, "getpass", lambda _: pytest.fail("Missing root must fail before prompting")
    )

    with pytest.raises(SystemExit) as error:
        module.main()

    assert error.value.code == 2
    assert list(root.iterdir()) == []
    assert list(terminal.iterdir()) == []
