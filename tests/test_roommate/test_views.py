from datetime import UTC, datetime, timedelta

import pytest
from pydantic import ValidationError
from relohome_roommate.models import RoommateProfile
from relohome_roommate.policy import ProfileState
from relohome_roommate.ports import Actor, ProfileRecord
from relohome_roommate.views import owner_profile, public_profile, unavailable_profile

NOW = datetime(2026, 10, 7, tzinfo=UTC)


def record():
    return ProfileRecord(
        owner_id="owner",
        version=1,
        state=ProfileState.ACTIVE,
        content=RoommateProfile(display_name="Name", preferences={"gender": {"value": "female"}}),
        updated_at=NOW,
        confirmed_at=NOW,
        expires_at=NOW + timedelta(days=30),
    )


def test_public_projection_never_contains_owner_preferences_or_record_dates():
    data = public_profile(record()).model_dump(mode="json")
    assert set(data) == {"profile_id", "display_name", "introduction", "facts", "avatar_id"}
    assert "preferences" not in str(data)
    assert "owner_id" not in data


def test_owner_projection_requires_trusted_actor():
    assert owner_profile(record(), Actor(id="owner")).content.preferences.gender is not None
    with pytest.raises(PermissionError):
        owner_profile(record(), Actor(id="another"))


def test_public_record_must_be_active():
    with pytest.raises(PermissionError):
        public_profile(record().model_copy(update={"state": ProfileState.PAUSED}))
    assert set(unavailable_profile("owner").model_dump()) == {"profile_id", "available"}


def test_actor_cannot_be_anonymous_or_contain_roles_from_body():
    for value in ("", "anonymous"):
        with pytest.raises(ValidationError):
            Actor(id=value)
    with pytest.raises(ValidationError):
        Actor(id="owner", moderator=True)
