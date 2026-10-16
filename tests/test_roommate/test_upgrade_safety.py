import sqlite3
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from relohome_roommate.access import RoommateError
from relohome_roommate.migrations import SCHEMA
from relohome_roommate.operations import backup_sqlite
from relohome_roommate.ports import Actor
from relohome_roommate.services.moderation import ModerationService
from relohome_roommate.services.safety import SafetyService
from relohome_roommate.storage import Storage

from tests.test_roommate.test_request_lifecycle import prepare


def test_raw_backup_keeps_v1_and_upgrade_preserves_private_rows(tmp_path):
    from relohome_roommate.contact_vault import ContactVault

    source = tmp_path / "legacy"
    source.mkdir()
    vault = ContactVault(source / "contact.key")
    path = source / "roommate.sqlite3"
    with sqlite3.connect(path) as db:
        for statement in SCHEMA:
            db.execute(statement)
        db.execute("PRAGMA user_version=1")
        db.execute(
            "INSERT INTO contacts VALUES (?,?,?,?,?)", ("contact", "owner", "phone", 7, vault.seal("0901234567"))
        )
    snapshot = tmp_path / "backup"
    backup_sqlite(source, snapshot)
    with sqlite3.connect(snapshot / "roommate.sqlite3") as db:
        assert db.execute("PRAGMA user_version").fetchone()[0] == 1
    with Storage(path) as db:
        row = db.connection.execute("SELECT version,ciphertext FROM contacts").fetchone()
        assert row[0] == 7
        assert vault.open(bytes(row[1])) == "0901234567"
        assert db.connection.execute("PRAGMA user_version").fetchone()[0] == 3
        assert db.connection.execute("SELECT COUNT(*) FROM chat_messages").fetchone()[0] == 0


def test_relative_backup_paths_use_runtime_root_from_unrelated_cwd(tmp_path, monkeypatch):
    from relohome_roommate.contact_vault import ContactVault

    root = tmp_path / "runtime"
    source = root / "legacy"
    source.mkdir(parents=True)
    vault = ContactVault(source / "contact.key")
    with sqlite3.connect(source / "roommate.sqlite3") as db:
        for statement in SCHEMA:
            db.execute(statement)
        db.execute("PRAGMA user_version=1")
        db.execute(
            "INSERT INTO contacts VALUES (?,?,?,?,?)", ("contact", "owner", "phone", 7, vault.seal("0901234567"))
        )
    unrelated = tmp_path / "unrelated"
    unrelated.mkdir()
    monkeypatch.chdir(unrelated)
    monkeypatch.setenv("RELOHOME_RUNTIME_ROOT", str(root))

    result = backup_sqlite(Path("legacy"), Path("backup"))
    assert result == {"path": str(root / "backup"), "schema_version": 1, "integrity": "ok"}
    assert (root / "backup/contact.key").read_bytes() == (source / "contact.key").read_bytes()
    with sqlite3.connect(root / "backup/roommate.sqlite3") as db:
        row = db.execute("SELECT version,ciphertext FROM contacts").fetchone()
        assert row[0] == 7
        assert vault.open(row[1]) == "0901234567"
    assert not list(unrelated.iterdir())
    for public in ("data/backup", "Frontend/public/backup", "apps/web/public/backup", "apps/web/dist/backup"):
        with pytest.raises(ValueError, match="outside public data"):
            backup_sqlite(Path("legacy"), Path(public))
        assert not (root / public).exists()


def test_nested_read_does_not_leave_outer_writer_readonly(tmp_path):
    with Storage(tmp_path / "db") as db, db.transaction():
        with pytest.raises(RuntimeError, match="Nested"):
            with db.transaction(readonly=True):
                pass
        db.connection.execute("INSERT INTO restrictions VALUES ('owner',1)")


def test_identical_open_reports_are_deduplicated_and_review_is_audited(tmp_path):
    with Storage(tmp_path / "db") as db:
        ctx = prepare(db)
        ctx.moderators = frozenset({"mod"})
        service = SafetyService(ctx)
        first = service.report(Actor(id="a"), "b", "Spam", "report-operation-01")
        assert service.report(Actor(id="a"), "b", "Spam", "report-operation-02") == first
        mod = ModerationService(ctx)
        mod.resolve_report(Actor(id="mod"), first["report_id"])
        mod.resolve_report(Actor(id="mod"), first["report_id"])
        assert db.connection.execute("SELECT COUNT(*) FROM moderation WHERE action='report_review'").fetchone()[0] == 1
        assert service.report(Actor(id="a"), "b", "Spam", "report-operation-03") != first
        with pytest.raises(RoommateError, match="report_unavailable"):
            mod.resolve_report(Actor(id="mod"), "missing")


def test_two_postgres_replicas_keep_one_pair_under_simultaneous_requests(pg_store):
    from relohome_roommate.connections import ContactRef
    from relohome_roommate.services.requests import RequestService

    from tests.test_roommate.test_profile_lifecycle import complete

    with pg_store.storage() as db:
        ctx = prepare(db)
        clock = ctx.clock

    def send(sender, recipient):
        from relohome_roommate.access import RoommateContext

        with pg_store.storage() as db:
            ctx = RoommateContext(db, clock=clock)
            return RequestService(ctx).send(
                Actor(id=sender),
                recipient,
                complete(),
                ContactRef(channel_id=sender, version=1),
                True,
                "parallel-operation-" + sender,
            )

    with ThreadPoolExecutor(max_workers=2) as workers:
        first = workers.submit(send, "a", "b")
        second = workers.submit(send, "b", "a")
        assert first.result()["request_id"] == second.result()["request_id"]
    with pg_store.storage() as db:
        assert db.connection.execute("SELECT COUNT(*) FROM requests").fetchone()[0] == 1
