"""Quy ước (ADR-006): mỗi service cung cấp một MCP server đóng gói bằng Dockerfile riêng."""

from pathlib import Path

import pytest

MCP_ROOT = Path(__file__).resolve().parents[1] / "src" / "mcp_servers"
SERVERS = sorted(p for p in MCP_ROOT.iterdir() if (p / "__init__.py").exists())


def test_there_is_at_least_one_mcp_server() -> None:
    assert SERVERS


@pytest.mark.parametrize("server", SERVERS, ids=lambda p: p.name)
def test_mcp_server_is_containerized(server: Path) -> None:
    dockerfile = server / "Dockerfile"
    assert dockerfile.exists(), f"{server.name}: thiếu Dockerfile"
    content = dockerfile.read_text(encoding="utf-8")
    for required in ("HEALTHCHECK", "USER ", "EXPOSE ", "streamable-http"):
        assert required in content, f"{server.name}/Dockerfile thiếu '{required}'"
    assert (server / "__main__.py").exists(), f"{server.name}: cần __main__.py để chạy bằng python -m"
    assert (server / "requirements.txt").exists(), f"{server.name}: cần requirements.txt riêng cho image"
