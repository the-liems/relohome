from __future__ import annotations

from relohome_roommate.access import RoommateError
from relohome_roommate.notifications import event_view
from relohome_roommate.services.access import AccessService


class NotificationService:
    def __init__(self, context):
        self.ctx = context

    def list(self, actor, offset: int = 0, limit: int = 20) -> dict:
        if offset < 0 or not 1 <= limit <= 50:
            raise RoommateError("invalid_pagination", status=422)
        with self.ctx.read_transaction():
            AccessService(self.ctx).require(actor)
            db = self.ctx.storage.connection
            rows = db.execute(
                "SELECT * FROM notifications WHERE actor=? ORDER BY created DESC,id LIMIT ? OFFSET ?",
                (actor.id, limit, offset),
            ).fetchall()
            counts = db.execute(
                "SELECT COUNT(*) AS total, SUM(CASE WHEN read_at IS NULL THEN 1 ELSE 0 END) AS unread "
                "FROM notifications WHERE actor=?",
                (actor.id,),
            ).fetchone()
            return {
                "items": [event_view(row) for row in rows],
                "total": counts["total"],
                "unread": counts["unread"] or 0,
                "offset": offset,
                "limit": limit,
            }

    def mark_read(self, actor, identifiers: list[str]) -> dict:
        if len(identifiers) > 50:
            raise RoommateError("invalid_input", status=422)
        with self.ctx.transaction():
            AccessService(self.ctx).require(actor)
            for identifier in set(identifiers):
                self.ctx.storage.connection.execute(
                    "UPDATE notifications SET read_at=? WHERE actor=? AND id=? AND read_at IS NULL",
                    (self.ctx.clock.now().timestamp(), actor.id, identifier),
                )
        return {"read": True}

    def read_request(self, actor, identifier: str) -> dict:
        with self.ctx.transaction():
            AccessService(self.ctx).require(actor)
            record = self.ctx.connections.get(identifier)
            if not record or actor.id not in (record.sender_id, record.recipient_id):
                raise RoommateError("request_unavailable", status=404)
            self.ctx.storage.connection.execute(
                "UPDATE notifications SET read_at=? WHERE actor=? AND resource=? AND read_at IS NULL",
                (self.ctx.clock.now().timestamp(), actor.id, identifier),
            )
        return {"read": True}
