"""Create local configuration from the committed template without replacing credentials."""

import argparse
import os
import re
import secrets
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GENERATED = {
    "POSTGRES_ADMIN_PASSWORD",
    "POSTGRES_APP_PASSWORD",
    "POSTGRES_INGEST_PASSWORD",
    "LOCATION_MCP_AUTH_TOKEN",
    "MOVING_MCP_AUTH_TOKEN",
    "MOVING_MCP_WRITE_TOKEN",
    "MOVING_APPROVAL_TOKEN",
    "AGENT_API_TOKEN",
    "FLIGHT_MCP_AUTH_TOKEN",
    "PAYMENT_MCP_AUTH_TOKEN",
    "MOVING_DB_ADMIN_PASSWORD",
    "MOVING_DB_APP_PASSWORD",
    "AHAMOVE_WEBHOOK_SECRET",
}


def initialize(target):
    if target.exists():
        raise ValueError(f"Configuration exists; retained unchanged: {target}")
    legacy = [
        ROOT / ".env",
        ROOT / "data/integration.env",
        ROOT / "Maps VN/LifeFlow/.env",
        ROOT / "Maps VN/LifeFlow/.runtime/moving-secrets.json",
    ]
    if any(path.is_file() for path in legacy):
        raise ValueError(
            "Existing local configuration found. Copy .env.example to .env.local and migrate existing "
            "values as documented in docs/runbooks/local-mvp.md; no credentials were generated."
        )
    template = (ROOT / ".env.example").read_text(encoding="utf-8")

    def replace(match):
        key, value = match.groups()
        return f"{key}={secrets.token_urlsafe(32)}" if key in GENERATED and not value else match.group(0)

    rendered = re.sub(r"^([A-Z][A-Z0-9_]*)=(.*)$", replace, template, flags=re.MULTILINE)
    with os.fdopen(os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w", encoding="utf-8") as output:
        output.write(rendered)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, default=ROOT / ".env.local")
    args = parser.parse_args()
    try:
        initialize(args.env_file.expanduser().resolve())
    except (ValueError, OSError) as error:
        parser.error(str(error))
    print("Created local configuration. Fill provider keys before starting their services.")


if __name__ == "__main__":
    main()
