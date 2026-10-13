"""Translate service city IDs to catalog search names, not to coordinates.

These IDs are the supported routing/Roommate contract vocabulary. Unknown names
are passed through so Location can resolve them from its real catalog.
"""

CITY_SEARCH_NAMES = {
    "hanoi": "Hà Nội",
    "hcm": "Hồ Chí Minh",
    "danang": "Đà Nẵng",
}


def city_search_text(value: str) -> str:
    text = value.strip()
    return CITY_SEARCH_NAMES.get(text.casefold(), text)
