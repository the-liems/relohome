"""Member-only Roommate conversations, opened by an explicit accepted invitation."""

from uuid import uuid4

from relohome_roommate.access import RoommateError
from relohome_roommate.chat_repository import close_chats, message_view
from relohome_roommate.connections import IntroSnapshot, RequestRecord
from relohome_roommate.eligibility import eligible
from relohome_roommate.maintenance import reconcile_if_due
from relohome_roommate.models import RoommateSearchCriteria
from relohome_roommate.notifications import emit
from relohome_roommate.policy import REQUEST_TTL, REVOKE_COOLDOWN, TERMS_VERSION, ProfileState, RequestState
from relohome_roommate.ports import Actor, ProfileRecord
from relohome_roommate.services.access import AccessService
from relohome_roommate.services.lifecycle import reconcile_profiles, request_failures
from relohome_roommate.services.limits import fingerprint, operation_key
from relohome_roommate.services.profiles import validate_complete


class ChatService:
    def __init__(self, context):
        self.ctx = context
        self.db = context.storage.connection
        self.access = AccessService(context)

    def invite(self, actor, recipient, intro, key):
        operation_key(key)
        signature = fingerprint("chat_invite", {"recipient": recipient, "intro": intro.model_dump(mode="json")})
        with self.ctx.transaction():
            self.access.require(actor)
            if actor.id == recipient or self.ctx.safety.blocked(actor.id, recipient):
                raise RoommateError("profile_unavailable", status=404)
            cached = self.ctx.connections.operation(actor.id, key, signature)
            if cached:
                return cached
            self.access.require(Actor(id=recipient))
            reconcile_profiles(self.ctx)
            now = self.ctx.clock.now()
            self.ctx.connections.expire(now)
            existing = self.ctx.connections.pair(actor.id, recipient, now, mode="chat")
            if existing:
                conversation = self.db.execute(
                    "SELECT id FROM chat_conversations WHERE request=? AND state='active'", (existing.id,)
                ).fetchone()
                result = {
                    "request_id": existing.id,
                    "existing": True,
                    "direction": "sent" if existing.sender_id == actor.id else "received",
                    "conversation_id": conversation[0] if conversation else None,
                }
            else:
                validate_complete(intro)
                self.ctx.catalog.validate_profile(intro)
                target = self.ctx.profiles.get(recipient)
                if not target:
                    raise RoommateError("profile_unavailable", status=404)
                criteria = RoommateSearchCriteria(
                    city=intro.facts.city, self_facts=intro.facts, preferences=intro.preferences
                )
                match = eligible(actor.id, criteria, target, now)
                if not match.passed:
                    raise RoommateError("criteria_no_longer_match", reasons=match.reasons)
                self.ctx.profiles.save_intro(actor.id, intro)
                request = RequestRecord(
                    id=uuid4().hex,
                    sender_id=actor.id,
                    recipient_id=recipient,
                    mode="chat",
                    created_at=now,
                    expires_at=now + REQUEST_TTL,
                    intro=IntroSnapshot(
                        display_name=intro.display_name,
                        introduction=intro.introduction,
                        facts=intro.facts,
                        reviewed_at=now,
                    ),
                )
                self.ctx.connections.create(request, now)
                result = {"request_id": request.id, "existing": False, "direction": "sent", "conversation_id": None}
            self.ctx.connections.finish_operation(actor.id, key, signature, result)
            return result

    def accept(self, actor, identifier, key):
        operation_key(key)
        signature = fingerprint("chat_accept", {"request": identifier})
        with self.ctx.transaction():
            self.access.require(actor)
            cached = self.ctx.connections.operation(actor.id, key, signature)
            if cached:
                self._authorized(actor, identifier)
                return cached
            reconcile_profiles(self.ctx)
            now = self.ctx.clock.now()
            self.ctx.connections.expire(now)
            request = self.ctx.connections.get(identifier)
            if not request or request.mode != "chat" or request.recipient_id != actor.id:
                raise RoommateError("request_unavailable", status=404)
            self.access.require(Actor(id=request.sender_id))
            if request.state is not RequestState.PENDING:
                if request.state is RequestState.ACCEPTED:
                    row = self._authorized(actor, identifier)
                    if row["state"] == "active":
                        result = {"request_id": identifier, "state": "accepted", "conversation_id": identifier}
                        self.ctx.connections.finish_operation(actor.id, key, signature, result)
                        return result
                raise RoommateError("request_not_pending")
            failures = request_failures(self.ctx, request)
            if failures:
                raise RoommateError("criteria_no_longer_match", reasons=failures)
            self.ctx.connections.save(request.model_copy(update={"state": RequestState.ACCEPTED, "closed_at": now}))
            first, second = sorted((request.sender_id, request.recipient_id))
            self.db.execute(
                "INSERT INTO chat_conversations (id,request,first,second,state,created,updated) VALUES (?,?,?,?,'active',?,?)",
                (identifier, identifier, first, second, now.timestamp(), now.timestamp()),
            )
            self.db.execute("UPDATE chat_pairs SET expires=NULL WHERE request=?", (identifier,))
            result = {"request_id": identifier, "state": "accepted", "conversation_id": identifier}
            self.ctx.connections.finish_operation(actor.id, key, signature, result)
            return result

    def _authorized(self, actor, identifier):
        self.access.require(actor)
        row = self.db.execute("SELECT * FROM chat_conversations WHERE id=?", (identifier,)).fetchone()
        if not row or row["revoked"] or actor.id not in (row["first"], row["second"]):
            raise RoommateError("conversation_unavailable", status=404)
        if self.ctx.safety.blocked(row["first"], row["second"]):
            raise RoommateError("conversation_unavailable", status=404)
        for participant in (row["first"], row["second"]):
            self.access.require(Actor(id=participant))
            profile = self.ctx.profiles.get(participant)
            if profile and profile.state in (ProfileState.DELETED, ProfileState.RESTRICTED):
                raise RoommateError("conversation_unavailable", status=404)
        return row

    def _summary(self, actor, row):
        other = row["second"] if row["first"] == actor.id else row["first"]
        request = self.ctx.connections.get(row["request"])
        profile = self.ctx.profiles.get(other)
        name = (
            request.intro.display_name
            if other == request.sender_id
            else (profile.content.display_name if profile else None)
        )
        unread = self.db.execute(
            "SELECT COUNT(*) FROM chat_messages m LEFT JOIN chat_reads r ON r.conversation=m.conversation AND r.actor=? "
            "WHERE m.conversation=? AND m.sender<>? AND (r.actor IS NULL OR m.created>r.read_at "
            "OR (m.created=r.read_at AND m.id>r.message_id))",
            (actor.id, row["id"], actor.id),
        ).fetchone()[0]
        return {
            "id": row["id"],
            "request_id": row["request"],
            "state": row["state"],
            "counterparty_name": name,
            "unread": unread,
            "updated_at": row["updated"],
        }

    def conversations(self, actor, *, offset=0, limit=25):
        if offset < 0 or not 1 <= limit <= 50:
            raise RoommateError("invalid_pagination", status=422)
        self.access.require(actor)
        reconcile_if_due(self.ctx)
        with self.ctx.read_transaction():
            self.access.require(actor)
            visible = (
                "(c.first=? OR c.second=?) AND c.revoked=0 "
                "AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.actor=c.first AND b.target=c.second) OR (b.actor=c.second AND b.target=c.first)) "
                "AND NOT EXISTS(SELECT 1 FROM restrictions s WHERE s.actor IN (c.first,c.second) AND s.restricted=1) "
                "AND NOT EXISTS(SELECT 1 FROM profiles p WHERE p.owner IN (c.first,c.second) AND p.state IN ('deleted','restricted')) "
                "AND EXISTS(SELECT 1 FROM access a WHERE a.actor=c.first AND a.adult=1 AND a.terms=?) "
                "AND EXISTS(SELECT 1 FROM access a WHERE a.actor=c.second AND a.adult=1 AND a.terms=?)"
            )
            parameters = (actor.id, actor.id, TERMS_VERSION, TERMS_VERSION)
            unread_condition = "(r.actor IS NULL OR m.created>r.read_at OR (m.created=r.read_at AND m.id>r.message_id))"
            rows = self.db.execute(
                "SELECT c.*,q.content AS request_content,p.content AS profile_content, "
                "(SELECT COUNT(*) FROM chat_messages m LEFT JOIN chat_reads r ON r.conversation=m.conversation AND r.actor=? "
                f"WHERE m.conversation=c.id AND m.sender<>? AND {unread_condition}) AS unread "
                "FROM chat_conversations c JOIN requests q ON q.id=c.request "
                "LEFT JOIN profiles p ON p.owner=CASE WHEN c.first=? THEN c.second ELSE c.first END "
                f"WHERE {visible} ORDER BY c.updated DESC,c.id LIMIT ? OFFSET ?",
                (actor.id, actor.id, actor.id, *parameters, limit + 1, offset),
            ).fetchall()
            items = []
            for row in rows[:limit]:
                request = RequestRecord.model_validate_json(row["request_content"])
                profile = ProfileRecord.model_validate_json(row["profile_content"]) if row["profile_content"] else None
                name = (
                    request.intro.display_name
                    if actor.id == request.recipient_id
                    else (profile.content.display_name if profile else None)
                )
                items.append(
                    {
                        "id": row["id"],
                        "request_id": row["request"],
                        "state": row["state"],
                        "counterparty_name": name,
                        "unread": row["unread"],
                        "updated_at": row["updated"],
                    }
                )
            total = self.db.execute(
                "SELECT COUNT(*) FROM chat_messages m JOIN chat_conversations c ON c.id=m.conversation "
                "LEFT JOIN chat_reads r ON r.conversation=m.conversation AND r.actor=? "
                f"WHERE m.sender<>? AND {unread_condition} AND {visible}",
                (actor.id, actor.id, *parameters),
            ).fetchone()[0]
            return {
                "items": items,
                "has_more": len(rows) > limit,
                "offset": offset,
                "limit": limit,
                "unread_total": total,
            }

    def messages(self, actor, identifier, *, before=None, limit=30):
        if not 1 <= limit <= 50:
            raise RoommateError("invalid_pagination", status=422)
        self.access.require(actor)
        reconcile_if_due(self.ctx)
        with self.ctx.read_transaction():
            row = self._authorized(actor, identifier)
            own_profile = self.ctx.profiles.get(actor.id)
            parameters = [identifier]
            where = "conversation=?"
            if before:
                cursor = self.db.execute(
                    "SELECT created,id FROM chat_messages WHERE conversation=? AND id=?", (identifier, before)
                ).fetchone()
                if not cursor:
                    raise RoommateError("invalid_cursor", status=422)
                where += " AND (created<? OR (created=? AND id<?))"
                parameters.extend((cursor[0], cursor[0], cursor[1]))
            rows = self.db.execute(
                f"SELECT * FROM chat_messages WHERE {where} ORDER BY created DESC,id DESC LIMIT ?",
                [*parameters, limit + 1],
            ).fetchall()
            other = row["second"] if row["first"] == actor.id else row["first"]
            receipt = self.db.execute(
                "SELECT message_id FROM chat_reads WHERE conversation=? AND actor=?", (identifier, other)
            ).fetchone()
            return {
                **self._summary(actor, row),
                "viewer_id": actor.id,
                "own_profile": {"state": own_profile.state.value, "version": own_profile.version}
                if own_profile
                else None,
                # This is the exact read cursor, not an inferred presence/online indicator.
                "counterparty_read_message_id": receipt[0] if receipt else None,
                "retention_days": self.ctx.chat_retention_days,
                "items": [message_view(item) for item in reversed(rows[:limit])],
                "has_more": len(rows) > limit,
            }

    def send(self, actor, identifier, body, key):
        operation_key(key)
        if not isinstance(body, str) or not 1 <= len(body.strip()) <= 2000:
            raise RoommateError("invalid_message", status=422)
        body = body.strip()
        try:
            body.encode("utf-8")
        except UnicodeError:
            raise RoommateError("invalid_message", status=422) from None
        if "\x00" in body:
            raise RoommateError("invalid_message", status=422)
        signature = fingerprint("chat_message", {"conversation": identifier, "body": body})
        with self.ctx.transaction():
            row = self._authorized(actor, identifier)
            ledger = self.db.execute(
                "SELECT fingerprint,message_id FROM chat_message_keys WHERE sender=? AND client_key=?", (actor.id, key)
            ).fetchone()
            if ledger and ledger[0] != signature:
                raise RoommateError("operation_conflict")
            existing = self.db.execute(
                "SELECT * FROM chat_messages WHERE sender=? AND client_key=?", (actor.id, key)
            ).fetchone()
            if existing:
                if existing["conversation"] != identifier or existing["body"] != body:
                    raise RoommateError("operation_conflict")
                return {"message": message_view(existing)}
            if ledger:
                return {"message": None, "removed": True}
            if row["state"] != "active":
                raise RoommateError("conversation_closed")
            last = self.db.execute(
                "SELECT MAX(created) FROM chat_messages WHERE conversation=?", (identifier,)
            ).fetchone()[0]
            now = max(self.ctx.clock.now().timestamp(), (last + 0.000001) if last is not None else 0)
            message_id = uuid4().hex
            self.db.execute(
                "INSERT INTO chat_messages VALUES (?,?,?,?,?,?)", (message_id, identifier, actor.id, key, body, now)
            )
            self.db.execute("INSERT INTO chat_message_keys VALUES (?,?,?,?)", (actor.id, key, signature, message_id))
            self.db.execute("UPDATE chat_conversations SET updated=? WHERE id=?", (now, identifier))
            other = row["second"] if row["first"] == actor.id else row["first"]
            emit(self.db, other, "chat_message", row["request"], self.ctx.clock.now(), event_id=message_id)
            message = self.db.execute("SELECT * FROM chat_messages WHERE id=?", (message_id,)).fetchone()
            return {"message": message_view(message)}

    def mark_read(self, actor, identifier, message_id):
        with self.ctx.transaction():
            self._authorized(actor, identifier)
            message = self.db.execute(
                "SELECT created FROM chat_messages WHERE conversation=? AND id=?", (identifier, message_id)
            ).fetchone()
            if not message:
                raise RoommateError("invalid_cursor", status=422)
            previous = self.db.execute(
                "SELECT read_at,message_id FROM chat_reads WHERE conversation=? AND actor=?", (identifier, actor.id)
            ).fetchone()
            if not previous or (message[0], message_id) > (previous[0], previous[1]):
                self.db.execute(
                    "INSERT INTO chat_reads VALUES (?,?,?,?) ON CONFLICT(conversation,actor) "
                    "DO UPDATE SET read_at=excluded.read_at,message_id=excluded.message_id",
                    (identifier, actor.id, message[0], message_id),
                )
            return {"read": True}

    def close(self, actor, identifier, key):
        operation_key(key)
        signature = fingerprint("chat_close", {"conversation": identifier})
        with self.ctx.transaction():
            row = self._authorized(actor, identifier)
            cached = self.ctx.connections.operation(actor.id, key, signature)
            if cached:
                return cached
            other = row["second"] if row["first"] == actor.id else row["first"]
            close_chats(self.ctx, actor.id, other)
            self.ctx.connections.set_cooldown(other, actor.id, self.ctx.clock.now() + REVOKE_COOLDOWN)
            result = {"conversation_id": identifier, "state": "closed"}
            self.ctx.connections.finish_operation(actor.id, key, signature, result)
            return result
