from relohome_roommate.access import RoommateContext, RoommateError
from relohome_roommate.connections import ContactRef, GrantRecord
from relohome_roommate.policy import GRANT_TTL, REVOKE_COOLDOWN, GrantState, RequestState
from relohome_roommate.ports import Actor
from relohome_roommate.services.access import AccessService
from relohome_roommate.services.lifecycle import reconcile_profiles, request_failures
from relohome_roommate.services.limits import current_contact, fingerprint, operation_key


class ConsentService:
    def __init__(self, context: RoommateContext):
        self.ctx = context
        self.access = AccessService(context)

    def accept(self, actor: Actor, identifier: str, contact: ContactRef, confirmed: bool, key: str) -> dict:
        operation_key(key)
        signature = fingerprint(
            "accept", {"request_id": identifier, "contact": contact.model_dump(), "confirmed": confirmed}
        )
        with self.ctx.transaction():
            self.access.require(actor)
            cached = self.ctx.connections.operation(actor.id, key, signature)
            if cached:
                return cached
            if confirmed is not True:
                raise RoommateError("consent_required", status=422)
            now = self.ctx.clock.now()
            reconcile_profiles(self.ctx)
            self.ctx.connections.expire(now)
            request = self.ctx.connections.get(identifier)
            if request is None or request.recipient_id != actor.id:
                raise RoommateError("request_unavailable", status=404)
            if request.mode != "contact" or request.consent is None:
                raise RoommateError("request_unavailable", status=404)
            if request.state is not RequestState.PENDING:
                raise RoommateError("request_not_pending")
            self.access.require(Actor(id=request.sender_id))
            failures = request_failures(self.ctx, request)
            if failures:
                raise RoommateError("criteria_no_longer_match", reasons=failures)
            current_contact(self.ctx, request.sender_id, request.consent.contact)
            current_contact(self.ctx, actor.id, contact)
            grant = GrantRecord(
                request_id=identifier,
                sender_id=request.sender_id,
                recipient_id=actor.id,
                accepted_at=now,
                expires_at=now + GRANT_TTL,
                sender_contact=request.consent.contact,
                recipient_contact=contact,
            )
            self.ctx.connections.save(request.model_copy(update={"state": RequestState.ACCEPTED, "closed_at": now}))
            self.ctx.connections.save_grant(grant)
            result = {"request_id": identifier, "state": "accepted", "grant_expires_at": grant.expires_at.isoformat()}
            self.ctx.connections.finish_operation(actor.id, key, signature, result)
            return result

    def _authorized_grant(self, actor: Actor, identifier: str):
        self.access.require(actor)
        grant = self.ctx.connections.grant(identifier)
        if (
            grant is None
            or actor.id not in (grant.sender_id, grant.recipient_id)
            or grant.effective_state(self.ctx.clock.now()) is not GrantState.ACTIVE
        ):
            raise RoommateError("contact_unavailable", status=404)
        if self.ctx.safety.blocked(grant.sender_id, grant.recipient_id):
            raise RoommateError("contact_unavailable", status=404)
        for participant in (grant.sender_id, grant.recipient_id):
            self.access.require(Actor(id=participant))
            record = self.ctx.profiles.get(participant)
            if record and record.state.value in ("deleted", "restricted"):
                raise RoommateError("contact_unavailable", status=404)
        current_contact(self.ctx, grant.sender_id, grant.sender_contact)
        current_contact(self.ctx, grant.recipient_id, grant.recipient_contact)
        return grant

    def read(self, actor: Actor, identifier: str) -> dict:
        with self.ctx.read_transaction():
            grant = self._authorized_grant(actor, identifier)
            other = grant.recipient_id if actor.id == grant.sender_id else grant.sender_id
            reference = grant.recipient_contact if actor.id == grant.sender_id else grant.sender_contact
            row = current_contact(self.ctx, other, reference)
            if self.ctx.vault is None:
                raise RoommateError("contact_vault_unavailable", status=503)
            return {
                "request_id": identifier,
                "expires_at": grant.expires_at.isoformat(),
                "contact": {"kind": row["kind"], "value": self.ctx.vault.open(row["ciphertext"])},
            }

    def revoke(self, actor: Actor, identifier: str, key: str) -> dict:
        operation_key(key)
        signature = fingerprint("revoke", {"request_id": identifier})
        with self.ctx.transaction():
            self.access.require(actor)
            cached = self.ctx.connections.operation(actor.id, key, signature)
            if cached:
                return cached
            grant = self.ctx.connections.grant(identifier)
            if grant is None or actor.id not in (grant.sender_id, grant.recipient_id):
                raise RoommateError("request_unavailable", status=404)
            if grant.effective_state(self.ctx.clock.now()) is not GrantState.ACTIVE:
                raise RoommateError("contact_unavailable", status=404)
            revoke_grant(self.ctx, grant, actor.id)
            result = {"request_id": identifier, "grant_state": "revoked"}
            self.ctx.connections.finish_operation(actor.id, key, signature, result)
            return result


def revoke_grant(context: RoommateContext, grant: GrantRecord, revoker: str) -> None:
    context.connections.save_grant(grant.model_copy(update={"state": GrantState.REVOKED}))
    other = grant.recipient_id if revoker == grant.sender_id else grant.sender_id
    context.connections.set_cooldown(other, revoker, context.clock.now() + REVOKE_COOLDOWN)
