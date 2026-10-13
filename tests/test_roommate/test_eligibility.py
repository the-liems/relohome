from datetime import UTC, datetime, timedelta

import pytest
from relohome_roommate.eligibility import eligible, hard_failures, preference_match
from relohome_roommate.models import ProfileFacts, RoommateProfile, RoommateSearchCriteria
from relohome_roommate.ports import ProfileRecord

NOW = datetime(2026, 10, 7, tzinfo=UTC)


def record(**patch):
    return ProfileRecord(
        owner_id="candidate",
        version=1,
        state="active",
        updated_at=NOW,
        confirmed_at=NOW,
        expires_at=NOW + timedelta(days=30),
        content=RoommateProfile(facts=ProfileFacts(city="hcm", need={"kind": "looking_together"}), **patch),
    )


@pytest.mark.parametrize(
    "fact,passed", [(None, False), ("non_smoker", True), ("outdoors_only", False), ("indoors", False)]
)
def test_unknown_hard_smoking_never_passes(fact, passed):
    prefs = RoommateProfile(preferences={"smoking": {"value": "no_smoking", "strength": "hard"}}).preferences
    actual = ProfileFacts(self_traits={"smoking": fact})
    assert (not hard_failures(prefs, actual)) is passed


def test_candidate_hard_preferences_apply_to_searcher():
    criteria = RoommateSearchCriteria(city="hcm")
    candidate = record(preferences={"gender": {"value": "female", "strength": "hard"}})
    assert not eligible("viewer", criteria, candidate, NOW).passed
    enriched = criteria.model_copy(update={"self_facts": ProfileFacts(self_traits={"gender": "female"})})
    assert eligible("viewer", enriched, candidate, NOW).passed


@pytest.mark.parametrize("state", ["draft", "paused", "resolved", "expired", "restricted", "deleted"])
def test_inactive_block_self_and_expiry(state):
    criteria = RoommateSearchCriteria(city="hcm")
    assert not eligible("viewer", criteria, record().model_copy(update={"state": state}), NOW).passed
    assert not eligible("candidate", criteria, record(), NOW).passed
    assert not eligible("viewer", criteria, record(), NOW, blocked=True).passed
    assert not eligible("viewer", criteria, record(), NOW + timedelta(days=30)).passed


def test_two_existing_rooms_need_willingness_but_two_searchers_pass():
    criteria = RoommateSearchCriteria(city="hcm", self_facts={"need": {"kind": "has_room", "willing_to_move": False}})
    content = record().content.model_copy(
        update={"facts": ProfileFacts(city="hcm", need={"kind": "has_room", "willing_to_move": False})}
    )
    assert not eligible("viewer", criteria, record().model_copy(update={"content": content}), NOW).passed
    assert eligible(
        "viewer", RoommateSearchCriteria(city="hcm", self_facts={"need": {"kind": "looking_together"}}), record(), NOW
    ).passed


def test_pets_and_smoking_are_distinct_from_tolerance():
    prefs = RoommateProfile(
        preferences={"pets_allowed": {"value": False}, "smoking": {"value": "outdoors_only"}}
    ).preferences
    facts = ProfileFacts(self_traits={"has_pets": True, "smoking": "non_smoker"})
    assert preference_match("pets_allowed", prefs.pets_allowed.value, facts) is False
    assert preference_match("smoking", prefs.smoking.value, facts) is True
