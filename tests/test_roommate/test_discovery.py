from datetime import UTC, datetime, timedelta

import pytest
from relohome_roommate.access import RoommateContext, RoommateError
from relohome_roommate.clock import FrozenClock
from relohome_roommate.models import RoommateProfile, RoommateSearchCriteria
from relohome_roommate.policy import TERMS_VERSION
from relohome_roommate.ports import Actor, ProfileRecord
from relohome_roommate.services.access import AccessService
from relohome_roommate.services.discovery import DiscoveryService
from relohome_roommate.storage import Storage


def test_discovery_private_bookmark_and_fresh_visibility(tmp_path):
    now = datetime(2026, 10, 7, tzinfo=UTC)
    with Storage(tmp_path / "db") as db:
        ctx = RoommateContext(db, clock=FrozenClock(now))
        viewer = Actor(id="viewer")
        access = AccessService(ctx)
        service = DiscoveryService(ctx)
        with pytest.raises(RoommateError):
            service.search(viewer, RoommateSearchCriteria(city="hcm"))
        access.accept(viewer, True, TERMS_VERSION)
        candidate = ProfileRecord(
            owner_id="candidate",
            version=1,
            state="active",
            confirmed_at=now,
            expires_at=now + timedelta(days=30),
            updated_at=now,
            content=RoommateProfile(display_name="Candidate", facts={"city": "hcm", "area_ids": ["city:hcm"]}),
        )
        with ctx.transaction():
            ctx.profiles.save(candidate, None)
        assert service.search(viewer, RoommateSearchCriteria(city="hcm"))["total"] == 1
        assert ctx.profiles.get(viewer.id) is None
        service.bookmark(viewer, "candidate", True)
        assert service.saved(viewer)[0]["available"] is True
        with ctx.transaction():
            ctx.safety.block("candidate", viewer.id, True)
        assert service.search(viewer, RoommateSearchCriteria(city="hcm"))["total"] == 0
        assert service.saved(viewer) == [{"profile_id": "candidate", "available": False}]
        assert service.detail(viewer, "candidate") == {"profile_id": "candidate", "available": False}


def test_expiry_read_and_pagination(tmp_path):
    now = datetime(2026, 10, 7, tzinfo=UTC)
    with Storage(tmp_path / "db") as db:
        clock = FrozenClock(now)
        ctx = RoommateContext(db, clock=clock)
        viewer = Actor(id="viewer")
        AccessService(ctx).accept(viewer, True, TERMS_VERSION)
        with ctx.transaction():
            for identifier in ("z", "a", "b"):
                ctx.profiles.save(
                    ProfileRecord(
                        owner_id=identifier,
                        version=1,
                        state="active",
                        confirmed_at=now,
                        expires_at=now + timedelta(days=30),
                        updated_at=now,
                        content=RoommateProfile(facts={"city": "hcm"}),
                    ),
                    None,
                )
        service = DiscoveryService(ctx)
        result = service.search(viewer, RoommateSearchCriteria(city="hcm"), offset=1, limit=1)
        assert result["total"] == 3 and result["items"][0]["profile"]["profile_id"] == "b"
        clock.advance(timedelta(days=30))
        assert service.search(viewer, RoommateSearchCriteria(city="hcm"))["total"] == 0
        assert service.detail(viewer, "a")["available"] is False
