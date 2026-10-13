from datetime import UTC, datetime, timedelta

import httpx
import pytest
from relohome_agent.api.roommate_map import router
from relohome_roommate.access import RoommateContext
from relohome_roommate.clock import FrozenClock
from relohome_roommate.models import RoommateSearchCriteria
from relohome_roommate.policy import TERMS_VERSION
from relohome_roommate.ports import Actor, ProfileRecord
from relohome_roommate.services.access import AccessService
from relohome_roommate.services.discovery import DiscoveryService
from relohome_roommate.storage import Storage

from tests.test_roommate.test_discovery_api import headers, make_app
from tests.test_roommate.test_profile_lifecycle import complete


def test_discovery_reader_works_while_another_connection_holds_writer(tmp_path):
    now = datetime(2026, 10, 12, tzinfo=UTC)
    path = tmp_path / "db"
    with Storage(path) as first, Storage(path) as reader:
        ctx = RoommateContext(reader, clock=FrozenClock(now))
        AccessService(ctx).accept(Actor(id="viewer"), True, TERMS_VERSION)
        with ctx.transaction():
            ctx.profiles.save(
                ProfileRecord(
                    owner_id="candidate",
                    version=1,
                    state="active",
                    confirmed_at=now,
                    expires_at=now + timedelta(days=30),
                    updated_at=now,
                    content=complete(),
                ),
                None,
            )
        reader.connection.execute("PRAGMA busy_timeout=50")
        with first.transaction():
            first.connection.execute("INSERT INTO restrictions VALUES ('irrelevant',1)")
            result = DiscoveryService(ctx).search(Actor(id="viewer"), RoommateSearchCriteria(city="hcm"))
            assert result["total"] == 1


def test_open_existing_reader_does_not_request_migration_writer_lock(tmp_path):
    path = tmp_path / "db"
    with Storage(path) as writer, writer.transaction():
        with Storage(path, initialize=False) as reader:
            assert reader.connection.execute("SELECT COUNT(*) FROM profiles").fetchone()[0] == 0


@pytest.mark.asyncio
async def test_map_selects_only_matching_rooms_with_bounded_queries(tmp_path):
    app, runtime = make_app(tmp_path)
    app.include_router(router, prefix="/api/v1")
    now = runtime.clock.now()
    with runtime.context() as ctx:
        AccessService(ctx).accept(Actor(id="viewer"), True, TERMS_VERSION)
        with ctx.transaction():
            for i in range(100):
                actor = Actor(id=f"candidate{i}")
                ctx.profiles.set_access(actor.id, True, TERMS_VERSION, now)
                content = complete()
                if i == 42:
                    values = content.model_dump()
                    values["facts"]["need"] = {"kind": "has_room", "willing_to_move": False}
                    content = type(content).model_validate(
                        {**values, "room": {"listing_id": "room-42", "public_location_consent": True}}
                    )
                ctx.profiles.save(
                    ProfileRecord(
                        owner_id=actor.id,
                        version=1,
                        state="active",
                        confirmed_at=now,
                        expires_at=now + timedelta(days=30),
                        updated_at=now,
                        content=content,
                    ),
                    None,
                )
    statements = []
    original = runtime.context
    from contextlib import contextmanager

    @contextmanager
    def traced():
        with original() as ctx:
            ctx.storage.connection.set_trace_callback(statements.append)
            yield ctx

    runtime.context = traced
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        result = await client.post("/api/v1/roommate/map/rooms", json={"listing_ids": ["room-42"]}, headers=headers())
    assert result.status_code == 200
    assert [i["profile_id"] for i in result.json()["items"]] == ["candidate42"]
    assert sum(s.lstrip().upper().startswith("SELECT") for s in statements) <= 6
