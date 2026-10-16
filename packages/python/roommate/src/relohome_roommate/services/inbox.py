from datetime import timedelta

from relohome_roommate.access import RoommateContext, RoommateError
from relohome_roommate.connections import GrantRecord
from relohome_roommate.maintenance import reconcile_if_due
from relohome_roommate.policy import GrantState, ProfileState, RequestState
from relohome_roommate.ports import Actor, ProfileRecord
from relohome_roommate.services.access import AccessService


class InboxService:
    def __init__(self, context: RoommateContext):
        self.ctx = context
        self.access = AccessService(context)

    def _readable(self, request) -> bool:
        if request.mode == "chat":
            chat = self.ctx.storage.connection.execute(
                "SELECT revoked FROM chat_conversations WHERE request=?", (request.id,)
            ).fetchone()
            if chat and chat[0]:
                return False
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
        chat = (
            self.ctx.storage.connection.execute(
                "SELECT id,state FROM chat_conversations WHERE request=?", (record.id,)
            ).fetchone()
            if record.mode == "chat"
            else None
        )
        return {
            **(
                {
                    "mode": "chat",
                    "conversation_id": chat[0] if chat else None,
                    "conversation_state": chat[1] if chat else None,
                    "counterparty_id": (record.recipient_id if actor.id == record.sender_id else record.sender_id)
                    if self._readable(record)
                    else None,
                }
                if record.mode == "chat"
                else {}
            ),
            "request_id": record.id,
            "direction": "sent" if actor.id == record.sender_id else "received",
            "state": record.effective_state(self.ctx.clock.now()).value,
            "expires_at": record.expires_at.isoformat(),
            "created_at": record.created_at.isoformat(),
            "grant_state": grant.effective_state(self.ctx.clock.now()).value if grant else None,
            "grant_expires_at": grant.expires_at.isoformat() if grant else None,
            "available": self._readable(record),
        }

    def list(self, actor: Actor, *, offset: int = 0, limit: int | None = None, direction: str | None = None) -> dict:
        if offset < 0 or (limit is not None and not 1 <= limit <= 50) or direction not in (None, "sent", "received"):
            raise RoommateError("invalid_pagination", status=422)
        self.access.require(actor)
        reconcile_if_due(self.ctx)
        # Maintenance is committed before the independent read snapshot.
        with self.ctx.read_transaction():
            self.access.require(actor)
            records = self.ctx.connections.for_actor(actor.id, offset=offset, limit=limit, direction=direction)
            pending = self.ctx.connections.received_pending(actor.id, self.ctx.clock.now())
            total = self.ctx.connections.total_for_actor(actor.id, direction)
            items = self._summaries(actor, records)
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
                "received_pending": pending,
                "profile_reminder": reminder,
                "total": total,
                "offset": offset,
                "limit": limit,
            }

    def _summaries(self, actor, records):
        if not records:
            return []
        db = self.ctx.storage.connection
        owners = sorted({who for r in records for who in (r.sender_id, r.recipient_id)})
        profiles = {
            r.owner_id: r
            for r in (
                ProfileRecord.model_validate_json(row[0])
                for row in db.execute(
                    f"SELECT content FROM profiles WHERE owner IN ({','.join('?' for _ in owners)})", owners
                )
            )
        }
        ids = [r.id for r in records]
        grants = {
            g.request_id: g
            for g in (
                GrantRecord.model_validate_json(row[0])
                for row in db.execute(
                    f"SELECT content FROM grants WHERE request IN ({','.join('?' for _ in ids)})", ids
                )
            )
        }
        chats = (
            {
                row["request"]: row
                for row in db.execute(
                    f"SELECT request,id,state,revoked FROM chat_conversations WHERE request IN ({','.join('?' for _ in ids)})",
                    ids,
                )
            }
            if any(r.mode == "chat" for r in records)
            else {}
        )
        excluded = self.ctx.safety.discovery_exclusions(actor.id)
        unread = {
            row[0]
            for row in db.execute("SELECT resource FROM notifications WHERE actor=? AND read_at IS NULL", (actor.id,))
        }
        items = []
        for record in records:
            other = record.recipient_id if record.sender_id == actor.id else record.sender_id
            available = other not in excluded and all(
                who not in profiles or profiles[who].state not in (ProfileState.DELETED, ProfileState.RESTRICTED)
                for who in (record.sender_id, record.recipient_id)
            )
            grant = grants.get(record.id)
            if record.id in chats and chats[record.id]["revoked"]:
                available = False
            name = (
                record.intro.display_name
                if record.recipient_id == actor.id
                else (profiles[other].content.display_name if other in profiles else None)
            )
            items.append(
                {
                    **(
                        {
                            "mode": "chat",
                            "conversation_id": chats[record.id]["id"] if record.id in chats else None,
                            "conversation_state": chats[record.id]["state"] if record.id in chats else None,
                            "counterparty_id": other if available else None,
                        }
                        if record.mode == "chat"
                        else {}
                    ),
                    "request_id": record.id,
                    "direction": "sent" if record.sender_id == actor.id else "received",
                    "state": record.effective_state(self.ctx.clock.now()).value,
                    "expires_at": record.expires_at.isoformat(),
                    "created_at": record.created_at.isoformat(),
                    "grant_state": grant.effective_state(self.ctx.clock.now()).value if grant else None,
                    "grant_expires_at": grant.expires_at.isoformat() if grant else None,
                    "available": available,
                    "counterparty": {
                        "display_name": name,
                        "avatar_id": profiles[other].avatar_id if other in profiles else None,
                    }
                    if available
                    else None,
                    "preview": record.intro.introduction if available and record.recipient_id == actor.id else None,
                    "unread": record.id in unread,
                }
            )
        return items

    def detail(self, actor: Actor, identifier: str) -> dict:
        self.access.require(actor)
        reconcile_if_due(self.ctx)
        with self.ctx.read_transaction():
            self.access.require(actor)
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
