from src.roommate.access import RoommateContext, RoommateError
from src.roommate.policy import ProfileState
from src.roommate.ports import Actor
from src.roommate.services.access import AccessService
from src.roommate.services.lifecycle import purge_connections, redact_intros
from src.roommate.services.limits import fingerprint, operation_key


class ModerationService:
    def __init__(self, context: RoommateContext):
        self.ctx = context
        self.access = AccessService(context)

    def reports(self, actor: Actor) -> list[dict]:
        with self.ctx.transaction():
            self.access.require_moderator(actor)
            return self.ctx.safety.reports()

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
            self.ctx.safety.resolve_report(identifier)
            return {"report_id": identifier, "status": "reviewed"}
