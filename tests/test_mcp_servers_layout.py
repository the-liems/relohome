"""ADR-013/025: Python MCP apps retain their independent container contracts."""

import json
import tomllib
from pathlib import Path

import pytest

APPS = Path(__file__).resolve().parents[1] / "apps"
SERVERS = sorted(p.parent for p in APPS.glob("*-mcp/pyproject.toml"))


def test_there_is_at_least_one_mcp_server() -> None:
    assert {p.name for p in SERVERS} == {"flights-mcp", "payments-mcp"}


@pytest.mark.parametrize("server", SERVERS, ids=lambda p: p.name)
def test_mcp_server_is_containerized(server: Path) -> None:
    dockerfile = server / "Dockerfile"
    assert dockerfile.exists(), f"{server.name}: thiếu Dockerfile"
    content = dockerfile.read_text(encoding="utf-8")
    for required in ("HEALTHCHECK", "/health", "USER ", "EXPOSE ", "streamable-http"):
        assert required in content, f"{server.name}/Dockerfile thiếu '{required}'"
    user = next(line.split()[1] for line in content.splitlines() if line.startswith("USER "))
    assert user not in {"root", "0", "0:0"}
    metadata = tomllib.loads((server / "pyproject.toml").read_text())
    namespace = metadata["tool"]["setuptools"]["packages"]["find"]["include"][0].removesuffix("*")
    assert (server / "src" / namespace / "__main__.py").exists()
    command = next(json.loads(line[4:]) for line in content.splitlines() if line.startswith("CMD "))
    assert command == ["opentelemetry-instrument", "python", "-m", namespace, "--transport", "streamable-http"]
    assert (server / "requirements.txt").exists(), f"{server.name}: cần requirements.txt riêng cho image"
