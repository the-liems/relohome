from dataclasses import dataclass

from relohome_roommate.factors import factor
from relohome_roommate.models import ProfileFacts, RoommatePreferences

WEIGHTS = {
    "areas": 20,
    "budget": 20,
    "move_in": 15,
    "smoking": 10,
    "pets_allowed": 10,
    "quiet_hours": 10,
    "cleanliness": 10,
    "sociability": 5,
}
LIFESTYLE = frozenset(("smoking", "pets_allowed", "quiet_hours", "cleanliness", "sociability"))


@dataclass(frozen=True)
class CriterionScore:
    value: float
    known: bool
    weight: int


@dataclass(frozen=True)
class Compatibility:
    raw: float | None
    coverage: float
    factors: dict[str, CriterionScore]


def compatibility(preferences: RoommatePreferences, facts: ProfileFacts) -> Compatibility:
    factors = {}
    for name, weight in WEIGHTS.items():
        preference = getattr(preferences, name)
        if preference is not None:
            value = factor(name, preference.value, facts)
            factors[name] = CriterionScore(0.5 if value is None else value, value is not None, weight)
    total = sum(item.weight for item in factors.values())
    if not total:
        return Compatibility(None, 0.0, factors)
    return Compatibility(
        100 * sum(item.value * item.weight for item in factors.values()) / total,
        sum(item.weight for item in factors.values() if item.known) / total,
        factors,
    )
