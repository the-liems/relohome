from datetime import UTC, datetime, timedelta

import pytest
from relohome_roommate.access import RoommateContext, RoommateError
from relohome_roommate.clock import FrozenClock
from relohome_roommate.models import RoommateProfile
from relohome_roommate.policy import TERMS_VERSION
from relohome_roommate.ports import Actor
from relohome_roommate.services.access import AccessService
from relohome_roommate.services.profiles import ProfileService
from relohome_roommate.storage import Storage


def complete():
    return RoommateProfile(
        display_name="Name",
        introduction="Looking for a quiet place",
        facts={
            "city": "hcm",
            "area_ids": ["city:hcm"],
            "budget": {"max_vnd": 4000000, "fee_basis": "rent_only"},
            "need": {"kind": "looking_together"},
            "move_in": {"kind": "flexible"},
            "self_traits": {"gender": "male"},
        },
    )


def test_publish_edit_pause_and_reconfirm_deadlines(tmp_path):
    now = datetime(2026, 10, 7, tzinfo=UTC)
    with Storage(tmp_path / "db") as db:
        ctx = RoommateContext(db, clock=FrozenClock(now))
        actor = Actor(id="a")
        AccessService(ctx).accept(actor, True, TERMS_VERSION)
        service = ProfileService(ctx)
        draft = service.save(actor, complete(), None)
        with pytest.raises(RoommateError, match="review_required"):
            service.transition(actor, "publish", draft.version, False)
        published = service.transition(actor, "publish", draft.version, True)
        assert published.expires_at == now + timedelta(days=30)
        ctx.clock.advance(timedelta(days=2))
        edited = service.save(actor, complete().model_copy(update={"introduction": "Updated"}), published.version)
        assert edited.expires_at == published.expires_at
        paused = service.transition(actor, "pause", edited.version)
        assert paused.state.value == "paused"
        resumed = service.transition(actor, "resume", paused.version, True)
        assert resumed.expires_at == ctx.clock.now() + timedelta(days=30)
        deleted = service.transition(actor, "delete", resumed.version)
        assert deleted.content.display_name is None and deleted.avatar_id is None
        assert deleted.state.value == "deleted"


def test_private_intro_never_publishes_and_validation(tmp_path):
    with Storage(tmp_path / "db") as db:
        ctx = RoommateContext(db)
        actor = Actor(id="a")
        AccessService(ctx).accept(actor, True, TERMS_VERSION)
        service = ProfileService(ctx)
        service.save_intro(actor, complete())
        assert ctx.profiles.get(actor.id) is None
        with pytest.raises(RoommateError, match="contact_in_public_text"):
            service.save(actor, complete().model_copy(update={"introduction": "Call 0901234567"}), None)
        draft = service.save(actor, RoommateProfile(display_name="Draft"), None)
        with pytest.raises(RoommateError, match="intro_incomplete"):
            service.transition(actor, "publish", draft.version, True)


def test_gender_is_required_to_publish_but_incomplete_private_drafts_remain_valid(tmp_path):
    with Storage(tmp_path / "gender.db") as db:
        ctx = RoommateContext(db)
        actor = Actor(id="a")
        AccessService(ctx).accept(actor, True, TERMS_VERSION)
        service = ProfileService(ctx)
        payload = complete().model_dump(mode="json")
        payload["facts"]["self_traits"]["gender"] = None
        content = RoommateProfile.model_validate(payload)
        service.save_intro(actor, content)
        draft = service.save(actor, content, None)
        with pytest.raises(RoommateError, match="intro_incomplete"):
            service.transition(actor, "publish", draft.version, True)
        assert ctx.profiles.get(actor.id).state.value == "draft"


@pytest.mark.parametrize("gender", ["female", "male", "non_binary", "other"])
def test_all_supported_genders_are_accepted_for_complete_profiles(gender):
    from relohome_roommate.services.profiles import validate_complete

    payload = complete().model_dump(mode="json")
    payload["facts"]["self_traits"]["gender"] = gender
    validate_complete(RoommateProfile.model_validate(payload))
