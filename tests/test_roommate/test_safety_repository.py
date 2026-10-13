from datetime import UTC, datetime

from relohome_roommate.safety_repository import SqlSafety
from relohome_roommate.storage import Storage


def test_block_is_bidirectional_and_unblock_is_actor_scoped(tmp_path):
    with Storage(tmp_path / "db") as db, db.transaction():
        repo = SqlSafety(db.connection)
        repo.block("a", "b", True)
        repo.block("b", "a", True)
        assert repo.blocked("a", "b") and repo.blocked("b", "a")
        repo.block("a", "b", False)
        assert repo.blocked("a", "b")
        repo.block("b", "a", False)
        assert not repo.blocked("a", "b")


def test_report_not_automatic_restriction_and_audit_survives_restart(tmp_path):
    path = tmp_path / "db"
    now = datetime(2026, 10, 7, tzinfo=UTC)
    with Storage(path) as db, db.transaction():
        repo = SqlSafety(db.connection)
        report_id = repo.report("a", "b", "Reason", now)
        assert not repo.restricted("b")
        assert not repo.blocked("a", "b")
        repo.moderate("moderator", "b", True, "Reviewed", now)
        assert repo.restricted("b")
        repo.resolve_report(report_id)
    with Storage(path) as db:
        repo = SqlSafety(db.connection)
        assert repo.restricted("b")
        assert repo.reports()[0]["status"] == "reviewed"
        assert db.connection.execute("SELECT actor,reason FROM moderation").fetchone()[0] == "moderator"
