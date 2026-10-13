"""Test-run configuration: a clean environment for every test, and inputs for opt-in live tests.

- Every run starts without application variables inherited from the shell.

- Vendor credentials and operator test data (LLM key, AhaMove route/contact, ...)
  come from the ignored `.env.test`, read as data and never loaded into os.environ.
- The running stack under test (URLs, internal tokens, state) comes from pytest options.
- Opt-in flags (RUN_*) and per-run scenario inputs stay explicit in the test command.
A test that starts a service passes these values to it explicitly.
"""

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
LINE = re.compile(r"^([A-Z][A-Z0-9_]*)=(.*)$")
# Running MCP services: option prefix -> (default URL, backend variable prefix).
MCP = {
    "location": ("http://127.0.0.1:4300/mcp", "LOCATION"),
    "flight": ("http://127.0.0.1:8765/mcp", "FLIGHT"),
    "payment": ("http://127.0.0.1:8766/mcp", "PAYMENT"),
    "moving": ("http://127.0.0.1:4400/mcp", "MOVING"),
}
# Generic runtime names and libraries that read the environment on their own.
GENERIC = {"DATABASE_URL", "ADMIN_DATABASE_URL", "INGEST_DATABASE_URL", "MCP_AUTH_TOKEN", "MCP_WRITE_TOKEN"}
LIBRARY_PREFIXES = ("LANGCHAIN_", "LANGSMITH_")
# Known baseline for every run, matching CI; tests set anything else themselves.
BASELINE = {"APP_ENV": "test", "OPENAI_API_KEY": "test-key"}
_options = {}
_env_test = None


def parse_env_file(path):
    """Strict KEY=VALUE reader: comments and blank lines only, values are literal."""
    values = {}
    for number, raw in enumerate(Path(path).read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        match = LINE.match(line)
        if not match:
            raise ValueError(f"{path}:{number}: expected KEY=VALUE")
        values[match.group(1)] = match.group(2)
    return values


def clean_environment(environ, template=ROOT / ".env.example"):
    """Remove every application variable (all names in .env.example), the generic runtime
    names and tracing variables, then apply the test baseline. OS variables are kept."""
    names = set(parse_env_file(template)) | GENERIC
    for name in list(environ):
        if name in names or name.startswith(LIBRARY_PREFIXES):
            del environ[name]
    environ.update(BASELINE)


def add_options(parser):
    group = parser.getgroup("live", "live tests against a running stack")
    group.addoption("--env-test", default=str(ROOT / ".env.test"), help="vendor credentials file")
    group.addoption("--live-api-url", default="http://127.0.0.1:8000/api/v1")
    group.addoption("--live-api-token", default="", help="AGENT_API_TOKEN of the running API")
    group.addoption("--agent-state-dir", default="data/agent-runtime", help="state dir of the running API")
    group.addoption("--platform-api-url", default="http://127.0.0.1:4100/v1")
    group.addoption("--location-db-name", default="lifeflow", help="Location application database")
    group.addoption("--moving-database-url", default="", help="isolated Moving database (native runner)")
    for name, (url, _) in MCP.items():
        group.addoption(f"--{name}-mcp-url", default=url)
        group.addoption(f"--{name}-mcp-token", default="", help=f"token of the running {name} MCP")


def configure(config):
    _options.update(vars(config.option))


def env_test(name, required=True):
    """A vendor credential or operator input from .env.test; skips the test when missing."""
    global _env_test
    if _env_test is None:
        path = Path(_options["env_test"])
        _env_test = parse_env_file(path) if path.is_file() else {}
    value = _env_test.get(name, "")
    if required and not value:
        pytest.skip(f"Set {name} in {_options['env_test']}")
    return value


def _required(option):
    value = _options[option]
    if not value:
        pytest.skip(f"Pass --{option.replace('_', '-')} for this live test")
    return value


def api_url():
    return _options["live_api_url"]


def api_token():
    return _required("live_api_token")


def agent_state_dir():
    return ROOT / _options["agent_state_dir"]


def platform_api_url():
    return _options["platform_api_url"]


def location_db_name():
    return _options["location_db_name"]


def moving_database_url():
    return _required("moving_database_url")


def mcp_url(name):
    return _options[f"{name}_mcp_url"]


def mcp_token(name):
    return _required(f"{name}_mcp_token")


def backend_environment(base, **values):
    """Explicit settings for a backend process a test starts: the clean test environment,
    the vendor LLM key, and every running MCP service passed as an option."""
    env = {**base, "OPENAI_API_KEY": env_test("OPENAI_API_KEY")}
    for name, (_, prefix) in MCP.items():
        if token := _options[f"{name}_mcp_token"]:
            env[f"{prefix}_MCP_URL"] = mcp_url(name)
            env[f"{prefix}_MCP_AUTH_TOKEN"] = token
    env.update(values)
    return env
