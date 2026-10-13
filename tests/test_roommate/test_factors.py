import pytest
from relohome_roommate.factors import factor
from relohome_roommate.models import ProfileFacts, RoommateProfile
from relohome_roommate.scoring import compatibility


def prefs(**values):
    return RoommateProfile(preferences={key: {"value": value} for key, value in values.items()}).preferences


def test_budget_and_date_factor_matrix():
    budget = prefs(budget={"max_vnd": 4000000, "fee_basis": "rent_only"}).budget.value
    facts = ProfileFacts(budget={"min_vnd": 5000000, "max_vnd": 6000000, "fee_basis": "rent_only"})
    assert factor("budget", budget, facts) == 0.75
    wanted = prefs(move_in={"kind": "date", "start": "2026-10-07"}).move_in.value
    assert factor("move_in", wanted, ProfileFacts(move_in={"kind": "date", "start": "2026-10-22"})) == 0.5


@pytest.mark.parametrize("value,expected", [("daily", 1), ("several_times_week", 0.5), ("weekly", 0)])
def test_cleanliness_behaviour_distance(value, expected):
    wanted = prefs(cleanliness="daily").cleanliness.value
    assert factor("cleanliness", wanted, ProfileFacts(self_traits={"cleanliness": value})) == expected


def test_unknown_keeps_denominator_and_determinism():
    preferences = prefs(areas={"area_ids": ["a"]}, smoking="no_smoking", pets_allowed=False)
    facts = ProfileFacts(city="hcm", area_ids=("a",), self_traits={"smoking": "non_smoker"})
    score = compatibility(preferences, facts)
    assert score.raw == 87.5
    assert score.coverage == 0.75
    assert score == compatibility(preferences, facts)
    assert score.factors["pets_allowed"].known is False


def test_no_preferences_no_score_and_gender_not_scored():
    assert compatibility(prefs(), ProfileFacts()).raw is None
    assert compatibility(prefs(gender="female"), ProfileFacts(self_traits={"gender": "female"})).raw is None


def test_budget_basis_unknown_not_mismatch_score():
    score = compatibility(prefs(budget={"max_vnd": 4}), ProfileFacts(budget={"max_vnd": 4}))
    assert score.raw == 50
    assert score.coverage == 0
