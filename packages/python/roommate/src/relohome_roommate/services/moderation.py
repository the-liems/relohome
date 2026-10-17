from relohome_roommate.access import RoommateContext, RoommateError
from relohome_roommate.policy import ProfileState
from relohome_roommate.ports import Actor
from relohome_roommate.services.access import AccessService
from relohome_roommate.services.lifecycle import purge_connections, redact_intros
from relohome_roommate.services.limits import fingerprint, operation_key


class ModerationService:
    def __init__(self, context: RoommateContext):
        self.ctx = context
        self.access = AccessService(context)

    def reports(self, actor: Actor) -> list[dict]:
        with self.ctx.read_transaction():
            self.access.require_moderator(actor)
            return self.ctx.safety.reports()

    def queue(self, actor: Actor, kind: str, *, status: str | None = None, offset: int = 0, limit: int = 20, **filters):
        if kind not in ("reports", "media", "profiles") or offset < 0 or not 1 <= limit <= 50:
            raise RoommateError("invalid_pagination", status=422)
        with self.ctx.read_transaction():
            self.access.require_moderator(actor)
            if kind == "profiles":
                from relohome_roommate.services.moderation_queries import profile_page

                return profile_page(self.ctx, status=status, offset=offset, limit=limit, **filters)
            db = self.ctx.storage.connection
            where, params = ("WHERE status=?", [status]) if status else ("", [])
            columns = "id AS media_id,owner,status,mime,created" if kind == "media" else "*"
            rows = db.execute(
                f"SELECT {columns} FROM {kind} {where} ORDER BY created,id LIMIT ? OFFSET ?", (*params, limit, offset)
            ).fetchall()
            total = db.execute(f"SELECT COUNT(*) FROM {kind} {where}", params).fetchone()[0]
            items = [dict(row) for row in rows]
            if kind == "reports" and items:
                from relohome_roommate.ports import ProfileRecord

                targets = sorted({item["target"] for item in items})
                profiles = {}
                for row in db.execute(
                    "SELECT content FROM profiles WHERE owner IN (" + ",".join("?" for _ in targets) + ")", targets
                ):
                    profile = ProfileRecord.model_validate_json(row[0])
                    if profile.state not in (ProfileState.DRAFT, ProfileState.DELETED):
                        profiles[profile.owner_id] = profile.content.display_name
                for item in items:
                    item["target_name"] = profiles.get(item["target"])
            return {"items": items, "total": total, "offset": offset, "limit": limit}

    def summary(self, actor: Actor):
        with self.ctx.read_transaction():
            self.access.require_moderator(actor)
            db = self.ctx.storage.connection
            now = self.ctx.clock.now().timestamp()
            return {
                "active_profiles": db.execute(
                    "SELECT COUNT(*) FROM profiles WHERE state='active' AND expires>?", (now,)
                ).fetchone()[0],
                "pending_reports": db.execute("SELECT COUNT(*) FROM reports WHERE status='open'").fetchone()[0],
                "pending_media": 0,  # Compatibility only; image upload/review is retired.
                "restricted_profiles": db.execute("SELECT COUNT(*) FROM profiles WHERE state='restricted'").fetchone()[
                    0
                ],
                "pending_requests": db.execute(
                    "SELECT COUNT(*) FROM requests WHERE state='pending' AND expires>?", (now,)
                ).fetchone()[0],
            }

    def detail(self, actor: Actor, identifier: str):
        from relohome_roommate.services.moderation_queries import profile_view

        with self.ctx.read_transaction():
            self.access.require_moderator(actor)
            record = self.ctx.profiles.get(identifier)
            if not record or record.state in (ProfileState.DELETED, ProfileState.DRAFT):
                raise RoommateError("profile_unavailable", status=404)
            return {"profile": profile_view(self.ctx, record), "restricted": self.ctx.safety.restricted(identifier)}

    def history(self, actor: Actor, identifier: str, *, offset=0, limit=20):
        if offset < 0 or not 1 <= limit <= 50:
            raise RoommateError("invalid_pagination", status=422)
        with self.ctx.read_transaction():
            self.access.require_moderator(actor)
            record = self.ctx.profiles.get(identifier)
            if not record or record.state in (ProfileState.DELETED, ProfileState.DRAFT):
                raise RoommateError("profile_unavailable", status=404)
            db = self.ctx.storage.connection
            total = db.execute("SELECT COUNT(*) FROM moderation WHERE target=?", (identifier,)).fetchone()[0]
            rows = db.execute(
                "SELECT id,actor,action,reason,created FROM moderation WHERE target=? ORDER BY created DESC,id DESC LIMIT ? OFFSET ?",
                (identifier, limit, offset),
            )
            return {"items": [dict(row) for row in rows], "total": total, "offset": offset, "limit": limit}

    def restrict(
        self, actor: Actor, target: str, selected: bool, reason: str, key: str, *, expected_version: int | None = None
    ) -> dict:
        operation_key(key)
        if not 1 <= len(reason.strip()) <= 1000:
            raise RoommateError("moderation_reason_required", status=422)
        payload = {"target": target, "selected": selected, "reason": reason}
        if expected_version is not None:
            payload["expected_version"] = expected_version
        signature = fingerprint("moderate", payload)
        with self.ctx.transaction():
            self.access.require_moderator(actor)
            cached = self.ctx.connections.operation(actor.id, key, signature)
            if cached:
                return cached
            record = self.ctx.profiles.get(target)
            if expected_version is not None and (not record or record.version != expected_version):
                from relohome_roommate.profile_repository import VersionConflictError

                raise VersionConflictError("Profile version changed")
            self.ctx.safety.moderate(actor.id, target, selected, reason, self.ctx.clock.now())
            if selected:
                purge_connections(self.ctx, target, revoke=True)
                redact_intros(self.ctx, target)
            if record and record.state is not ProfileState.DELETED:
                state = ProfileState.RESTRICTED if selected else ProfileState.PAUSED
                self.ctx.profiles.save(
                    record.model_copy(update={"state": state, "version": record.version + 1}), record.version
                )
            result = {"profile_id": target, "restricted": selected}
            self.ctx.connections.finish_operation(actor.id, key, signature, result)
            return result

    def resolve_report(self, actor: Actor, identifier: str) -> dict:
        with self.ctx.transaction():
            self.access.require_moderator(actor)
            self.ctx.safety.resolve_report(identifier, actor.id, self.ctx.clock.now())
            return {"report_id": identifier, "status": "reviewed"}
