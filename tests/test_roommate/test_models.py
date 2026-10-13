from datetime import date, time

import pytest
from pydantic import ValidationError
from relohome_roommate.models import (
    AreaSelection,
    BudgetRange,
    FeeBasis,
    HousingNeed,
    MoveInWindow,
    Preference,
    QuietHours,
    RoommatePreferences,
    RoommateProfile,
    RoommateSearchCriteria,
    SelfTraits,
)


def test_budget_keeps_unknown_fee_basis_and_has_no_conversion():
    budget = BudgetRange(min_vnd=2_000_000, max_vnd=3_000_000)
    assert budget.fee_basis is None
    assert budget.min_vnd == 2_000_000
    assert budget.max_vnd == 3_000_000
    inclusive = BudgetRange(min_vnd=3_000_000, max_vnd=3_000_000, fee_basis="including_fees")
    assert inclusive.fee_basis is FeeBasis.INCLUDING_FEES


@pytest.mark.parametrize(
    "values",
    [
        {"min_vnd": 3, "max_vnd": 2},
        {"min_vnd": -1, "max_vnd": 2},
        {"max_vnd": 0},
        {"max_vnd": True},
        {"max_vnd": 2.5},
        {"max_vnd": "3000000"},
    ],
)
def test_budget_rejects_invalid_ranges_and_non_integer_vnd(values):
    with pytest.raises(ValidationError):
        BudgetRange.model_validate(values)


def test_unset_preference_differs_from_explicit_acceptance():
    preference = Preference[bool](value=True)
    assert preference.value is True
    assert preference.strength == "soft"
    required = Preference[bool](value=False, strength="hard")
    assert required.value is False
    assert required.strength == "hard"


def test_move_in_date_range_and_flexible_are_distinct():
    exact = MoveInWindow(kind="date", start=date(2026, 11, 1))
    window = MoveInWindow(kind="range", start=date(2026, 11, 1), end=date(2026, 11, 10))
    flexible = MoveInWindow(kind="flexible")
    assert exact.end is None
    assert window.end == date(2026, 11, 10)
    assert flexible.start is None and flexible.end is None


@pytest.mark.parametrize(
    "values",
    [
        {"kind": "date"},
        {"kind": "date", "start": "2026-11-01", "end": "2026-11-01"},
        {"kind": "range", "start": "2026-11-01"},
        {"kind": "range", "start": "2026-11-10", "end": "2026-11-01"},
        {"kind": "flexible", "start": "2026-11-01"},
    ],
)
def test_move_in_rejects_ambiguous_or_incomplete_dates(values):
    with pytest.raises(ValidationError):
        MoveInWindow.model_validate(values)


def test_quiet_hours_allow_crossing_midnight():
    hours = QuietHours(start=time(22), end=time(7))
    assert hours.start == time(22)
    assert hours.end == time(7)


@pytest.mark.parametrize("values", [{"start": "07:00", "end": "07:00"}, {"start": "22:00+07:00", "end": "07:00"}])
def test_quiet_hours_reject_ambiguous_or_zoned_local_time(values):
    with pytest.raises(ValidationError):
        QuietHours.model_validate(values)


@pytest.mark.parametrize(
    "values",
    [
        {"start": "22:00:00", "end": "22:00:30"},
        {"start": "22:00:30", "end": "07:00:00"},
        {"start": "22:00:00.000001", "end": "07:00:00"},
        {"start": "22:00:00", "end": "07:00:00.000001"},
    ],
)
def test_quiet_hours_reject_subminute_values_instead_of_treating_them_as_a_full_day(values):
    with pytest.raises(ValidationError, match="minute precision"):
        QuietHours.model_validate(values)


def test_quiet_hours_accept_explicit_zero_seconds_and_preserve_minute_precision():
    assert QuietHours(start="22:00:00", end="07:00:00") == QuietHours(start="22:00", end="07:00")


def test_housing_need_preserves_unknown_willingness_to_move():
    assert HousingNeed(kind="has_room").willing_to_move is None
    assert HousingNeed(kind="has_room", willing_to_move=False).willing_to_move is False
    assert HousingNeed(kind="looking_together").willing_to_move is None


@pytest.mark.parametrize(
    "values", [{"kind": "has_room", "willing_to_move": "false"}, {"kind": "looking_together", "willing_to_move": True}]
)
def test_housing_need_rejects_coercion_or_irrelevant_willingness(values):
    with pytest.raises(ValidationError):
        HousingNeed.model_validate(values)


@pytest.mark.parametrize("areas", [[], [""], ["   "], ["area-1", "area-1"]])
def test_explicit_area_preference_requires_distinct_nonempty_ids(areas):
    with pytest.raises(ValidationError):
        AreaSelection(area_ids=areas)


def test_profile_can_be_private_incomplete_draft_without_inferred_traits():
    profile = RoommateProfile(display_name="  Linh  ")
    assert profile.display_name == "Linh"
    assert profile.facts.city is None
    assert profile.facts.area_ids == ()
    assert profile.facts.need is None
    assert profile.facts.budget is None
    assert profile.facts.move_in is None
    assert all(value is None for value in profile.facts.self_traits.model_dump().values())
    assert all(value is None for value in profile.preferences.model_dump().values())


def test_search_separates_self_traits_from_desired_roommate_traits():
    criteria = RoommateSearchCriteria(
        city="hcm",
        self_facts={"self_traits": {"smoking": "outdoors_only", "has_pets": True}},
        preferences={
            "smoking": {"value": "no_smoking", "strength": "hard"},
            "pets_allowed": {"value": False, "strength": "soft"},
        },
    )
    assert criteria.self_facts.self_traits.smoking == "outdoors_only"
    assert criteria.self_facts.self_traits.has_pets is True
    assert criteria.preferences.smoking.value == "no_smoking"
    assert criteria.preferences.smoking.strength == "hard"
    assert criteria.preferences.pets_allowed.value is False
    assert criteria.preferences.pets_allowed.strength == "soft"


@pytest.mark.parametrize("city", ["hcm", "hanoi", "danang"])
def test_search_supports_one_city_without_an_area_preference(city):
    search = RoommateSearchCriteria(city=city)
    assert search.city == city
    assert search.preferences.areas is None
    assert search.self_facts.city is None


def test_profile_keeps_multiple_area_ids_in_declared_city():
    profile = RoommateProfile(
        facts={
            "city": "hanoi",
            "area_ids": ["area-a", "area-b"],
            "need": {"kind": "has_room", "willing_to_move": False},
        }
    )
    assert profile.facts.area_ids == ("area-a", "area-b")
    assert profile.facts.need.willing_to_move is False


@pytest.mark.parametrize(
    "values",
    [
        {"city": "hue"},
        {"city": ["hcm", "hanoi"]},
        {"city": "hcm", "self_facts": {"city": "hanoi"}},
        {"city": "hcm", "preferences": {"areas": {"value": {"area_ids": []}}}},
    ],
)
def test_search_rejects_unsupported_or_ambiguous_scope(values):
    with pytest.raises(ValidationError):
        RoommateSearchCriteria.model_validate(values)


@pytest.mark.parametrize("facts", [{"area_ids": ["area-a"]}, {"city": "hcm", "area_ids": ["area-a", "area-a"]}])
def test_profile_area_ids_require_explicit_city_and_no_duplicates(facts):
    with pytest.raises(ValidationError):
        RoommateProfile(facts=facts)


@pytest.mark.parametrize("value", ["false", 0, "unknown"])
def test_pet_traits_do_not_coerce_missing_or_text_into_boolean(value):
    with pytest.raises(ValidationError):
        SelfTraits(has_pets=value)
    with pytest.raises(ValidationError):
        RoommatePreferences(pets_allowed={"value": value})


def test_unknown_is_not_flexible_or_explicit_acceptance():
    profile = RoommateProfile()
    assert profile.facts.move_in is None
    assert profile.preferences.pets_allowed is None
    declared = RoommateProfile(facts={"move_in": {"kind": "flexible"}}, preferences={"pets_allowed": {"value": True}})
    assert declared.facts.move_in.kind == "flexible"
    assert declared.preferences.pets_allowed.value is True


def test_explicit_preference_cannot_have_unknown_value():
    with pytest.raises(ValidationError):
        RoommatePreferences(pets_allowed={"value": None, "strength": "hard"})


@pytest.mark.parametrize("values", [{"display_name": "   "}, {"introduction": "  "}, {"display_name": "A" * 81}])
def test_supplied_profile_text_is_nonempty_and_bounded(values):
    with pytest.raises(ValidationError):
        RoommateProfile.model_validate(values)


@pytest.mark.parametrize("unexpected", ["contact", "phone", "owner_id", "published", "compatibility_score", "latitude"])
def test_profile_rejects_fields_belonging_to_other_boundaries(unexpected):
    with pytest.raises(ValidationError):
        RoommateProfile.model_validate({unexpected: "untrusted"})


def test_model_rejects_nested_untyped_fields():
    with pytest.raises(ValidationError):
        RoommateProfile(facts={"self_traits": {"inferred_gender": "female"}})
    with pytest.raises(ValidationError):
        RoommatePreferences(smoking={"value": "no_smoking", "score": 100})


def test_json_roundtrip_preserves_unknowns_preference_strength_and_dates():
    criteria = RoommateSearchCriteria(
        city="danang",
        self_facts={"need": {"kind": "looking_together"}, "move_in": {"kind": "date", "start": "2026-11-01"}},
        preferences={"budget": {"value": {"max_vnd": 3_000_000}, "strength": "hard"}},
    )
    restored = RoommateSearchCriteria.model_validate_json(criteria.model_dump_json())
    assert restored == criteria
    assert restored.self_facts.self_traits.gender is None
    assert restored.preferences.budget.value.fee_basis is None
    assert restored.preferences.budget.strength == "hard"


def test_domain_values_cannot_be_changed_after_validation():
    profile = RoommateProfile(facts={"city": "hcm", "area_ids": ["area-a"]})
    with pytest.raises(ValidationError):
        profile.facts.city = "hanoi"
    assert isinstance(profile.facts.area_ids, tuple)
