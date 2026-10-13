"""Pure per-service mapping. This module never loads an env file or starts a service."""

import json
from pathlib import Path

MAPPINGS = json.loads((Path(__file__).resolve().parents[1] / "config/local-environment.json").read_text())


def service_environment(component, values, inherited):
    component = {"check": "platform"}.get(component, component)
    if component not in MAPPINGS:
        raise ValueError(f"Unknown service: {component}")
    spec = MAPPINGS[component]
    # Preserve the host environment (Docker/Windows/PATH etc.), but do not let a
    # generic application variable from the parent bypass a service's binding.
    app_prefixes = tuple({prefix for item in MAPPINGS.values() for prefix in item["prefixes"]})
    app_names = {key for item in MAPPINGS.values() for pair in item["variables"].items() for key in pair}
    env = {k: v for k, v in inherited.items() if k not in app_names and not k.startswith(app_prefixes)}
    source = values  # Caller resolves file/shell precedence before mapping.
    env.update({k: v for k, v in source.items() if k.startswith(tuple(spec["prefixes"]))})
    for key in list(env):
        if key in spec.get("exclude", []) or key.startswith(tuple(spec.get("exclude_prefixes", []))):
            env.pop(key)
    # Explicit bindings take precedence over identity/prefix passthrough. Empty
    # optional values are omitted so runtime defaults (e.g. POSTGRES_*) still work.
    for target, key in spec["variables"].items():
        env.pop(target, None)
        if source.get(key):
            env[target] = source[key]
    # Source-only names are never part of the runtime contract.
    for key in (
        "BACKEND_DATABASE_URL",
        "LOCATION_DATABASE_URL",
        "LOCATION_ADMIN_DATABASE_URL",
        "LOCATION_INGEST_DATABASE_URL",
        "LOCATION_TOKEN",
    ):
        env.pop(key, None)
    return env
