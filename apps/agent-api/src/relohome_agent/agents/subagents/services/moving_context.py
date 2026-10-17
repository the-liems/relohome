"""Model-only projection of observed service details; provider storage stays intact."""

import json
from collections import Counter

from relohome_agent.agents.llm_runtime import public_data

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


def selection_catalog_for_model(catalog: dict[str, dict]) -> list[dict]:
    """Facts needed to compare base vehicle options, not an entire provider payload.

    Keep every observed candidate and operational constraint; do not guess capacity
    from IDs, rank by provider order or truncate safety fields. Backend keeps the
    originals for service_selection/estimate. Missing constraints remain unknown.
    Form add-ons already require an explicit service and bypass this selection.
    """
    rows = []
    for service_id, service in catalog.items():
        provider = service.get("provider_data") or {}
        constraints = {key: provider[key] for key in CONSTRAINT_FIELDS if key in provider}
        constraints.update({key: service[key] for key in CONSTRAINT_FIELDS if key in service})
        row = {
            "service_id": service_id,
            "name": service.get("name") or service.get("service_name"),
            "description": service.get("description"),
            "delivery_type": service.get("delivery_type"),
            "cod_limit": service.get("cod_limit"),
            "constraints": constraints,
        }
        if constraints.get("require_request"):
            row["required_request_options"] = service.get("requests", [])
        rows.append(public_data(row))
    return rows


def compact_selection_catalog(rows: list[dict]) -> dict:
    """Lossless defaults / references, never a shortlist or a provider-data mutation.

    Defaults apply only to fields present and identical on EVERY observed service.
    Missing restrictions therefore remain unknown. References share long repeated
    values in subsets; their keys are owned by this projection, not provider data.
    """

    def identity(value):
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)

    # The input is an already-redacted model projection. Clone it before factoring.
    services = json.loads(identity(rows))
    if not services:
        return {"services": services}
    defaults = {}
    for key, value in list(services[0].items()):
        if key not in {"service_id", "constraints"} and all(
            key in row and identity(row[key]) == identity(value) for row in services
        ):
            defaults[key] = value
    constraint_defaults = {}
    for key, value in services[0]["constraints"].items():
        if all(key in row["constraints"] and identity(row["constraints"][key]) == identity(value) for row in services):
            constraint_defaults[key] = value
    if constraint_defaults:
        defaults["constraints"] = constraint_defaults
    for row in services:
        for key in defaults:
            if key != "constraints":
                row.pop(key)
        for key in constraint_defaults:
            row["constraints"].pop(key)

    candidates = []
    for row in services:
        for key in ("description", "required_request_options"):
            if key in row:
                candidates.append((row, "fact_refs", key, identity(row[key])))
        for key, value in row["constraints"].items():
            candidates.append((row, "constraint_refs", key, identity(value)))
    counts = Counter(encoded for _, _, _, encoded in candidates if len(encoded) >= 80)
    facts: dict[str, object] = {}
    references: dict[str, str] = {}
    for row, namespace, key, encoded in candidates:
        if counts[encoded] < 2:
            continue
        if encoded not in references:
            ref = f"f{len(facts)}"
            references[encoded] = ref
            facts[ref] = json.loads(encoded)
        row.setdefault(namespace, {})[key] = references[encoded]
        (row["constraints"] if namespace == "constraint_refs" else row).pop(key)
    result = {"services": services}
    if defaults:
        result["catalog_defaults"] = defaults
    if facts:
        result["catalog_facts"] = facts
    return result


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
