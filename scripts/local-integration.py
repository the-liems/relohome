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

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.service_environment import MAPPINGS, service_environment

ROOT = Path(__file__).resolve().parents[1]
MAPS = ROOT / "Maps VN" / "LifeFlow"


def environment(component, sandbox_writes=False, payment_demo=False, env_file=None, staging=True):
    path = Path(env_file).expanduser().resolve() if env_file is not None else ROOT / ".env.local"
    if not path.is_file():
        raise ValueError(f"Missing local configuration: {path}. Run npm run dev:init or pass --env-file PATH.")
    env = {**{k: v for k, v in dotenv_values(path, interpolate=False).items() if v is not None}, **os.environ}
    if staging and component in {"api", "ui"} and env.get("APP_ENV", "development") != "production":
        # Local-only opt-out default. Runtime still requires the trusted token,
        # and explicit ROOMMATE_ENABLED=false is respected. Do not grant any
        # existing account moderation privileges automatically.
        env.setdefault("ROOMMATE_ENABLED", "true")
        env.setdefault("ROOMMATE_MODERATORS", "local-roommate-moderator")
        # Chọn nhiều căn để hẹn xem (housing-viewing-design); đặt HOUSING_VIEWING_ENABLED=false để tắt.
        env.setdefault("HOUSING_VIEWING_ENABLED", "true")
    if staging:
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
    child_env = service_environment(component, env, os.environ)
    child_env["PYTHONPATH"] = str(ROOT)
    child_env["PYTHONIOENCODING"] = "utf-8"
    return child_env


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "component",
        choices=[*MAPPINGS, "check"],
    )
    parser.add_argument("--env-file", type=Path, help="Use this file instead of repository-root .env.local")
    parser.add_argument("--port", type=int, help="Override API/UI port to avoid other local applications")
    parser.add_argument(
        "--sandbox-writes", action="store_true", help="Allow explicit confirmed sandbox transactions; never production"
    )
    parser.add_argument(
        "--payment-demo",
        action="store_true",
        help="App checkout demo: ZaloPay sandbox payments, simulated flight tickets, tester 'paid' control",
    )
    parser.add_argument("--cwd", type=Path, help="Command working directory, relative to the repository root")
    argv = sys.argv[1:]
    custom_command = None
    if "--" in argv:
        split = argv.index("--")
        custom_command, argv = argv[split + 1 :], argv[:split]
        if not custom_command:
            parser.error("Expected a command after --")
    args = parser.parse_args(argv)
    try:
        child_env = environment(
            args.component, args.sandbox_writes, args.payment_demo, args.env_file, staging=custom_command is None
        )
    except ValueError as error:
        parser.error(str(error))
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
    command = custom_command or commands.get(args.component)
    if not command:
        parser.error("This component requires a command after --")
    if command[0] == "python":
        command[0] = sys.executable
    if custom_command is None and command[0] == "node":
        if shutil.which("node") is None:
            parser.error("Node.js is not on PATH. Install Node.js 24+ and reopen the terminal.")
        if not (MAPS / command[1]).is_file():
            parser.error("Missing LifeFlow build. At repository root, run npm ci and npm run build.")
    cwd = (
        ROOT / args.cwd
        if args.cwd
        else ROOT
        if custom_command or args.component in {"api", "ui", "flight", "payment"}
        else MAPS
    )
    if os.name != "nt":
        os.chdir(cwd)
        os.execvpe(command[0], command, child_env)
    sys.exit(
        subprocess.call(
            command,
            env=child_env,
            cwd=cwd,
        )
    )


if __name__ == "__main__":
    main()
