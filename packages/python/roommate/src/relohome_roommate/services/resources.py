"""Shared API resource budgets, separate from connection business quotas."""

from datetime import UTC, datetime

from relohome_roommate.access import RoommateError


def take_budget(context, actor, bucket: str, *, limit: int = 120) -> None:
    window = int(context.clock.now().timestamp()) // 60 * 60
    with context.transaction():
        row = context.storage.connection.execute(
            "INSERT INTO rate_buckets(actor,bucket,bucket_start,count) VALUES (?,?,?,1) "
            "ON CONFLICT(actor,bucket,bucket_start) DO UPDATE SET count=rate_buckets.count+1 RETURNING count",
            (actor.id, bucket, window),
        ).fetchone()
        if row[0] > limit:
            raise RoommateError("rate_limit", status=429, until=datetime.fromtimestamp(window + 60, UTC))
