"""Model-only projection of observed service details; provider storage stays intact."""

from src.agents.llm_runtime import public_data

PRESENTATION_FIELDS = frozenset({"icon_url", "img_url", "map_icon_url", "map_icon_3d"})
CONSTRAINT_FIELDS = (
    "vehicle_info",
    "max_distance",
    "max_stop_points",
    "max_item_value",
    "max_cod",
    "cross_city",
    "available_districts",
    "opening_hours",
    "truck_ban",
    "require_to",
    "require_request",
    "require_pof",
    "require_pop",
    "require_pod",
)


def service_details_for_model(observed: dict) -> dict:
    def project(item):
        if isinstance(item, dict):
            fields = {}
            for key, value in item.items():
                if key in PRESENTATION_FIELDS:
                    continue
                if key in {"name", "name_en_us"} and item.get("name_vi_vn"):
                    continue
                if key in {"description", "description_en_us"} and item.get("description_vi_vn"):
                    continue
                fields[key] = project(value)
            return fields
        if isinstance(item, list):
            return [project(value) for value in item]
        return item

    result = project(public_data(observed))
    service = observed.get("service", {})
    provider = service.get("provider_data", {})
    # Only observed domain constraints, not dispatch settings/internal URLs/raw payloads.
    if provider:
        result.setdefault("service", {})["provider_constraints"] = project(
            public_data({key: provider[key] for key in CONSTRAINT_FIELDS if key in provider})
        )
    return result
