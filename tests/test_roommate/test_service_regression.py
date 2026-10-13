from datetime import timedelta

import pytest
from relohome_roommate.connections import ContactRef
from relohome_roommate.models import RoommateProfile, RoommateSearchCriteria
from relohome_roommate.ports import Actor
from relohome_roommate.services.access import AccessService
from relohome_roommate.services.discovery import DiscoveryService
from relohome_roommate.services.profiles import ProfileService
from relohome_roommate.services.requests import RequestService
from relohome_roommate.storage import Storage

from tests.test_roommate.test_profile_lifecycle import complete
from tests.test_roommate.test_request_lifecycle import prepare


def send(ctx):
    return RequestService(ctx).send(
        Actor(id="a"), "b", complete(), ContactRef(channel_id="a", version=1), True, "send-operation-001"
    )["request_id"]


@pytest.mark.parametrize("change", ["city", "self_traits"])
def test_pending_request_is_cancelled_when_current_intro_no_longer_fits(tmp_path, change):
    with Storage(tmp_path / "db") as db:
        ctx = prepare(db)
        profiles = ProfileService(ctx)
        if change == "self_traits":
            recipient = ctx.profiles.get("b")
            raw = recipient.content.model_dump(mode="json")
            raw["preferences"]["smoking"] = {"value": "no_smoking", "strength": "hard"}
            profiles.save(Actor(id="b"), RoommateProfile.model_validate(raw), recipient.version)
            intro = complete().model_dump(mode="json")
            intro["facts"]["self_traits"]["smoking"] = "non_smoker"
            initial = RoommateProfile.model_validate(intro)
            identifier = RequestService(ctx).send(
                Actor(id="a"), "b", initial, ContactRef(channel_id="a", version=1), True, "send-operation-001"
            )["request_id"]
            intro["facts"]["self_traits"]["smoking"] = "indoors"
        else:
            identifier = send(ctx)
            intro = complete().model_dump(mode="json")
            intro["facts"]["city"] = "hanoi"
            intro["facts"]["area_ids"] = ["city:hanoi"]
        profiles.save_intro(Actor(id="a"), RoommateProfile.model_validate(intro))
        assert ctx.connections.get(identifier).state.value == "cancelled"
        assert ctx.connections.cooldown("a", "b") is None


def test_underage_reconfirmation_removes_discovery_and_cancels_pending(tmp_path):
    with Storage(tmp_path / "db") as db:
        ctx = prepare(db)
        identifier = send(ctx)
        AccessService(ctx).accept(Actor(id="b"), False, "roommate-1.0")
        found = DiscoveryService(ctx).search(Actor(id="a"), RoommateSearchCriteria(city="hcm"))
        assert found["items"] == []
        assert DiscoveryService(ctx).detail(Actor(id="a"), "b")["available"] is False
        assert ctx.connections.get(identifier).state.value == "cancelled"


def test_pending_limit_twenty_remains_after_daily_window(tmp_path):
    from relohome_roommate.connection_repository import RepositoryPolicyError, SqlConnections
    from relohome_roommate.policy import REQUEST_TTL

    from tests.test_roommate.test_connection_repository import NOW, item

    with Storage(tmp_path / "db") as db, db.transaction():
        repo = SqlConnections(db.connection)
        for index in range(20):
            time = NOW + timedelta(hours=24 if index >= 10 else 0)
            req = item("a", f"b{index}", f"r{index}").model_copy(
                update={"created_at": time, "expires_at": time + REQUEST_TTL}
            )
            repo.create(req, time)
        time = NOW + timedelta(hours=48)
        req = item("a", "another", "rnew").model_copy(update={"created_at": time, "expires_at": time + REQUEST_TTL})
        with pytest.raises(RepositoryPolicyError, match="pending_limit"):
            repo.create(req, time)
