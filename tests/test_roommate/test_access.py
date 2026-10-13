from datetime import UTC, datetime

import pytest
from relohome_roommate.access import RoommateContext, RoommateError
from relohome_roommate.clock import FrozenClock
from relohome_roommate.policy import TERMS_VERSION
from relohome_roommate.ports import Actor
from relohome_roommate.services.access import AccessService
from relohome_roommate.storage import Storage


def test_service_consent_is_versioned_private_and_not_a_public_profile(tmp_path):
    with Storage(tmp_path / "db") as db:
        ctx = RoommateContext(db, clock=FrozenClock(datetime(2026, 10, 7, tzinfo=UTC)))
        access = AccessService(ctx)
        actor = Actor(id="user")
        with pytest.raises(RoommateError, match="service_terms_required"):
            access.require(actor)
        access.accept(actor, True, TERMS_VERSION)
        access.require(actor)
        assert ctx.profiles.get(actor.id) is None
        assert access.status(actor)["eligible"] is True
        access.accept(actor, False, TERMS_VERSION)
        with pytest.raises(RoommateError, match="adult_required"):
            access.require(actor)


def test_server_only_moderator_and_restriction(tmp_path):
    with Storage(tmp_path / "db") as db:
        ctx = RoommateContext(db, moderators=frozenset({"mod"}))
        access = AccessService(ctx)
        with pytest.raises(RoommateError, match="moderator_required"):
            access.require_moderator(Actor(id="user"))
        access.require_moderator(Actor(id="mod"))
        access.accept(Actor(id="user"), True, TERMS_VERSION)
        with db.transaction():
            ctx.safety.moderate("mod", "user", True, "Review", ctx.clock.now())
        with pytest.raises(RoommateError, match="service_restricted"):
            access.require(Actor(id="user"))


def test_accept_rejects_old_terms(tmp_path):
    with Storage(tmp_path / "db") as db:
        with pytest.raises(RoommateError, match="terms_version_changed"):
            AccessService(RoommateContext(db)).accept(Actor(id="u"), True, "old")
