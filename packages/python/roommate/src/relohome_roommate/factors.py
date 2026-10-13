from relohome_roommate.eligibility import preference_match
from relohome_roommate.models import ProfileFacts
from relohome_roommate.normalization import budget_overlap, date_bounds, date_overlap, quiet_overlap
from relohome_roommate.policy import Cleanliness, Sociability


def factor(name: str, wanted, actual: ProfileFacts) -> float | None:
    if name == "quiet_hours":
        return quiet_overlap(wanted, actual.self_traits.quiet_hours)
    result = preference_match(name, wanted, actual)
    if result is None:
        return None
    if name == "budget" and budget_overlap(wanted, actual.budget) is False:
        gap = max(wanted.min_vnd, actual.budget.min_vnd) - min(wanted.max_vnd, actual.budget.max_vnd)
        return max(0.0, 1 - gap / max(wanted.max_vnd, 1))
    if name == "move_in" and date_overlap(wanted, actual.move_in) is False:
        first_start, first_end = date_bounds(wanted)
        second_start, second_end = date_bounds(actual.move_in)
        gap = (max(first_start, second_start) - min(first_end, second_end)).days
        return max(0.0, 1 - gap / 30)
    if name in ("cleanliness", "sociability"):
        order = list(Cleanliness if name == "cleanliness" else Sociability)
        return 1 - abs(order.index(wanted) - order.index(getattr(actual.self_traits, name))) / 2
    return float(result)
