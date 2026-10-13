from datetime import date

from relohome_roommate.models import BudgetRange, MoveInWindow, QuietHours
from relohome_roommate.policy import MoveInKind


def budget_overlap(first: BudgetRange | None, second: BudgetRange | None) -> bool | None:
    if first is None or second is None or first.fee_basis is None or first.fee_basis != second.fee_basis:
        return None
    return max(first.min_vnd, second.min_vnd) <= min(first.max_vnd, second.max_vnd)


def date_bounds(value: MoveInWindow) -> tuple[date, date]:
    if value.kind is MoveInKind.FLEXIBLE:
        return date.min, date.max
    return value.start, value.end or value.start


def date_overlap(first: MoveInWindow | None, second: MoveInWindow | None) -> bool | None:
    if first is None or second is None:
        return None
    start_a, end_a = date_bounds(first)
    start_b, end_b = date_bounds(second)
    return max(start_a, start_b) <= min(end_a, end_b)


def quiet_minutes(value: QuietHours) -> set[int]:
    start = value.start.hour * 60 + value.start.minute
    end = value.end.hour * 60 + value.end.minute
    return set(range(start, end)) if start < end else set(range(start, 1440)) | set(range(0, end))


def quiet_overlap(wanted: QuietHours | None, actual: QuietHours | None) -> float | None:
    if wanted is None or actual is None:
        return None
    minutes = quiet_minutes(wanted)
    return len(minutes & quiet_minutes(actual)) / len(minutes)
