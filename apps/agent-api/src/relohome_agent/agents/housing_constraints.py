"""Shared graph-to-Housing filter names; provider schema remains authoritative."""

AMENITIES = frozenset(
    "air_conditioning internet refrigerator washing_machine hot_water kitchen allow_cooking bed wardrobe desk elevator security parking balcony natural_light private_bathroom shared_bathroom pet_friendly gym swimming_pool".split()
)

HOUSING_NUMERIC_FILTERS = (
    "min_bedrooms",
    "max_bedrooms",
    "min_bathrooms",
    "min_area_m2",
    "max_area_m2",
)
HOUSING_INPUT_KEYS = (
    "housing_mode",
    "listing_ids",
    "city",
    "district",
    "near",
    "search_radius_m",
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
    "limit",  # user-requested result count; presentation bound, never a relaxed filter
    *HOUSING_NUMERIC_FILTERS,
)
