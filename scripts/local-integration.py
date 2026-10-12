"""Run one local component with ignored integration configuration; no deployment.

Usage: .venv/Scripts/python scripts/local-integration.py location|platform|moving|moving-api|flight|payment|api|migrate|ui|check
Keep each long-running component in its own terminal. Ctrl+C stops that component.
"""

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]
MAPS = ROOT / "Maps VN" / "LifeFlow"


def environment(component, sandbox_writes=False, payment_demo=False):
    env = {
        **os.environ,
        **{k: v for k, v in dotenv_values(ROOT / ".env").items() if v is not None},
        **{k: v for k, v in dotenv_values(ROOT / "data/integration.env").items() if v is not None},
    }
    if component in {"api", "ui"} and env.get("APP_ENV", "development") != "production":
        # Local-only opt-out default. Runtime still requires the trusted token,
        # and explicit ROOMMATE_ENABLED=false is respected. Do not grant any
        # existing account moderation privileges automatically.
        env.setdefault("ROOMMATE_ENABLED", "true")
        env.setdefault("ROOMMATE_MODERATORS", "local-roommate-moderator")
        # Chọn nhiều căn để hẹn xem (housing-viewing-design); đặt HOUSING_VIEWING_ENABLED=false để tắt.
        env.setdefault("HOUSING_VIEWING_ENABLED", "true")
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
        FLIGHT_MCP_URL=env.get("FLIGHT_MCP_URL", "http://127.0.0.1:8765/mcp"),
        PAYMENT_MCP_URL=env.get("PAYMENT_MCP_URL", "http://127.0.0.1:8766/mcp"),
        PAYMENT_DB_PATH=str(ROOT / "data/integration-payments.db"),
        PAYMENT_REDIRECT_URL="http://localhost:8503/",
        LANGCHAIN_TRACING_V2="false",
        LANGSMITH_TRACING="false",
    )
    if payment_demo:
        # Thanh toán của app (docs/review/payment-design.md): ZaloPay sandbox thu tiền, vé giữ chỗ/xuất vé mô phỏng,
        # chuyển đồ chỉ ghi "đã duyệt". Không bật ghi AhaMove; không bao giờ dùng cho production.
        env.update(
            APP_PAYMENT_DEMO_ENABLED="true",
            FLIGHT_SIMULATION_ENABLED="true",
            PAYMENT_TESTER_CONFIRM_ENABLED=env.get("PAYMENT_TESTER_CONFIRM_ENABLED", "true"),
            APP_ENV="development",
        )
    # Children must not re-load the broad root .env after scoped credentials are removed.
    env["LIFEFLOW_ENV_FILE"] = str(ROOT / "data/empty.env")
    env["PYTHONPATH"] = str(ROOT)
    env["PYTHONIOENCODING"] = "utf-8"
    if component in {"api", "ui"}:
        # Provider credentials and provider databases belong to their services.
        for key in list(env):
            if key.startswith("PAYMENT_ZALOPAY_") or key in {
                "FLIGHT_SERPAPI_API_KEY", "FLIGHT_SEARCH_PROVIDER", "FLIGHT_DB_PATH",
                "FLIGHT_SIMULATION_ENABLED", "PAYMENT_PROVIDER", "PAYMENT_DB_PATH", "PAYMENT_REDIRECT_URL",
            }:
                env.pop(key)
    if component in {"flight", "payment"}:
        prefix = "FLIGHT_" if component == "flight" else "PAYMENT_"
        system_keys = {"PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "PATHEXT", "COMSPEC",
                       "PYTHONPATH", "PYTHONIOENCODING", "LD_LIBRARY_PATH"}
        env = {key: value for key, value in env.items() if key in system_keys or key.startswith(prefix)}
        env["MCP_AUTH_TOKEN"] = env.get(prefix + "MCP_AUTH_TOKEN", "")
    if component in {"location", "platform", "moving", "moving-api"}:
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
            "HOUSING_REVIEW_MIN_COUNT",
        }
        prefixes = ("MCP_", "OSRM_", "PLATFORM_") if component in {"location", "platform"} else ("AHAMOVE_", "MOVING_")
        if component == "platform":
            allowed.update(
                {"POSTGRES_ADMIN_USER", "POSTGRES_ADMIN_PASSWORD", "POSTGRES_INGEST_USER", "POSTGRES_INGEST_PASSWORD"}
            )
            # Housing owner workspace: trusted gateway token and moderator account IDs.
            allowed.update({"AGENT_API_TOKEN", "VIETMAP_API_KEY", "HOUSING_MODERATOR_IDS", "HOST_TERMS_VERSION", "HOUSING_MESSAGE_RATE_PER_MINUTE"})
            allowed.update({"HOUSING_REVIEW_MIN_COUNT", "HOUSING_REVIEW_PATTERN_DAYS", "HOUSING_REVIEW_LOW_STARS",
                            "HOUSING_REVIEW_PATTERN_PROPERTIES", "HOUSING_REVIEW_PATTERN_AUTHORS"})
        env = {k: v for k, v in env.items() if k.upper() in allowed or k.startswith(prefixes)}
        if component == "moving":
            env["MCP_AUTH_TOKEN"] = env.get("MOVING_MCP_AUTH_TOKEN", "")
    return env


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("component", choices=["location", "platform", "moving", "moving-api", "flight", "payment", "api", "migrate", "ui", "check"])
    parser.add_argument("--port", type=int, help="Override API/UI port to avoid other local applications")
    parser.add_argument(
        "--sandbox-writes", action="store_true", help="Allow explicit confirmed sandbox transactions; never production"
    )
    parser.add_argument(
        "--payment-demo",
        action="store_true",
        help="App checkout demo: ZaloPay sandbox payments, simulated flight tickets, tester 'paid' control",
    )
    args = parser.parse_args()
    if args.port is not None and (args.component not in {"api", "ui"} or not 1 <= args.port <= 65535):
        parser.error("--port is valid only for api/ui and must be between 1 and 65535")
    commands = {
        "location": ["node", "mcp-server/dist/http-server.js"],
        "platform": ["node", "platform-api/dist/server.js"],
        "moving": ["node", "moving-mcp-server/dist/http-server.js"],
        "moving-api": ["node", "moving-api/dist/server.js"],
        "flight": [sys.executable, "-m", "src.mcp_servers.flights", "--transport", "streamable-http"],
        "payment": [sys.executable, "-m", "src.mcp_servers.payments", "--transport", "streamable-http"],
        "migrate": ["node", "platform-api/dist/migrate.js"],
        "check": ["node", "scripts/check-local-schema.mjs"],
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
            "uvicorn",
            "Frontend.server:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(args.port or 8503),
            "--workers",
            "1",
        ],
    }
    command = commands[args.component]
    if command[0] == "node":
        if shutil.which("node") is None:
            parser.error("Node.js is not on PATH. Install Node.js 24+ and reopen the terminal.")
        if not (MAPS / command[1]).is_file():
            parser.error("Missing LifeFlow build. At repository root, run npm ci and npm run build.")
    sys.exit(
        subprocess.call(
            command,
            env=environment(
                "platform" if args.component == "check" else args.component,
                args.sandbox_writes,
                args.payment_demo,
            ),
            cwd=ROOT if args.component in {"api", "ui", "flight", "payment"} else MAPS,
        )
    )


if __name__ == "__main__":
    main()
