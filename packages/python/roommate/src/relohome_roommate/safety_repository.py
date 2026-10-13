import sqlite3
from datetime import datetime
from uuid import uuid4

from relohome_roommate.clock import utc
from relohome_roommate.storage import require_transaction


class SqlSafety:
    def __init__(self, connection: sqlite3.Connection):
        self.db = connection

    def blocked(self, first: str, second: str) -> bool:
        return (
            self.db.execute(
                "SELECT 1 FROM blocks WHERE (actor=? AND target=?) OR (actor=? AND target=?)",
                (first, second, second, first),
            ).fetchone()
            is not None
        )

    def discovery_exclusions(self, actor: str) -> frozenset[str]:
        """Read both block directions and moderation in the current search transaction."""
        return frozenset(
            row[0]
            for row in self.db.execute(
                "SELECT target FROM blocks WHERE actor=? "
                "UNION SELECT actor FROM blocks WHERE target=? "
                "UNION SELECT actor FROM restrictions WHERE restricted=1",
                (actor, actor),
            )
        )

    def block(self, actor: str, target: str, selected: bool) -> None:
        require_transaction(self.db)
        if selected:
            self.db.execute("INSERT OR IGNORE INTO blocks VALUES (?,?)", (actor, target))
        else:
            self.db.execute("DELETE FROM blocks WHERE actor=? AND target=?", (actor, target))

    def restricted(self, actor: str) -> bool:
        row = self.db.execute("SELECT restricted FROM restrictions WHERE actor=?", (actor,)).fetchone()
        return bool(row and row[0])

    def report(self, actor: str, target: str, reason: str, now: datetime) -> str:
        require_transaction(self.db)
        existing = self.db.execute(
            "SELECT id FROM reports WHERE actor=? AND target=? AND reason=? AND status='open' ORDER BY created,id LIMIT 1",
            (actor, target, reason),
        ).fetchone()
        if existing:
            return existing[0]
        identifier = uuid4().hex
        self.db.execute(
            "INSERT INTO reports(id,actor,target,reason,created) VALUES (?,?,?,?,?)",
            (identifier, actor, target, reason, utc(now).timestamp()),
        )
        return identifier

    def reports(self) -> list[dict]:
        return [dict(row) for row in self.db.execute("SELECT * FROM reports ORDER BY created,id")]

    def resolve_report(self, identifier: str, moderator: str | None = None, now: datetime | None = None) -> None:
        require_transaction(self.db)
        row = self.db.execute("SELECT target,status FROM reports WHERE id=?", (identifier,)).fetchone()
        if not row:
            from relohome_roommate.access import RoommateError

            raise RoommateError("report_unavailable", status=404)
        if row["status"] == "reviewed":
            return
        self.db.execute("UPDATE reports SET status='reviewed' WHERE id=?", (identifier,))
        if moderator is not None and now is not None:
            self.db.execute(
                "INSERT INTO moderation VALUES (?,?,?,?,?,?)",
                (uuid4().hex, moderator, row["target"], "report_review", identifier, utc(now).timestamp()),
            )

    def moderate(self, moderator: str, target: str, restricted: bool, reason: str, now: datetime) -> None:
        require_transaction(self.db)
        self.db.execute(
            "INSERT INTO restrictions VALUES (?,?) ON CONFLICT(actor) DO UPDATE SET restricted=excluded.restricted",
            (target, int(restricted)),
        )
        self.db.execute(
            "INSERT INTO moderation VALUES (?,?,?,?,?,?)",
            (uuid4().hex, moderator, target, "restrict" if restricted else "restore", reason, utc(now).timestamp()),
        )
