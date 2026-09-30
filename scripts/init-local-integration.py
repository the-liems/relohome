"""Generate private local credentials once. Never overwrite existing configuration."""

import secrets
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    target = ROOT / "data/integration.env"
    target.parent.mkdir(exist_ok=True)
    values = {
        "POSTGRES_DB": "lifeflow_verified",
        "POSTGRES_ADMIN_USER": "lf_local_admin",
        "POSTGRES_APP_USER": "lf_local_app",
        "POSTGRES_INGEST_USER": "lf_local_ingest",
        "POSTGRES_HOST": "127.0.0.1",
        "POSTGRES_PORT": "5544",
        "MCP_HOST": "127.0.0.1",
        "MCP_PORT": "4300",
        "LOCATION_MCP_URL": "http://127.0.0.1:4300/mcp",
        "MOVING_MCP_URL": "http://127.0.0.1:4400/mcp",
        "MOVING_APPROVAL_URL": "http://127.0.0.1:4200/v1/internal/moving/approvals",
        "FLIGHT_MCP_STDIO": "true",
        "FLIGHT_DB_PATH": "data/integration-flights.db",
    }
    for name in (
        "POSTGRES_ADMIN_PASSWORD",
        "POSTGRES_APP_PASSWORD",
        "POSTGRES_INGEST_PASSWORD",
        "MCP_AUTH_TOKEN",
        "MOVING_MCP_AUTH_TOKEN",
        "MOVING_MCP_WRITE_TOKEN",
        "MOVING_APPROVAL_TOKEN",
        "AGENT_API_TOKEN",
    ):
        values[name] = secrets.token_urlsafe(32)
    values["LOCATION_MCP_AUTH_TOKEN"] = values["MCP_AUTH_TOKEN"]
    try:
        with target.open("x", encoding="utf-8") as output:
            output.write("\n".join(f"{k}={v}" for k, v in values.items()) + "\n")
    except FileExistsError:
        raise SystemExit(
            "Configuration exists; retained unchanged. Do not rotate DB credentials accidentally."
        ) from None
    (ROOT / "data/empty.env").touch(exist_ok=True)
    print("Created ignored data/integration.env. Keep it private; provider keys belong in root .env.")


if __name__ == "__main__":
    main()
