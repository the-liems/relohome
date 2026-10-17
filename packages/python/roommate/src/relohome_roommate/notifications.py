"""Private events contain resource IDs only; no profile or contact snapshots."""

import hashlib
from datetime import UTC, datetime


def emit(connection, actor: str, kind: str, resource: str, now: datetime, *, event_id: str | None = None) -> None:
    # Keep the conversation as the link target, but identify repeatable events
    # (chat messages) separately from one-off request lifecycle transitions.
    identity = f"{actor}:{kind}:{resource}"
    if event_id is not None:
        identity += ":" + event_id
    identifier = hashlib.sha256(identity.encode()).hexdigest()
    connection.execute(
        "INSERT INTO notifications(id,actor,kind,resource,created) VALUES (?,?,?,?,?) ON CONFLICT(actor,id) DO NOTHING",
        (identifier, actor, kind, resource, now.timestamp()),
    )


def event_view(row) -> dict:
    return {
        "id": row["id"],
        "kind": row["kind"],
        "resource_id": row["resource"],
        "created_at": datetime.fromtimestamp(row["created"], UTC).isoformat(),
        "read": row["read_at"] is not None,
    }
