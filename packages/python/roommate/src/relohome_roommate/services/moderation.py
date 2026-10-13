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

    def queue(self, actor: Actor, kind: str, *, status: str | None = None, offset: int = 0, limit: int = 20):
        if kind not in ("reports", "media", "profiles") or offset < 0 or not 1 <= limit <= 50:
            raise RoommateError("invalid_pagination", status=422)
        with self.ctx.read_transaction():
            self.access.require_moderator(actor)
            db = self.ctx.storage.connection
            state_column = "state" if kind == "profiles" else "status"
            where, params = (f"WHERE {state_column}=?", [status]) if status else ("", [])
            order = "owner" if kind == "profiles" else "created,id"
            columns = (
                "content"
                if kind == "profiles"
                else "id AS media_id,owner,status,mime,created"
                if kind == "media"
                else "*"
            )
            rows = db.execute(
                f"SELECT {columns} FROM {kind} {where} ORDER BY {order} LIMIT ? OFFSET ?", (*params, limit, offset)
            ).fetchall()
            total = db.execute(f"SELECT COUNT(*) FROM {kind} {where}", params).fetchone()[0]
            if kind == "profiles":
                from relohome_roommate.ports import ProfileRecord

                items = []
                for row in rows:
                    p = ProfileRecord.model_validate_json(row[0])
                    items.append(
                        {
                            "profile_id": p.owner_id,
                            "state": p.state.value,
                            "version": p.version,
                            "display_name": p.content.display_name,
                            "introduction": p.content.introduction,
                            "facts": p.content.facts.model_dump(mode="json"),
                            "avatar_id": p.avatar_id,
                        }
                    )
            else:
                items = [dict(row) for row in rows]
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
                "pending_media": db.execute("SELECT COUNT(*) FROM media WHERE status='pending'").fetchone()[0],
                "pending_requests": db.execute(
                    "SELECT COUNT(*) FROM requests WHERE state='pending' AND expires>?", (now,)
                ).fetchone()[0],
            }

    def restrict(self, actor: Actor, target: str, selected: bool, reason: str, key: str) -> dict:
        operation_key(key)
        if not 1 <= len(reason.strip()) <= 1000:
            raise RoommateError("moderation_reason_required", status=422)
        signature = fingerprint("moderate", {"target": target, "selected": selected, "reason": reason})
        with self.ctx.transaction():
            self.access.require_moderator(actor)
            cached = self.ctx.connections.operation(actor.id, key, signature)
            if cached:
                return cached
            self.ctx.safety.moderate(actor.id, target, selected, reason, self.ctx.clock.now())
            record = self.ctx.profiles.get(target)
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
