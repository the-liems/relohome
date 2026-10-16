from relohome_roommate.access import RoommateContext
from relohome_roommate.services.lifecycle import reconcile_profiles


def reconcile(context: RoommateContext) -> None:
    """Called inside the caller's transaction; reads also enforce deadlines independently."""
    reconcile_profiles(context)
    context.connections.expire(context.clock.now())
    now = context.clock.now().timestamp()
    context.storage.connection.execute("DELETE FROM rate_buckets WHERE bucket_start<?", (int(now) - 120,))
    context.storage.connection.execute("DELETE FROM operation_drafts WHERE expires<=?", (now,))
    context.storage.connection.execute(
        "DELETE FROM chat_messages WHERE created<=?", (now - context.chat_retention_days * 86400,)
    )
    context.storage.connection.execute(
        "DELETE FROM notifications WHERE read_at IS NOT NULL AND created<?", (now - 90 * 86400,)
    )


def reconcile_if_due(context: RoommateContext) -> None:
    now = context.clock.now().timestamp()
    with context.read_transaction():
        due = context.storage.connection.execute(
            "SELECT EXISTS(SELECT 1 FROM profiles WHERE state='active' AND expires<=?) "
            "OR EXISTS(SELECT 1 FROM requests WHERE state='pending' AND expires<=?) "
            "OR EXISTS(SELECT 1 FROM grants WHERE state='active' AND expires<=?) "
            "OR EXISTS(SELECT 1 FROM chat_messages WHERE created<=?)",
            (now, now, now, now - context.chat_retention_days * 86400),
        ).fetchone()[0]
    if due:
        with context.transaction():
            reconcile(context)
