"""Local-only configuration boundary. Runtime services never read dotenv files."""

import os
from pathlib import Path
from urllib.parse import quote

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]
SYSTEM_KEYS = {
    "PATH",
    "HOME",
    "USERPROFILE",
    "SYSTEMROOT",
    "WINDIR",
    "TEMP",
    "TMP",
    "TMPDIR",
    "PATHEXT",
    "COMSPEC",
    "PYTHONPATH",
    "PYTHONIOENCODING",
    "LD_LIBRARY_PATH",
    "VIRTUAL_ENV",
    "TERM",
    "NO_COLOR",
}


def load_config(env_file=None):
    path = Path(env_file).expanduser().resolve() if env_file is not None else ROOT / ".env.local"
    if not path.is_file():
        raise ValueError(f"Missing local configuration: {path}. Run npm run dev:init or pass --env-file PATH.")
    # Literal values: mapping/derivation happens here, never through ${VAR} expansion.
    values = {k: v for k, v in dotenv_values(path, interpolate=False).items() if v is not None}
    values.update(os.environ)
    for alias in ("MCP_AUTH_TOKEN", "LOCATION_MCP_AUTH_TOKEN"):
        if values.get(alias) and values[alias] != values.get("LOCATION_MCP_TOKEN"):
            raise ValueError(f"Remove {alias} from local configuration/environment; use LOCATION_MCP_TOKEN once.")
    for key, value in values.items():
        if key.endswith("_PORT") and value and (not value.isdigit() or not 1 <= int(value) <= 65535):
            raise ValueError(f"{key} must be an integer between 1 and 65535")
    values["MCP_AUTH_TOKEN"] = values.get("LOCATION_MCP_TOKEN", "")
    values["LOCATION_MCP_AUTH_TOKEN"] = values.get("LOCATION_MCP_TOKEN", "")
    for name, port in (
        ("LOCATION", "MCP_PORT"),
        ("MOVING", "MOVING_MCP_PORT"),
        ("FLIGHT", "FLIGHT_MCP_PORT"),
        ("PAYMENT", "PAYMENT_MCP_PORT"),
    ):
        if not values.get(name + "_MCP_URL"):
            defaults = {"LOCATION": "4300", "MOVING": "4400", "FLIGHT": "8765", "PAYMENT": "8766"}
            values[name + "_MCP_URL"] = f"http://127.0.0.1:{values.get(port) or defaults[name]}/mcp"
    if not values.get("MOVING_APPROVAL_URL"):
        values["MOVING_APPROVAL_URL"] = (
            f"http://127.0.0.1:{values.get('MOVING_API_PORT') or '4200'}/v1/internal/moving/approvals"
        )
    values.setdefault("SIU_PLATFORM_API_URL", f"http://127.0.0.1:{values.get('PLATFORM_API_PORT') or '4100'}/v1")
    return values


def scope_environment(component, values):
    """Expose service production names, with no unrelated provider or admin secrets."""
    component = {"migrate": "migration", "check": "platform"}.get(component, component)
    prefixes = {
        "api": ("APP_", "AGENT_", "LOCATION_", "MOVING_", "ROOMMATE_", "HOUSING_", "CHROMA_"),
        "ui": ("SIU_", "ROOMMATE_", "HOUSING_", "APP_"),
        "location": ("MCP_", "OSRM_"),
        "platform": ("PLATFORM_", "OSRM_", "HOUSING_"),
        "migration": ("POSTGRES_", "OSRM_", "POI_", "OSM_", "HOUSING_"),
        "moving": ("MOVING_", "AHAMOVE_"),
        "moving-api": ("MOVING_", "AHAMOVE_"),
        "moving-migration": ("MOVING_DB_",),
        "moving-stack": ("MOVING_", "AHAMOVE_"),
        "flight-demo": (),
        "payment-demo": (),
        "flight": ("FLIGHT_",),
        "payment": ("PAYMENT_",),
        "intake": ("INTAKE_",),
        "orchestrator": ("ORCHESTRATOR_",),
        "web": ("VITE_",),
        "map": ("VITE_",),
        "database": ("POSTGRES_", "MCP_", "OSRM_"),
    }
    if component not in prefixes:
        raise ValueError(f"Unknown local component: {component}")
    allowed = set(SYSTEM_KEYS)
    allowed.update({"RUN_AHAMOVE_STAGING_INTEGRATION", "RUN_MOVING_NATIVE_INTEGRATION"})
    if component in {"location", "platform", "migration", "moving", "moving-api"}:
        allowed.update(
            {
                "POSTGRES_HOST",
                "POSTGRES_PORT",
                "POSTGRES_DB",
                "POSTGRES_APP_USER",
                "POSTGRES_APP_PASSWORD",
                "COMMUTE_CANDIDATE_LIMIT",
            }
        )
    if component in {"api", "intake", "orchestrator"}:
        allowed.update({"OPENAI_API_KEY", "OPENAI_BASE_URL", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY", "LOG_LEVEL"})
    if component == "api":
        allowed.update(
            {
                "FLIGHT_MCP_URL",
                "FLIGHT_MCP_AUTH_TOKEN",
                "PAYMENT_MCP_URL",
                "PAYMENT_MCP_AUTH_TOKEN",
                "PAYMENT_SIMULATION_ENABLED",
                "PAYMENT_SOURCE_KIND",
                "PAYMENT_TESTER_CONFIRM_ENABLED",
                "PAYMENT_TESTER_USER_IDS",
                "PAYMENT_RECONCILE_GRACE_SECONDS",
                "PAYMENT_RECONCILE_ACTIVE_SECONDS",
                "PAYMENT_RECONCILE_MIN_SECONDS",
                "PAYMENT_RECONCILE_MAX_SECONDS",
                "CORS_ORIGINS",
                "DATABASE_URL",
                "MODEL_NAME",
                "LLM_TEMPERATURE",
            }
        )
    if component in {"flight-demo", "payment-demo"}:
        prefix = "FLIGHT" if component == "flight-demo" else "PAYMENT"
        allowed.update(
            {prefix + "_MCP_URL", prefix + "_MCP_AUTH_TOKEN", prefix + "_MOCK_MCP_URL", prefix + "_LIVE_MCP_URL"}
        )
    if component == "ui":
        allowed.update({"LIFEFLOW_API_BASE_URL", "AGENT_API_TOKEN"})
    if component == "platform":
        allowed.update({"AGENT_API_TOKEN", "HOST_TERMS_VERSION"})
    if component == "migration":
        allowed.update({"ADMIN_AREA_SOURCE_PATH", "BOUNDARY_SOURCE_DIR", "HOST_TERMS_VERSION"})
    env = {k: v for k, v in values.items() if k.upper() in allowed or k.startswith(prefixes[component])}
    # Canonical local names never become part of the runtime contract.
    env.pop("LOCATION_MCP_TOKEN", None)
    if component in {"api", "moving", "moving-api"}:
        for key in list(env):
            if key.startswith("MOVING_DB_") or key == "MOVING_DATABASE_ADMIN_URL":
                env.pop(key)
    if component == "api":
        env.pop("MOVING_DATABASE_URL", None)
    if component == "moving-stack":
        env["MOVING_MCP_PUBLISHED_PORT"] = values.get("MOVING_MCP_PORT") or "4400"
        env["MOVING_API_PUBLISHED_PORT"] = values.get("MOVING_API_PORT") or "4200"
    if component in {"flight", "payment", "moving"}:
        prefix = {"flight": "FLIGHT_", "payment": "PAYMENT_", "moving": "MOVING_"}[component]
        env["MCP_AUTH_TOKEN"] = values.get(prefix + "MCP_AUTH_TOKEN", "")
    if component in {"moving", "moving-api", "moving-migration"}:
        admin = component == "moving-migration"
        target = "MOVING_DATABASE_ADMIN_URL" if admin else "MOVING_DATABASE_URL"
        role = "ADMIN" if admin else "APP"
        if values.get(target):
            env[target] = values[target]
        elif values.get("MOVING_DB_HOST") and values.get(f"MOVING_DB_{role}_PASSWORD"):
            user = values.get(f"MOVING_DB_{role}_USER", "moving_admin" if admin else "moving_app")
            password = quote(values[f"MOVING_DB_{role}_PASSWORD"], safe="")
            env[target] = (
                f"postgresql://{quote(user, safe='')}:{password}@"
                f"{values.get('MOVING_DB_HOST', '127.0.0.1')}:"
                f"{values.get('MOVING_DB_PORT', '5434')}/{values.get('MOVING_DB_NAME', 'moving')}"
            )
    return env
