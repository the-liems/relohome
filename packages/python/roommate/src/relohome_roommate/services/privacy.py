"""Owner-only export and explicit erasure; quota, bans and audit remain intact."""

from relohome_roommate.access import RoommateError
from relohome_roommate.models import RoommateProfile
from relohome_roommate.policy import ProfileState
from relohome_roommate.profile_repository import VersionConflictError
from relohome_roommate.services.lifecycle import purge_connections, redact_intros


class PrivacyService:
    def __init__(self, context):
        self.ctx = context

    def status(self, actor):
        with self.ctx.read_transaction():
            record = self.ctx.profiles.get(actor.id)
            return {"version": record.version if record else None}

    def export(self, actor):
        with self.ctx.read_transaction():
            record = self.ctx.profiles.get(actor.id)
            intro = self.ctx.profiles.intro(actor.id)
            criteria = self.ctx.profiles.criteria(actor.id)
            # No received introductions or another participant's contact is exported.
            return {
                "exported_at": self.ctx.clock.now().isoformat(),
                "profile": record.model_dump(mode="json") if record else None,
                "introduction": intro.model_dump(mode="json") if intro else None,
                "criteria": criteria.model_dump(mode="json") if criteria else None,
                "bookmarks": self.ctx.profiles.bookmarks(actor.id),
                **self._message_page(actor),
                "contacts": [
                    {
                        "kind": row["kind"],
                        "value": self.ctx.vault.open(bytes(row["ciphertext"])) if row["ciphertext"] else None,
                    }
                    for row in self.ctx.storage.connection.execute(
                        "SELECT kind,ciphertext FROM contacts WHERE owner=?", (actor.id,)
                    )
                ],
            }

    def _message_page(self, actor, before=None, limit=250):
        if not 1 <= limit <= 500:
            raise RoommateError("invalid_pagination", status=422)
        db = self.ctx.storage.connection
        where, parameters = "sender=?", [actor.id]
        if before:
            cursor = db.execute(
                "SELECT created FROM chat_messages WHERE sender=? AND id=?", (actor.id, before)
            ).fetchone()
            if not cursor:
                raise RoommateError("invalid_cursor", status=422)
            where += " AND (created<? OR (created=? AND id<?))"
            parameters.extend((cursor[0], cursor[0], before))
        rows = db.execute(
            f"SELECT * FROM chat_messages WHERE {where} ORDER BY created DESC,id DESC LIMIT ?", [*parameters, limit + 1]
        ).fetchall()
        return {
            "chat_messages": [
                {
                    "id": row["id"],
                    "conversation_id": row["conversation"],
                    "body": row["body"],
                    "created": row["created"],
                }
                for row in rows[:limit]
            ],
            "chat_messages_next": rows[limit - 1]["id"] if len(rows) > limit else None,
        }

    def export_messages(self, actor, *, before=None, limit=250):
        with self.ctx.read_transaction():
            return self._message_page(actor, before, limit)

    def erase(self, actor, confirmed: bool, version: int | None):
        if confirmed is not True:
            raise RoommateError("review_required", status=422)
        with self.ctx.transaction():
            record = self.ctx.profiles.get(actor.id)
            if (record and record.version != version) or (not record and version is not None):
                raise VersionConflictError("Profile version changed")
            purge_connections(self.ctx, actor.id, revoke=True)
            redact_intros(self.ctx, actor.id)
            if record:
                self.ctx.profiles.save(
                    record.model_copy(
                        update={
                            "content": RoommateProfile(),
                            "avatar_id": None,
                            "state": ProfileState.DELETED,
                            "version": record.version + 1,
                            "updated_at": self.ctx.clock.now(),
                        }
                    ),
                    record.version,
                )
            db = self.ctx.storage.connection
            db.execute("DELETE FROM chat_reads WHERE actor=?", (actor.id,))
            db.execute("DELETE FROM chat_messages WHERE sender=?", (actor.id,))
            for table, column in (
                ("intros", "owner"),
                ("criteria", "owner"),
                ("bookmarks", "owner"),
                ("media", "owner"),
                ("notifications", "actor"),
                ("operation_drafts", "actor"),
            ):
                db.execute(f"DELETE FROM {table} WHERE {column}=?", (actor.id,))
            db.execute("UPDATE contacts SET ciphertext=NULL,version=version+1 WHERE owner=?", (actor.id,))
        return {"erased": True, "scope": "roommate_private_content"}
