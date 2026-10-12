import json
import sqlite3
from datetime import UTC, datetime

from relohome_roommate.clock import utc
from relohome_roommate.connections import GrantRecord, RequestRecord
from relohome_roommate.policy import (
    EXPIRED_COOLDOWN,
    MAX_PENDING,
    MAX_REQUESTS_PER_WINDOW,
    REJECT_COOLDOWN,
    REQUEST_WINDOW,
    WITHDRAW_COOLDOWN,
    GrantState,
    RequestState,
)
from relohome_roommate.storage import require_transaction


class RepositoryPolicyError(ValueError):
    def __init__(self, code: str, until: datetime | None = None):
        super().__init__(code)
        self.code = code
        self.until = until


class SqlConnections:
    def __init__(self, connection: sqlite3.Connection):
        self.db = connection

    def get(self, request_id: str) -> RequestRecord | None:
        row = self.db.execute("SELECT content FROM requests WHERE id=?", (request_id,)).fetchone()
        return RequestRecord.model_validate_json(row[0]) if row else None

    def save(self, record: RequestRecord) -> None:
        require_transaction(self.db)
        self.db.execute(
            "INSERT INTO requests VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,content=excluded.content",
            (
                record.id,
                record.sender_id,
                record.recipient_id,
                record.state.value,
                record.created_at.timestamp(),
                record.expires_at.timestamp(),
                record.model_dump_json(),
            ),
        )

    def for_actor(self, actor: str) -> list[RequestRecord]:
        return [
            RequestRecord.model_validate_json(row[0])
            for row in self.db.execute(
                "SELECT content FROM requests WHERE sender=? OR recipient=? ORDER BY created DESC,id", (actor, actor)
            )
        ]

    def pair(self, first: str, second: str, now: datetime) -> RequestRecord | None:
        row = self.db.execute(
            "SELECT request FROM pairs WHERE first=? AND second=? AND expires>?",
            (*sorted((first, second)), utc(now).timestamp()),
        ).fetchone()
        return self.get(row[0]) if row else None

    def cooldown(self, sender: str, recipient: str) -> datetime | None:
        row = self.db.execute(
            "SELECT until FROM cooldowns WHERE sender=? AND recipient=?", (sender, recipient)
        ).fetchone()
        return datetime.fromtimestamp(row[0], UTC) if row else None

    def set_cooldown(self, sender: str, recipient: str, until: datetime) -> None:
        require_transaction(self.db)
        self.db.execute(
            "INSERT INTO cooldowns VALUES (?,?,?) ON CONFLICT(sender,recipient) DO UPDATE SET until=MAX(until,excluded.until)",
            (sender, recipient, utc(until).timestamp()),
        )

    def counts(self, sender: str, now: datetime) -> tuple[int, int]:
        recent = self.db.execute(
            "SELECT COUNT(*) FROM requests WHERE sender=? AND created>?",
            (sender, (utc(now) - REQUEST_WINDOW).timestamp()),
        ).fetchone()[0]
        pending = self.db.execute(
            "SELECT COUNT(*) FROM requests WHERE sender=? AND state='pending' AND expires>?",
            (sender, utc(now).timestamp()),
        ).fetchone()[0]
        return recent, pending

    def create(self, record: RequestRecord, now: datetime) -> RequestRecord:
        require_transaction(self.db)
        self.expire(now)
        existing = self.pair(record.sender_id, record.recipient_id, now)
        if existing:
            return existing
        deadline = self.cooldown(record.sender_id, record.recipient_id)
        if deadline and utc(now) < deadline:
            raise RepositoryPolicyError("cooldown", deadline)
        recent, pending = self.counts(record.sender_id, now)
        if recent >= MAX_REQUESTS_PER_WINDOW:
            raise RepositoryPolicyError("daily_limit")
        if pending >= MAX_PENDING:
            raise RepositoryPolicyError("pending_limit")
        self.save(record)
        self.db.execute(
            "INSERT INTO pairs VALUES (?,?,?,?)",
            (*sorted((record.sender_id, record.recipient_id)), record.id, record.expires_at.timestamp()),
        )
        return record

    def close(self, record: RequestRecord, state: RequestState | str, now: datetime) -> None:
        require_transaction(self.db)
        state = RequestState(state)
        if state in (RequestState.PENDING, RequestState.ACCEPTED):
            raise ValueError("Use consent service for acceptance")
        self.save(record.model_copy(update={"state": state, "closed_at": utc(now)}))
        self.db.execute("DELETE FROM pairs WHERE request=?", (record.id,))
        delay = {
            RequestState.REJECTED: REJECT_COOLDOWN,
            RequestState.WITHDRAWN: WITHDRAW_COOLDOWN,
            RequestState.EXPIRED: EXPIRED_COOLDOWN,
        }.get(state)
        if delay:
            self.set_cooldown(record.sender_id, record.recipient_id, utc(now) + delay)

    def grant(self, request_id: str) -> GrantRecord | None:
        row = self.db.execute("SELECT content FROM grants WHERE request=?", (request_id,)).fetchone()
        return GrantRecord.model_validate_json(row[0]) if row else None

    def save_grant(self, grant: GrantRecord) -> None:
        require_transaction(self.db)
        self.db.execute(
            "INSERT INTO grants VALUES (?,?,?,?) ON CONFLICT(request) DO UPDATE SET state=excluded.state,content=excluded.content",
            (grant.request_id, grant.expires_at.timestamp(), grant.state.value, grant.model_dump_json()),
        )
        if grant.state is GrantState.ACTIVE:
            self.db.execute(
                "UPDATE pairs SET expires=? WHERE request=?", (grant.expires_at.timestamp(), grant.request_id)
            )
        else:
            self.db.execute("DELETE FROM pairs WHERE request=?", (grant.request_id,))

    def expire(self, now: datetime) -> None:
        require_transaction(self.db)
        for row in self.db.execute(
            "SELECT content FROM requests WHERE state='pending' AND expires<=?", (utc(now).timestamp(),)
        ).fetchall():
            record = RequestRecord.model_validate_json(row[0])
            self.close(record, RequestState.EXPIRED, record.expires_at)
        for row in self.db.execute(
            "SELECT content FROM grants WHERE state='active' AND expires<=?", (utc(now).timestamp(),)
        ).fetchall():
            self.save_grant(GrantRecord.model_validate_json(row[0]).model_copy(update={"state": GrantState.EXPIRED}))
        self.db.execute("DELETE FROM pairs WHERE expires<=?", (utc(now).timestamp(),))

    def operation(self, actor: str, key: str, fingerprint: str | None = None) -> dict | None:
        row = self.db.execute(
            "SELECT fingerprint,result FROM operations WHERE actor=? AND key=?", (actor, key)
        ).fetchone()
        if row and fingerprint is not None and row[0] != fingerprint:
            raise RepositoryPolicyError("operation_conflict")
        return json.loads(row[1]) if row else None

    def finish_operation(self, actor: str, key: str, fingerprint: str, result: dict) -> None:
        require_transaction(self.db)
        self.db.execute("INSERT INTO operations VALUES (?,?,?,?)", (actor, key, fingerprint, json.dumps(result)))
