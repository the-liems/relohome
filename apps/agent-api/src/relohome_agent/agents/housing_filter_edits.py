"""Small typed deltas after semantic Intake; no phrase router, geocoding or provider inference."""

from relohome_agent.agents.common import nfc
from relohome_agent.agents.housing_constraints import AMENITIES, HOUSING_INPUT_KEYS
from relohome_agent.agents.models import HousingFilterPatch

# A patch may clear user filters, never operation/identity, backend pins or viewport.
CLEARABLE_FILTERS = frozenset(HOUSING_INPUT_KEYS) - {
    "housing_mode",
    "listing_ids",
    "city",
    "near_coordinate",
    "near_place_id",
    "bounding_box",
}


def valid_filter_patch(patch: HousingFilterPatch, text: str, new_values: dict) -> bool:
    evidence = nfc(patch.evidence).strip().casefold()
    added, removed, cleared = set(patch.add_amenities), set(patch.remove_amenities), set(patch.clear_fields)
    return bool(
        evidence
        and evidence in nfc(text).casefold()
        and (added or removed or cleared)
        and (added | removed) <= AMENITIES
        and not added & removed
        and cleared <= CLEARABLE_FILTERS
        and not cleared & new_values.keys()
        and not ((added or removed) and ("must_have" in new_values or "must_have" in cleared))
    )


def patched_amenities(previous: list[str], patch: HousingFilterPatch) -> list[str]:
    return list(dict.fromkeys([v for v in previous if v not in patch.remove_amenities] + patch.add_amenities))
