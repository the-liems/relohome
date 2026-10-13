from datetime import timedelta

import pytest
from relohome_roommate.access import RoommateError
from relohome_roommate.ports import Actor
from relohome_roommate.storage import Storage

from tests.test_roommate.test_request_lifecycle import prepare


def test_rate_budget_shared_by_connections_and_resets_without_changing_daily_quota(tmp_path):
    from relohome_roommate.services.resources import take_budget

    path = tmp_path / "db"
    with Storage(path) as first, Storage(path) as second:
        ctx = prepare(first)
        for _ in range(2):
            take_budget(ctx, Actor(id="a"), "search", limit=2)
        from relohome_roommate.access import RoommateContext

        other = RoommateContext(second, clock=ctx.clock)
        with pytest.raises(RoommateError, match="rate_limit"):
            take_budget(other, Actor(id="a"), "search", limit=2)
        assert ctx.connections.counts("a", ctx.clock.now()) == (0, 0)
        ctx.clock.advance(timedelta(minutes=1))
        take_budget(other, Actor(id="a"), "search", limit=2)


def test_read_transaction_rejects_accidental_writes(tmp_path):
    with Storage(tmp_path / "db") as db:
        with db.transaction(readonly=True):
            with pytest.raises(Exception, match="readonly"):
                db.connection.execute("INSERT INTO restrictions VALUES ('bad',1)")
