"""Shared graph-to-Housing filter names; provider schema remains authoritative."""

HOUSING_NUMERIC_FILTERS = (
    "min_bedrooms",
    "max_bedrooms",
    "min_bathrooms",
    "min_area_m2",
    "max_area_m2",
)
HOUSING_INPUT_KEYS = (
    "city",
    "district",
    "near",
    "near_place_id",
    "near_coordinate",
    "bounding_box",
    "min_price_vnd",
    "max_price_vnd",
    "room_type",
    "must_have",
    # Proximity is a Housing filter ("gần bệnh viện"): listings with such a place within the radius.
    "nearby_categories",
    "nearby_radius_m",
    *HOUSING_NUMERIC_FILTERS,
)
