from dataclasses import dataclass
from datetime import datetime

from relohome_roommate.clock import utc
from relohome_roommate.models import ProfileFacts, RoommatePreferences, RoommateSearchCriteria
from relohome_roommate.normalization import budget_overlap, date_overlap, quiet_overlap
from relohome_roommate.policy import NeedKind, PreferenceStrength, ProfileState, SmokingHabit, SmokingTolerance
from relohome_roommate.ports import ProfileRecord


@dataclass(frozen=True)
class Eligibility:
    passed: bool
    reasons: tuple[str, ...] = ()


def preference_match(name: str, wanted, actual: ProfileFacts) -> bool | None:
    if name == "areas":
        if not actual.area_ids or actual.city is None:
            return None
        return f"city:{actual.city.value}" in wanted.area_ids or bool(set(wanted.area_ids) & set(actual.area_ids))
    if name == "budget":
        return budget_overlap(wanted, actual.budget)
    if name == "move_in":
        return date_overlap(wanted, actual.move_in)
    if name == "quiet_hours":
        value = quiet_overlap(wanted, actual.self_traits.quiet_hours)
        return None if value is None else value == 1
    if name == "smoking":
        value = actual.self_traits.smoking
        if value is None:
            return None
        if wanted is SmokingTolerance.NO_SMOKING:
            return value is SmokingHabit.NON_SMOKER
        if wanted is SmokingTolerance.OUTDOORS_ONLY:
            return value is not SmokingHabit.INDOORS
        return True
    if name == "pets_allowed":
        value = actual.self_traits.has_pets
        return None if value is None else wanted or not value
    value = getattr(actual.self_traits, name)
    return None if value is None else value == wanted


def hard_failures(preferences: RoommatePreferences, actual: ProfileFacts, prefix: str = "viewer") -> tuple[str, ...]:
    failures = []
    for name in type(preferences).model_fields:
        preference = getattr(preferences, name)
        if preference and preference.strength is PreferenceStrength.HARD:
            result = preference_match(name, preference.value, actual)
            if result is not True:
                failures.append(f"{prefix}.{name}.{'unknown' if result is None else 'unmet'}")
    return tuple(failures)


def need_failures(first: ProfileFacts, second: ProfileFacts) -> tuple[str, ...]:
    if first.need and second.need and first.need.kind is second.need.kind is NeedKind.HAS_ROOM:
        if first.need.willing_to_move is not True and second.need.willing_to_move is not True:
            return ("housing_need.unmet",)
    return ()


def mutual_failures(
    first_facts: ProfileFacts,
    first_prefs: RoommatePreferences,
    second_facts: ProfileFacts,
    second_prefs: RoommatePreferences,
) -> tuple[str, ...]:
    return (
        hard_failures(first_prefs, second_facts)
        + hard_failures(second_prefs, first_facts, "candidate")
        + need_failures(first_facts, second_facts)
    )


def eligible(
    viewer: str,
    criteria: RoommateSearchCriteria,
    candidate: ProfileRecord,
    now: datetime,
    *,
    blocked: bool = False,
    restricted: bool = False,
) -> Eligibility:
    if (
        viewer == candidate.owner_id
        or blocked
        or restricted
        or candidate.state != ProfileState.ACTIVE
        or candidate.expires_at is None
        or utc(now) >= candidate.expires_at
        or candidate.content.facts.city != criteria.city
    ):
        return Eligibility(False, ("unavailable",))
    reasons = mutual_failures(
        criteria.self_facts, criteria.preferences, candidate.content.facts, candidate.content.preferences
    )
    return Eligibility(not reasons, reasons)
