from datetime import UTC, datetime, timedelta
from time import perf_counter

import pytest
from relohome_roommate.access import RoommateContext
from relohome_roommate.clock import FrozenClock
from relohome_roommate.models import RoommateSearchCriteria
from relohome_roommate.policy import TERMS_VERSION
from relohome_roommate.ports import Actor, ProfileRecord
from relohome_roommate.services.access import AccessService
from relohome_roommate.services.discovery import DiscoveryService
from relohome_roommate.storage import Storage

from tests.test_roommate.test_profile_lifecycle import complete


@pytest.mark.parametrize("count", [10, 100, 1000])
def test_search_query_count_does_not_grow_per_candidate(tmp_path, count):
    now = datetime(2026, 10, 7, tzinfo=UTC)
    with Storage(tmp_path / "db") as db:
        ctx = RoommateContext(db, clock=FrozenClock(now))
        actor = Actor(id="viewer")
        AccessService(ctx).accept(actor, True, TERMS_VERSION)
        with ctx.transaction():
            for index in range(count):
                ctx.profiles.save(
                    ProfileRecord(
                        owner_id=f"candidate{index:04d}",
                        version=1,
                        state="active",
                        confirmed_at=now,
                        expires_at=now + timedelta(days=30),
                        updated_at=now,
                        content=complete(),
                    ),
                    None,
                )
            ctx.safety.block(actor.id, "candidate0001", True)
            ctx.safety.block("candidate0002", actor.id, True)
            ctx.safety.moderate("mod", "candidate0003", True, "Test", now)
        statements = []
        db.connection.set_trace_callback(statements.append)
        started = perf_counter()
        result = DiscoveryService(ctx).search(actor, RoommateSearchCriteria(city="hcm"), limit=2)
        elapsed = perf_counter() - started
        selects = sum(statement.lstrip().upper().startswith("SELECT") for statement in statements)
        db.connection.set_trace_callback(None)
        assert result["total"] == count - 3
        assert [item["profile"]["profile_id"] for item in result["items"]] == ["candidate0000", "candidate0004"]
        print(f"Roommate candidates={count}, SELECTs={selects}, seconds={elapsed:.4f}")
        assert selects <= 6
