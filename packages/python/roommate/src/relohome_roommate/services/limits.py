import hashlib
import json

from relohome_roommate.access import RoommateContext, RoommateError
from relohome_roommate.connections import ContactRef


def fingerprint(action: str, payload: dict) -> str:
    return hashlib.sha256(
        json.dumps({"action": action, "payload": payload}, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def current_contact(context: RoommateContext, actor: str, reference: ContactRef):
    row = context.storage.connection.execute(
        "SELECT * FROM contacts WHERE id=? AND owner=? AND version=? AND ciphertext IS NOT NULL",
        (reference.channel_id, actor, reference.version),
    ).fetchone()
    if row is None:
        raise RoommateError("contact_changed")
    return row


def operation_key(key: str) -> None:
    if not isinstance(key, str) or not 16 <= len(key) <= 128:
        raise RoommateError("invalid_operation_key", status=422)
