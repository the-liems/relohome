from relohome_roommate.access import RoommateContext, RoommateError
from relohome_roommate.policy import GrantState, RequestState
from relohome_roommate.ports import Actor
from relohome_roommate.services.access import AccessService
from relohome_roommate.services.consent import revoke_grant
from relohome_roommate.services.limits import fingerprint, operation_key


class SafetyService:
    def __init__(self, context: RoommateContext):
        self.ctx = context
        self.access = AccessService(context)

    def block(self, actor: Actor, target: str, selected: bool, key: str) -> dict:
        operation_key(key)
        signature = fingerprint("block", {"target": target, "selected": selected})
        with self.ctx.transaction():
            self.access.require(actor)
            cached = self.ctx.connections.operation(actor.id, key, signature)
            if cached:
                return cached
            if actor.id == target:
                raise RoommateError("invalid_target", status=422)
            self.ctx.safety.block(actor.id, target, selected)
            if selected:
                from relohome_roommate.chat_repository import close_chats

                close_chats(self.ctx, actor.id, target)
                for request in self.ctx.connections.for_actor(actor.id):
                    if target not in (request.sender_id, request.recipient_id):
                        continue
                    if request.state is RequestState.PENDING:
                        self.ctx.connections.close(request, RequestState.CANCELLED, self.ctx.clock.now())
                    grant = self.ctx.connections.grant(request.id)
                    if grant and grant.effective_state(self.ctx.clock.now()) is GrantState.ACTIVE:
                        revoke_grant(self.ctx, grant, actor.id)
            result = {"blocked": selected, "profile_id": target}
            self.ctx.connections.finish_operation(actor.id, key, signature, result)
            return result

    def report(self, actor: Actor, target: str, reason: str, key: str) -> dict:
        operation_key(key)
        if not 1 <= len(reason.strip()) <= 1000 or actor.id == target:
            raise RoommateError("invalid_report", status=422)
        signature = fingerprint("report", {"target": target, "reason": reason})
        with self.ctx.transaction():
            self.access.require(actor)
            cached = self.ctx.connections.operation(actor.id, key, signature)
            if cached:
                return cached
            identifier = self.ctx.safety.report(actor.id, target, reason, self.ctx.clock.now())
            result = {"report_id": identifier, "status": "received"}
            self.ctx.connections.finish_operation(actor.id, key, signature, result)
            return result
