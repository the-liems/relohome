from uuid import uuid4

from relohome_roommate.access import RoommateContext, RoommateError
from relohome_roommate.connections import ContactConsent, ContactRef, IntroSnapshot, RequestRecord
from relohome_roommate.eligibility import eligible
from relohome_roommate.models import RoommateProfile, RoommateSearchCriteria
from relohome_roommate.policy import REQUEST_TTL, RequestState
from relohome_roommate.ports import Actor
from relohome_roommate.services.access import AccessService
from relohome_roommate.services.lifecycle import reconcile_profiles
from relohome_roommate.services.limits import current_contact, fingerprint, operation_key
from relohome_roommate.services.profiles import validate_complete


class RequestService:
    def __init__(self, context: RoommateContext):
        self.ctx = context
        self.access = AccessService(context)

    def send(
        self, actor: Actor, recipient: str, intro: RoommateProfile, contact: ContactRef, consent: bool, key: str
    ) -> dict:
        operation_key(key)
        signature = fingerprint(
            "send",
            {
                "recipient": recipient,
                "intro": intro.model_dump(mode="json"),
                "contact": contact.model_dump(),
                "consent": consent,
            },
        )
        with self.ctx.transaction():
            self.access.require(actor)
            cached = self.ctx.connections.operation(actor.id, key, signature)
            if cached:
                return cached
            now = self.ctx.clock.now()
            reconcile_profiles(self.ctx)
            self.ctx.connections.expire(now)
            if (
                actor.id == recipient
                or self.ctx.safety.blocked(actor.id, recipient)
                or self.ctx.safety.restricted(recipient)
            ):
                raise RoommateError("profile_unavailable", status=404)
            existing = self.ctx.connections.pair(actor.id, recipient, now)
            if existing:
                result = {
                    "request_id": existing.id,
                    "existing": True,
                    "direction": "sent" if existing.sender_id == actor.id else "received",
                }
            else:
                if consent is not True:
                    raise RoommateError("consent_required", status=422)
                validate_complete(intro)
                self.ctx.catalog.validate_profile(intro)
                current_contact(self.ctx, actor.id, contact)
                target = self.ctx.profiles.get(recipient)
                if target is None:
                    raise RoommateError("profile_unavailable", status=404)
                self.access.require(Actor(id=recipient))
                criteria = RoommateSearchCriteria(
                    city=intro.facts.city, self_facts=intro.facts, preferences=intro.preferences
                )
                match = eligible(actor.id, criteria, target, now)
                if not match.passed:
                    raise RoommateError("criteria_no_longer_match", reasons=match.reasons)
                self.ctx.profiles.save_intro(actor.id, intro)
                snapshot = IntroSnapshot(
                    display_name=intro.display_name, introduction=intro.introduction, facts=intro.facts, reviewed_at=now
                )
                request = RequestRecord(
                    id=uuid4().hex,
                    sender_id=actor.id,
                    recipient_id=recipient,
                    created_at=now,
                    expires_at=now + REQUEST_TTL,
                    intro=snapshot,
                    consent=ContactConsent(
                        actor_id=actor.id, recipient_id=recipient, contact=contact, confirmed=True, confirmed_at=now
                    ),
                )
                request = self.ctx.connections.create(request, now)
                result = {"request_id": request.id, "existing": False, "direction": "sent"}
            self.ctx.connections.finish_operation(actor.id, key, signature, result)
            return result

    def close(self, actor: Actor, identifier: str, action: str, key: str) -> dict:
        operation_key(key)
        signature = fingerprint(action, {"request_id": identifier})
        with self.ctx.transaction():
            self.access.require(actor)
            cached = self.ctx.connections.operation(actor.id, key, signature)
            if cached:
                return cached
            self.ctx.connections.expire(self.ctx.clock.now())
            record = self.ctx.connections.get(identifier)
            allowed = record and (
                (action == "withdraw" and actor.id == record.sender_id)
                or (action == "reject" and actor.id == record.recipient_id)
            )
            if not allowed:
                raise RoommateError("action_not_allowed", status=403)
            if record.state is not RequestState.PENDING:
                raise RoommateError("request_not_pending")
            state = RequestState.WITHDRAWN if action == "withdraw" else RequestState.REJECTED
            self.ctx.connections.close(record, state, self.ctx.clock.now())
            result = {"request_id": identifier, "state": state.value}
            self.ctx.connections.finish_operation(actor.id, key, signature, result)
            return result

    def operation(self, actor: Actor, key: str) -> dict:
        self.access.require_operation_owner(actor)
        result = self.ctx.connections.operation(actor.id, key)
        return {"status": "completed", "result": result} if result else {"status": "not_found"}
