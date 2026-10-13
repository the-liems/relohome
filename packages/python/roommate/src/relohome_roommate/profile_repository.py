import sqlite3
from datetime import datetime

from relohome_roommate.clock import utc
from relohome_roommate.models import RoommateProfile, RoommateSearchCriteria
from relohome_roommate.policy import TERMS_VERSION
from relohome_roommate.ports import ProfileRecord
from relohome_roommate.storage import require_transaction


class VersionConflictError(ValueError):
    pass


class SqlProfiles:
    def __init__(self, connection: sqlite3.Connection):
        self.db = connection

    def get(self, owner_id: str) -> ProfileRecord | None:
        row = self.db.execute("SELECT content FROM profiles WHERE owner=?", (owner_id,)).fetchone()
        return ProfileRecord.model_validate_json(row[0]) if row else None

    def save(self, record: ProfileRecord, expected_version: int | None) -> None:
        require_transaction(self.db)
        current = self.get(record.owner_id)
        if (current is None and expected_version is not None) or (current and current.version != expected_version):
            raise VersionConflictError("Profile version changed")
        if record.version != (current.version + 1 if current else 1):
            raise VersionConflictError("Profile version must advance exactly once")
        self.db.execute(
            "INSERT INTO profiles VALUES (?,?,?,?,?,?) ON CONFLICT(owner) DO UPDATE SET version=excluded.version,state=excluded.state,city=excluded.city,expires=excluded.expires,content=excluded.content",
            (
                record.owner_id,
                record.version,
                record.state.value,
                record.content.facts.city,
                record.expires_at.timestamp() if record.expires_at else None,
                record.model_dump_json(),
            ),
        )

    def all(self) -> list[ProfileRecord]:
        return [
            ProfileRecord.model_validate_json(row[0])
            for row in self.db.execute("SELECT content FROM profiles ORDER BY owner")
        ]

    def active(self, city: str, now: datetime) -> list[ProfileRecord]:
        return [
            ProfileRecord.model_validate_json(row[0])
            for row in self.db.execute(
                "SELECT content FROM profiles WHERE state='active' AND city=? AND expires>? ORDER BY owner",
                (city, utc(now).timestamp()),
            )
        ]

    def expired(self, now: datetime) -> list[ProfileRecord]:
        return [
            ProfileRecord.model_validate_json(row[0])
            for row in self.db.execute(
                "SELECT content FROM profiles WHERE state='active' AND expires<=? ORDER BY owner",
                (utc(now).timestamp(),),
            )
        ]

    def active_rooms(self, identifiers: set[str], now: datetime) -> list[ProfileRecord]:
        if not identifiers:
            return []
        placeholders = ",".join("?" for _ in identifiers)
        return [
            ProfileRecord.model_validate_json(row[0])
            for row in self.db.execute(
                "SELECT p.content FROM profiles p JOIN access a ON a.actor=p.owner "
                "WHERE p.state='active' AND p.expires>? AND a.adult=1 AND a.terms=? "
                f"AND json_extract(p.content,'$.content.room.listing_id') IN ({placeholders}) ORDER BY p.owner",
                (utc(now).timestamp(), TERMS_VERSION, *sorted(identifiers)),
            )
        ]

    def access(self, owner: str) -> dict | None:
        row = self.db.execute("SELECT adult,terms,accepted FROM access WHERE actor=?", (owner,)).fetchone()
        return dict(row) if row else None

    def set_access(self, owner: str, adult: bool, terms: str, now: datetime) -> None:
        require_transaction(self.db)
        self.db.execute(
            "INSERT INTO access VALUES (?,?,?,?) ON CONFLICT(actor) DO UPDATE SET adult=excluded.adult,terms=excluded.terms,accepted=excluded.accepted",
            (owner, int(adult), terms, utc(now).timestamp()),
        )

    def intro(self, owner: str) -> RoommateProfile | None:
        row = self.db.execute("SELECT content FROM intros WHERE owner=?", (owner,)).fetchone()
        return RoommateProfile.model_validate_json(row[0]) if row else None

    def save_intro(self, owner: str, content: RoommateProfile) -> None:
        require_transaction(self.db)
        self.db.execute(
            "INSERT INTO intros VALUES (?,?) ON CONFLICT(owner) DO UPDATE SET content=excluded.content",
            (owner, content.model_dump_json()),
        )

    def criteria(self, owner: str) -> RoommateSearchCriteria | None:
        row = self.db.execute("SELECT content FROM criteria WHERE owner=?", (owner,)).fetchone()
        return RoommateSearchCriteria.model_validate_json(row[0]) if row else None

    def save_criteria(self, owner: str, content: RoommateSearchCriteria) -> None:
        require_transaction(self.db)
        self.db.execute(
            "INSERT INTO criteria VALUES (?,?) ON CONFLICT(owner) DO UPDATE SET content=excluded.content",
            (owner, content.model_dump_json()),
        )

    def bookmarks(self, owner: str) -> list[str]:
        return [
            row[0] for row in self.db.execute("SELECT target FROM bookmarks WHERE owner=? ORDER BY target", (owner,))
        ]

    def bookmark(self, owner: str, target: str, selected: bool) -> None:
        require_transaction(self.db)
        if selected:
            self.db.execute("INSERT OR IGNORE INTO bookmarks VALUES (?,?)", (owner, target))
        else:
            self.db.execute("DELETE FROM bookmarks WHERE owner=? AND target=?", (owner, target))
