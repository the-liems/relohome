"""Executed by the wheel gate in a fresh venv; deliberately uses no pytest or repository imports."""
from __future__ import annotations

import importlib
import json
import os
import subprocess
import sys
from pathlib import Path


def main():
    projects = json.loads(Path(sys.argv[1]).read_text())
    for project in projects:
        for filename in project["files"]:
            if not filename.endswith(".py") or filename.endswith("/__main__.py"):
                continue
            name = filename[:-3].replace("/", ".").removesuffix(".__init__")
            module = importlib.import_module(name)
            assert Path(module.__file__).is_relative_to(Path(sys.prefix)), (name, module.__file__)
    from relohome_agent.agents.models import AgentName
    from relohome_agent.agents.subagents.fake import load_fixture
    from relohome_flight.catalog import get_airport
    from relohome_gateway.server import create_app
    from relohome_privacy import contains_contact_pii, looks_like_pii, redact_pii

    assert get_airport("SGN").code == "SGN"
    assert load_fixture(AgentName.FLIGHT)
    assert redact_pii("a@example.com 0912345678 012345678901") == "[email] [số điện thoại] [số giấy tờ]"
    assert looks_like_pii("123456789") and not contains_contact_pii("123456789")
    assert contains_contact_pii("a@example.com") and contains_contact_pii("0912345678")

    # Create one real encrypted database, then reopen it from three working directories.
    from fastapi.testclient import TestClient

    root = Path(os.environ["RELOHOME_RUNTIME_ROOT"])
    root.mkdir(exist_ok=True)
    media = root / "Frontend/data/housing-media"
    media.mkdir(parents=True)
    (media / "sentinel").write_bytes(b"existing media")
    with TestClient(create_app()) as client:
        client.app.state.travelers.put("wheel-smoke", {"name": "preserved"})
    database = root / "data/siu-web.sqlite3"
    key = root / "data/siu-web-traveler.key"
    original_key = key.read_bytes()
    unrelated = root.parent / "unrelated"
    unrelated.mkdir()
    code = '''
from pathlib import Path
from fastapi.testclient import TestClient
from relohome_gateway.server import create_app, housing_media_dir
with TestClient(create_app()) as client:
    assert client.app.state.travelers.get("wheel-smoke") == {"name": "preserved"}
assert (housing_media_dir() / "sentinel").read_bytes() == b"existing media"
'''
    for cwd in (root, root / "Frontend", unrelated):
        subprocess.run([sys.executable, "-c", code], cwd=cwd, check=True)
    assert key.read_bytes() == original_key
    assert len(list(root.rglob("*.sqlite3"))) == 1 and database.exists()
    assert not list(unrelated.iterdir())
    key.rename(key.with_suffix(".saved"))
    try:
        with TestClient(create_app()):
            raise AssertionError("Existing database accepted a missing key")
    except ValueError as error:
        assert "original traveler encryption key" in str(error)
    assert not key.exists()
    print("Imported every declared module; catalog, fixtures, privacy and existing state verified.")


if __name__ == "__main__":
    main()
