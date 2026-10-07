"""Reference-only projection shared by Agent prompts and browser history."""

import re


def reference_data(data: dict) -> dict:
    availability = data.get("availability")
    if availability not in {"ready", "disabled", "eligibility_required", "criteria_required"}:
        availability = "criteria_required"
    refs = []
    for item in (data.get("profile_refs") or [])[:50]:
        identifier = item.get("profile_id") if isinstance(item, dict) else None
        if isinstance(identifier, str) and re.fullmatch(r"[A-Za-z0-9_.:-]{1,128}", identifier):
            refs.append({"profile_id": identifier})
    return {"entry": "roommate", "availability": availability, "profile_refs": refs}


def history_projection(value):
    if isinstance(value, list):
        return [history_projection(item) for item in value]
    if not isinstance(value, dict):
        return value
    if value.get("agent") == "roommate" or value.get("type") == "roommate":
        # Whitelist envelope too: no provider-authored snapshot fields outside data.
        result = {
            key: value[key]
            for key in (
                "id",
                "task_id",
                "agent",
                "type",
                "status",
                "source",
                "source_kind",
                "fetched_at",
                "plan_version",
            )
            if key in value
        }
        result["data"] = reference_data(value.get("data") or {})
        return result
    return {key: history_projection(item) for key, item in value.items()}
