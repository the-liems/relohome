"""SQL helpers shared by chat and existing privacy/safety lifecycle mutations."""


def close_chats(context, actor: str, target: str | None = None, *, revoke=False) -> None:
    db = context.storage.connection
    where = "(first=? OR second=?)"
    params = [actor, actor]
    if target is not None:
        where += " AND (first=? OR second=?)"
        params.extend((target, target))
    db.execute(
        f"DELETE FROM chat_pairs WHERE request IN (SELECT request FROM chat_conversations WHERE {where})", params
    )
    db.execute(
        f"UPDATE chat_conversations SET state='closed',updated=? WHERE state='active' AND {where}",
        [context.clock.now().timestamp(), *params],
    )
    if revoke:
        db.execute(f"UPDATE chat_conversations SET revoked=1 WHERE {where}", params)


def message_view(row) -> dict:
    from datetime import UTC, datetime

    return {
        "id": row["id"],
        "sender_id": row["sender"],
        "body": row["body"],
        "created_at": datetime.fromtimestamp(row["created"], UTC).isoformat(),
    }
