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
