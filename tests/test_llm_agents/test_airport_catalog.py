"""Actual checked-in airport catalog; no provider stubs."""

from relohome_flight.catalog import find_airports


def test_full_city_names_resolve_actual_catalog():
    for name in ("Thành phố Hồ Chí Minh", "TP. Hồ Chí Minh", "Hồ Chí Minh", "SGN"):
        assert [a.code for a in find_airports(name)] == ["SGN"]
    assert [a.code for a in find_airports("Thành phố Hà Nội")] == ["HAN"]
    assert [a.code for a in find_airports("Thành phố Đà Nẵng")] == ["DAD"]
    assert find_airports("Thành phố không có trong catalog") == []
