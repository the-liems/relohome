from datetime import date

import pytest
from relohome_roommate.location_catalog import AreaCatalog
from relohome_roommate.models import BudgetRange, MoveInWindow, QuietHours
from relohome_roommate.normalization import budget_overlap, date_overlap, quiet_overlap


def test_canonical_city_area_membership():
    catalog = AreaCatalog({"osm:relation:123": "hcm", "osm:relation:456": "hanoi"})
    catalog.validate("hcm", ("osm:relation:123",))
    with pytest.raises(ValueError):
        catalog.validate("danang", ("osm:relation:123",))
    with pytest.raises(ValueError):
        catalog.validate("hcm", ("invented",))


def test_budget_fee_basis_and_inclusive_point():
    fixed = BudgetRange(min_vnd=3000000, max_vnd=3000000, fee_basis="rent_only")
    assert budget_overlap(fixed, fixed) is True
    assert budget_overlap(fixed, fixed.model_copy(update={"fee_basis": None})) is None
    assert budget_overlap(fixed, BudgetRange(max_vnd=2000000, fee_basis="rent_only")) is False


def test_date_flexible_and_range_overlap():
    flexible = MoveInWindow(kind="flexible")
    exact = MoveInWindow(kind="date", start=date(2026, 10, 7))
    assert date_overlap(flexible, exact) is True
    assert date_overlap(exact, MoveInWindow(kind="range", start=date(2026, 10, 7), end=date(2026, 10, 9))) is True
    assert date_overlap(exact, MoveInWindow(kind="date", start=date(2026, 10, 8))) is False


def test_quiet_hours_midnight_and_partial_overlap():
    wanted = QuietHours(start="22:00", end="06:00")
    assert quiet_overlap(wanted, wanted) == 1
    assert quiet_overlap(wanted, QuietHours(start="02:00", end="06:00")) == 0.5
    assert quiet_overlap(wanted, QuietHours(start="08:00", end="12:00")) == 0
