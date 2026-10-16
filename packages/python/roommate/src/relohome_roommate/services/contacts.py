import re
from uuid import uuid4

from relohome_roommate.access import RoommateContext, RoommateError
from relohome_roommate.policy import ContactKind, GrantState, RequestState
from relohome_roommate.ports import Actor
from relohome_roommate.services.access import AccessService
from relohome_roommate.services.consent import revoke_grant
from relohome_roommate.services.limits import fingerprint, operation_key


def normalized_contact(kind: ContactKind, value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    if kind is ContactKind.PHONE:
        value = re.sub(r"[\s().-]", "", value)
        if not re.fullmatch(r"\+?[0-9]{8,15}", value):
            raise RoommateError("invalid_contact", status=422)
    elif not re.fullmatch(r"(?:https://)?zalo\.me/[A-Za-z0-9_.-]{1,80}|\+?[0-9]{8,15}", value):
        raise RoommateError("invalid_contact", status=422)
    return value


class ContactService:
    def __init__(self, context: RoommateContext):
        self.ctx = context
        self.access = AccessService(context)

    def own(self, actor: Actor) -> list[dict]:
        with self.ctx.read_transaction():
            self.access.require(actor)
            if self.ctx.vault is None:
                raise RoommateError("contact_vault_unavailable", status=503)
            return [
                {
                    "channel_id": row["id"],
                    "kind": row["kind"],
                    "version": row["version"],
                    "value": self.ctx.vault.open(row["ciphertext"]) if row["ciphertext"] else None,
                }
                for row in self.ctx.storage.connection.execute(
                    "SELECT * FROM contacts WHERE owner=? ORDER BY kind", (actor.id,)
                )
            ]

    def save(self, actor: Actor, kind: ContactKind, value: str | None, expected_version: int | None, key: str) -> dict:
        operation_key(key)
        kind = ContactKind(kind)
        value = normalized_contact(kind, value)
        signature = fingerprint("contact", {"kind": kind.value, "value": value, "version": expected_version})
        with self.ctx.transaction():
            self.access.require(actor)
            cached = self.ctx.connections.operation(actor.id, key, signature)
            if cached:
                return cached
            if self.ctx.vault is None:
                raise RoommateError("contact_vault_unavailable", status=503)
            row = self.ctx.storage.connection.execute(
                "SELECT * FROM contacts WHERE owner=? AND kind=?", (actor.id, kind.value)
            ).fetchone()
            if (row and row["version"] != expected_version) or (not row and expected_version is not None):
                raise RoommateError("contact_version_conflict")
            identifier = row["id"] if row else uuid4().hex
            version = row["version"] + 1 if row else 1
            # A channel update is an explicit new version, even if the entered value is unchanged.
            for request in self.ctx.connections.for_actor(actor.id):
                if (
                    request.state is RequestState.PENDING
                    and request.sender_id == actor.id
                    and request.consent is not None
                    and request.consent.contact.channel_id == identifier
                ):
                    self.ctx.connections.close(request, RequestState.CANCELLED, self.ctx.clock.now())
                grant = self.ctx.connections.grant(request.id)
                if grant and grant.effective_state(self.ctx.clock.now()) is GrantState.ACTIVE:
                    reference = grant.sender_contact if grant.sender_id == actor.id else grant.recipient_contact
                    if reference.channel_id == identifier:
                        revoke_grant(self.ctx, grant, actor.id)
            self.ctx.storage.connection.execute(
                "INSERT INTO contacts VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,ciphertext=excluded.ciphertext",
                (identifier, actor.id, kind.value, version, self.ctx.vault.seal(value) if value else None),
            )
            result = {"channel_id": identifier, "kind": kind.value, "version": version, "configured": value is not None}
            self.ctx.connections.finish_operation(actor.id, key, signature, result)
            return result
