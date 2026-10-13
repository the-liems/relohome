from datetime import UTC, datetime, timedelta

from relohome_roommate.models import ProfileFacts, RoommateProfile, RoommateSearchCriteria
from relohome_roommate.ports import ProfileRecord
from relohome_roommate.ranking import publish_score, ranked
from relohome_roommate.scoring import Compatibility, CriterionScore, compatibility


def criteria():
    return RoommateSearchCriteria(
        city="hcm",
        preferences={
            "areas": {"value": {"area_ids": ["city:hcm"]}},
            "budget": {"value": {"max_vnd": 5000000, "fee_basis": "rent_only"}},
            "smoking": {"value": "no_smoking"},
            "pets_allowed": {"value": False},
        },
    )


def facts(**traits):
    return ProfileFacts(
        city="hcm", area_ids=("city:hcm",), budget={"max_vnd": 4000000, "fee_basis": "rent_only"}, self_traits=traits
    )


def test_four_known_two_lifestyle_and_coverage_gate():
    full = facts(smoking="non_smoker", has_pets=False)
    published = publish_score(criteria(), full, compatibility(criteria().preferences, full))
    assert published.score == 100 and published.label == "high"
    partial = facts(smoking="non_smoker")
    hidden = publish_score(criteria(), partial, compatibility(criteria().preferences, partial))
    assert hidden.score is None and hidden.label is None
    assert "pets_allowed" in hidden.missing


def test_raw_threshold_does_not_use_rounded_display_number():
    full = facts(smoking="non_smoker", has_pets=False)
    calculated = compatibility(criteria().preferences, full)
    boundary = Compatibility(79.5, calculated.coverage, calculated.factors)
    published = publish_score(criteria(), full, boundary)
    assert published.score == 80 and published.label == "medium"


def test_partial_order_ignores_hidden_lifestyle_and_sorts_before_pagination():
    now = datetime(2026, 10, 7, tzinfo=UTC)

    def record(identifier, smoking):
        return ProfileRecord(
            owner_id=identifier,
            version=1,
            state="active",
            updated_at=now,
            confirmed_at=now,
            expires_at=now + timedelta(days=30),
            content=RoommateProfile(facts=facts(smoking=smoking)),
        )

    results = ranked(criteria(), [record("z", "non_smoker"), record("a", "indoors")])
    assert [item.profile.profile_id for item in results] == ["a", "z"]
    assert all(item.compatibility.score is None for item in results)


def test_coverage_and_lifestyle_conditions_independent():
    full = facts(smoking="non_smoker", has_pets=False)
    factors = {
        "areas": CriterionScore(1, True, 20),
        "budget": CriterionScore(1, True, 20),
        "smoking": CriterionScore(1, True, 10),
        "pets_allowed": CriterionScore(0.5, False, 10),
    }
    assert publish_score(criteria(), full, Compatibility(80, 0.99, factors)).score is None
