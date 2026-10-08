from datetime import timedelta

from src.roommate.access import RoommateContext, RoommateError
from src.roommate.maintenance import reconcile
from src.roommate.policy import GrantState, ProfileState, RequestState
from src.roommate.ports import Actor
from src.roommate.services.access import AccessService


class InboxService:
    def __init__(self, context: RoommateContext):
        self.ctx = context
        self.access = AccessService(context)

    def _readable(self, request) -> bool:
        if self.ctx.safety.blocked(request.sender_id, request.recipient_id):
            return False
        for participant in (request.sender_id, request.recipient_id):
            if self.ctx.safety.restricted(participant):
                return False
            record = self.ctx.profiles.get(participant)
            if record and record.state in (ProfileState.DELETED, ProfileState.RESTRICTED):
                return False
        return True

    def _summary(self, actor: Actor, record) -> dict:
        grant = self.ctx.connections.grant(record.id)
        return {
            "request_id": record.id,
            "direction": "sent" if actor.id == record.sender_id else "received",
            "state": record.effective_state(self.ctx.clock.now()).value,
            "expires_at": record.expires_at.isoformat(),
            "created_at": record.created_at.isoformat(),
            "grant_state": grant.effective_state(self.ctx.clock.now()).value if grant else None,
            "grant_expires_at": grant.expires_at.isoformat() if grant else None,
            "available": self._readable(record),
        }

    def list(self, actor: Actor) -> dict:
        with self.ctx.transaction():
            self.access.require(actor)
            reconcile(self.ctx)
            records = self.ctx.connections.for_actor(actor.id)
            items = [self._summary(actor, record) for record in records]
            own = self.ctx.profiles.get(actor.id)
            reminder = None
            if (
                own
                and own.state is ProfileState.ACTIVE
                and own.expires_at
                and own.expires_at - self.ctx.clock.now() <= timedelta(days=3)
            ):
                reminder = {"expires_at": own.expires_at.isoformat(), "requires_reconfirmation": True}
            return {
                "items": items,
                "received_pending": sum(
                    item["direction"] == "received" and item["state"] == "pending" and item["available"]
                    for item in items
                ),
                "profile_reminder": reminder,
            }

    def detail(self, actor: Actor, identifier: str) -> dict:
        with self.ctx.transaction():
            self.access.require(actor)
            reconcile(self.ctx)
            record = self.ctx.connections.get(identifier)
            if record is None or actor.id not in (record.sender_id, record.recipient_id):
                raise RoommateError("request_unavailable", status=404)
            result = self._summary(actor, record)
            if not result["available"]:
                return result
            result["intro"] = record.intro.model_dump(mode="json")
            if record.state is RequestState.PENDING:
                result["actions"] = ["withdraw"] if actor.id == record.sender_id else ["accept", "reject"]
            else:
                result["actions"] = ["revoke"] if result["grant_state"] == GrantState.ACTIVE.value else []
            return result
