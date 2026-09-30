"""Run one local component with ignored integration configuration; no deployment.

Usage: .venv/Scripts/python scripts/local-integration.py location|moving|moving-api|api|migrate
Keep each long-running component in its own terminal. Ctrl+C stops that component.
"""

import argparse
import os
import subprocess
import sys
from pathlib import Path

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]
MAPS = ROOT / "Maps VN" / "LifeFlow"


def environment(component, sandbox_writes=False):
    env = {
        **os.environ,
        **{k: v for k, v in dotenv_values(ROOT / ".env").items() if v is not None},
        **{k: v for k, v in dotenv_values(ROOT / "data/integration.env").items() if v is not None},
    }
    env.update(
        AGENT_SUBAGENTS="live",
        AGENT_ALLOW_SIMULATED_TRANSACTIONS="false",
        PAYMENT_SIMULATION_ENABLED="false",
        FLIGHT_SEARCH_PROVIDER="serpapi",
        FLIGHT_SIMULATION_ENABLED="false",
        AHAMOVE_ENV="staging",
        MOVING_ENVIRONMENT="staging",
        AHAMOVE_BASE_URL="https://partner-apistg.ahamove.com/v3",
        AHAMOVE_WRITE_ENABLED="true" if sandbox_writes else "false",
        AHAMOVE_PRODUCTION_ENABLED="false",
        AGENT_WRITES_ENABLED="true" if sandbox_writes else "false",
        AGENT_SANDBOX_PAYMENTS_ENABLED="true" if sandbox_writes else "false",
        PAYMENT_PROVIDER="zalopay",
        PAYMENT_ZALOPAY_ENDPOINT="https://sb-openapi.zalopay.vn/v2",
        PAYMENT_MCP_STDIO="true",
        PAYMENT_MCP_URL="",
        PAYMENT_DB_PATH=str(ROOT / "data/integration-payments.db"),
        PAYMENT_REDIRECT_URL="http://localhost:8503/",
        LANGCHAIN_TRACING_V2="false",
        LANGSMITH_TRACING="false",
    )
    # Children must not re-load the broad root .env after scoped credentials are removed.
    env["LIFEFLOW_ENV_FILE"] = str(ROOT / "data/empty.env")
    env["PYTHONPATH"] = str(ROOT)
    if component in {"location", "moving", "moving-api"}:
        allowed = {
            "PATH",
            "SYSTEMROOT",
            "WINDIR",
            "TEMP",
            "TMP",
            "PATHEXT",
            "COMSPEC",
            "LIFEFLOW_ENV_FILE",
            "POSTGRES_HOST",
            "POSTGRES_PORT",
            "POSTGRES_DB",
            "POSTGRES_APP_USER",
            "POSTGRES_APP_PASSWORD",
        }
        prefixes = ("MCP_", "OSRM_") if component == "location" else ("AHAMOVE_", "MOVING_")
        env = {k: v for k, v in env.items() if k.upper() in allowed or k.startswith(prefixes)}
    return env


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("component", choices=["location", "moving", "moving-api", "api", "migrate", "ui"])
    parser.add_argument("--port", type=int, help="Override API/UI port to avoid other local applications")
    parser.add_argument(
        "--sandbox-writes", action="store_true", help="Allow explicit confirmed sandbox transactions; never production"
    )
    args = parser.parse_args()
    if args.port is not None and (args.component not in {"api", "ui"} or not 1 <= args.port <= 65535):
        parser.error("--port is valid only for api/ui and must be between 1 and 65535")
    commands = {
        "location": ["node", "mcp-server/dist/http-server.js"],
        "moving": ["node", "moving-mcp-server/dist/http-server.js"],
        "moving-api": ["node", "moving-api/dist/server.js"],
        "migrate": ["node", "platform-api/dist/migrate.js"],
        "api": [
            sys.executable,
            "-m",
            "uvicorn",
            "src.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(args.port or 8000),
            "--workers",
            "1",
        ],
        "ui": [
            sys.executable,
            "-m",
            "streamlit",
            "run",
            "src/ui/agent_chat.py",
            "--server.address",
            "127.0.0.1",
            "--server.port",
            str(args.port or 8503),
        ],
    }
    sys.exit(
        subprocess.call(
            commands[args.component],
            env=environment(args.component, args.sandbox_writes),
            cwd=ROOT if args.component in {"api", "ui"} else MAPS,
        )
    )


if __name__ == "__main__":
    main()
