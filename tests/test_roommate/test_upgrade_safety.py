import sqlite3
from concurrent.futures import ThreadPoolExecutor

import pytest

from src.roommate.access import RoommateError
from src.roommate.migrations import SCHEMA
from src.roommate.operations import backup_sqlite
from src.roommate.ports import Actor
from src.roommate.services.moderation import ModerationService
from src.roommate.services.safety import SafetyService
from src.roommate.storage import Storage
from tests.test_roommate.test_request_lifecycle import prepare


def test_raw_backup_keeps_v1_and_upgrade_preserves_private_rows(tmp_path):
    from src.roommate.contact_vault import ContactVault

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
        assert db.connection.execute("PRAGMA user_version").fetchone()[0] == 2


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
    from src.roommate.connections import ContactRef
    from src.roommate.services.requests import RequestService
    from tests.test_roommate.test_profile_lifecycle import complete

    with pg_store.storage() as db:
        ctx = prepare(db)
        clock = ctx.clock

    def send(sender, recipient):
        from src.roommate.access import RoommateContext

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
