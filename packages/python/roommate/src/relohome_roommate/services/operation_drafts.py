"""Encrypted owner-only drafts for explicit recovery; never automatically replayed."""

import json
import re
from datetime import UTC, datetime, timedelta

from relohome_roommate.access import RoommateError
from relohome_roommate.api_models import (
    AcceptInput,
    BlockInput,
    ChatInviteInput,
    ContactUpdate,
    ModerationInput,
    OperationInput,
    ReportInput,
    SendInput,
)
from relohome_roommate.services.access import AccessService
from relohome_roommate.services.limits import fingerprint


def validated_draft(path, method, body):
    routes = [
        (r"/chat/requests", "POST", ChatInviteInput),
        (r"/chat/requests/[A-Za-z0-9_.:-]{1,128}/accept", "POST", OperationInput),
        (r"/chat/conversations/[A-Za-z0-9_.:-]{1,128}/close", "POST", OperationInput),
        (r"/requests", "POST", SendInput),
        (r"/me/contacts", "PUT", ContactUpdate),
        (r"/reports", "POST", ReportInput),
        (r"/blocks/[A-Za-z0-9_.:-]{1,128}", "PUT", BlockInput),
        (r"/requests/[A-Za-z0-9_.:-]{1,128}/accept", "POST", AcceptInput),
        (r"/requests/[A-Za-z0-9_.:-]{1,128}/(?:reject|withdraw|revoke)", "POST", OperationInput),
        (r"/moderation/profiles/[A-Za-z0-9_.:-]{1,128}", "POST", ModerationInput),
    ]
    for pattern, verb, model in routes:
        if method == verb and re.fullmatch(pattern, path):
            value = model.model_validate(body).model_dump(mode="json")
            if model is ModerationInput and value.get("expected_version") is None:
                value.pop("expected_version", None)
            return value
    raise RoommateError("invalid_input", status=422)


class OperationDraftService:
    def __init__(self, context):
        self.ctx = context

    def save(self, actor, path, method, body):
        body = validated_draft(path, method, body)
        key = body["operation_key"]
        signature = fingerprint("draft", {"path": path, "method": method, "body": body})
        with self.ctx.transaction():
            if path.startswith("/moderation/"):
                AccessService(self.ctx).require_moderator(actor)
            else:
                AccessService(self.ctx).require(actor)
            db = self.ctx.storage.connection
            old = db.execute(
                "SELECT fingerprint FROM operation_drafts WHERE actor=? AND key=?", (actor.id, key)
            ).fetchone()
            if old and old[0] != signature:
                raise RoommateError("operation_conflict", status=409)
            if not old:
                now = self.ctx.clock.now()
                count = db.execute(
                    "SELECT COUNT(*) FROM operation_drafts WHERE actor=? AND expires>?", (actor.id, now.timestamp())
                ).fetchone()[0]
                if count >= 10:
                    raise RoommateError("draft_limit", status=429)
                sealed = self.ctx.vault.seal(json.dumps({"path": path, "method": method, "body": body}))
                db.execute(
                    "INSERT INTO operation_drafts VALUES (?,?,?,?,?,?)",
                    (actor.id, key, signature, sealed, now.timestamp(), (now + timedelta(minutes=30)).timestamp()),
                )
        return {"saved": True, "operation_key": key}

    def list(self, actor):
        with self.ctx.read_transaction():
            AccessService(self.ctx).require_operation_owner(actor)
            return {
                "items": [
                    {"operation_key": row["key"], "expires_at": datetime.fromtimestamp(row["expires"], UTC).isoformat()}
                    for row in self.ctx.storage.connection.execute(
                        "SELECT key,expires FROM operation_drafts WHERE actor=? AND expires>? ORDER BY created",
                        (actor.id, self.ctx.clock.now().timestamp()),
                    )
                ]
            }

    def get(self, actor, key):
        with self.ctx.read_transaction():
            AccessService(self.ctx).require_operation_owner(actor)
            completed = self.ctx.connections.operation(actor.id, key)
            if completed:
                return {"status": "completed", "result": completed}
            row = self.ctx.storage.connection.execute(
                "SELECT ciphertext,expires FROM operation_drafts WHERE actor=? AND key=?", (actor.id, key)
            ).fetchone()
            if not row or self.ctx.clock.now().timestamp() >= row["expires"]:
                raise RoommateError("draft_unavailable", status=404)
            return {"status": "ready", "draft": json.loads(self.ctx.vault.open(bytes(row["ciphertext"])))}

    def discard(self, actor, key):
        with self.ctx.transaction():
            AccessService(self.ctx).require_operation_owner(actor)
            self.ctx.storage.connection.execute("DELETE FROM operation_drafts WHERE actor=? AND key=?", (actor.id, key))
        return {"discarded": True}
