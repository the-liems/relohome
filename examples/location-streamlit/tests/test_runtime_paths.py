import io
from pathlib import Path
from types import SimpleNamespace

from relohome_location_demo import mcp_client, runtime_paths


def test_installed_demo_uses_explicit_external_root(monkeypatch, tmp_path):
    monkeypatch.setenv("RELOHOME_RUNTIME_ROOT", str(tmp_path))
    assert runtime_paths.repository_root() == tmp_path.resolve()


def test_checkout_root_is_independent_of_working_directory(monkeypatch, tmp_path):
    monkeypatch.delenv("RELOHOME_RUNTIME_ROOT", raising=False)
    monkeypatch.chdir(tmp_path)
    expected = Path(__file__).resolve().parents[3]
    assert runtime_paths.repository_root() == expected


def test_client_launches_root_server_with_existing_configuration(monkeypatch, tmp_path):
    server = tmp_path / "apps/location-mcp/dist/server.js"
    server.parent.mkdir(parents=True)
    server.touch()
    (tmp_path / ".env.local").write_text("POSTGRES_DB=existing_database\nMCP_AUTH_TOKEN=file-token\n")
    monkeypatch.setenv("MCP_AUTH_TOKEN", "process-token")
    captured = {}

    def popen(command, **kwargs):
        captured.update(command=command, **kwargs)
        return SimpleNamespace(stdin=io.StringIO(), stdout=io.StringIO(), stderr=io.StringIO())

    monkeypatch.setattr(mcp_client.subprocess, "Popen", popen)
    monkeypatch.setattr(mcp_client.ReloHomeMcpClient, "_initialize", lambda self: None)
    client = mcp_client.ReloHomeMcpClient(tmp_path)
    assert client.env_path == tmp_path / ".env.local"
    assert captured["command"] == ["node", str(server)]
    assert captured["cwd"] == tmp_path
    assert captured["env"]["POSTGRES_DB"] == "existing_database"
    assert captured["env"]["MCP_AUTH_TOKEN"] == "process-token"
