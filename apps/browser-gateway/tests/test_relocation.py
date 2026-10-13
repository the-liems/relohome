"""Relocation must reopen existing state and serve the new build from every launcher cwd."""

import hashlib
import importlib
import subprocess
import sys
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from relohome_gateway.runtime_paths import database_path, media_path, runtime_root
from relohome_gateway.server import create_app
from relohome_gateway.store import Store, TravelerProfiles


def offline(request):
    if "/housing-media/" in request.url.path:
        return httpx.Response(200, json={"public": True})
    return httpx.Response(503, json={"detail": "fixture upstream is offline"})


@pytest.mark.parametrize("cwd", ["Frontend", "apps/web", "apps/browser-gateway", "unrelated"])
def test_existing_session_history_key_media_and_static_survive_move(tmp_path, monkeypatch, cwd):
    root = tmp_path / "existing-checkout"
    root.mkdir()
    monkeypatch.setenv("RELOHOME_RUNTIME_ROOT", str(root))
    for name in ("SIU_WEB_DB", "SIU_TRAVELER_KEY_FILE", "SIU_TRAVELER_KEY", "SIU_HOUSING_MEDIA_DIR"):
        monkeypatch.delenv(name, raising=False)
    database = root / "data/siu-web.sqlite3"
    store = Store(database)
    store.write("INSERT INTO users VALUES ('existing-owner','existing@example.test','Existing','salt','hash','{}')")
    token = store.create_session("existing-owner")
    store.write(
        "INSERT INTO threads (id,owner,title,updated,state,revision) VALUES ('existing-thread','existing-owner','Saved conversation',1,'{}',0)"
    )
    key = database.parent / "siu-web-traveler.key"
    profiles = TravelerProfiles(store, key)
    profiles.put("existing-owner", {"name": "Private saved traveler"})
    original_key = key.read_bytes()
    store.db.close()
    media = root / "Frontend/data/housing-media"
    media.mkdir(parents=True)
    (media / "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png").write_bytes(b"existing media fixture")
    dist = root / "apps/web/dist"
    (dist / "assets").mkdir(parents=True)
    index = '<html><title>ReloHome</title><script src="/assets/main.js"></script></html>'
    (dist / "index.html").write_text(index)
    (dist / "assets/main.js").write_text('console.log("existing web contract");')
    working = root / cwd
    working.mkdir(parents=True, exist_ok=True)
    monkeypatch.chdir(working)

    app = create_app(transport=httpx.MockTransport(offline))
    with TestClient(app) as client:
        client.cookies.set("siu_session", token)
        assert client.get("/web/api/session").json()["id"] == "existing-owner"
        threads = client.get("/web/api/threads").json()
        assert threads[0]["id"] == "existing-thread"
        assert threads[0]["title"] == "Saved conversation"
        assert app.state.travelers.get("existing-owner") == {"name": "Private saved traveler"}
        assert client.get("/").text == index
        assert client.get("/ai/existing-thread").text == index
        asset = client.get("/assets/main.js")
        assert asset.status_code == 200 and "javascript" in asset.headers["content-type"]
        image = client.get("/web/media/housing/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png")
        assert image.status_code == 200 and image.content == b"existing media fixture"
        assert app.title == "ReloHome"
    assert key.read_bytes() == original_key
    assert list(root.rglob("*.sqlite3")) == [database]
    assert list(root.rglob("*.key")) == [key]


def test_missing_root_fails_before_creating_replacement_state(tmp_path, monkeypatch):
    monkeypatch.delenv("RELOHOME_RUNTIME_ROOT", raising=False)
    monkeypatch.chdir(tmp_path)
    with pytest.raises(ValueError, match="existing deployment/checkout root"):
        with TestClient(create_app()):
            pass
    assert list(tmp_path.iterdir()) == []


def test_existing_database_without_original_key_is_untouched(tmp_path, monkeypatch):
    monkeypatch.setenv("RELOHOME_RUNTIME_ROOT", str(tmp_path))
    for name in ("SIU_WEB_DB", "SIU_TRAVELER_KEY", "SIU_TRAVELER_KEY_FILE"):
        monkeypatch.delenv(name, raising=False)
    database = tmp_path / "data/siu-web.sqlite3"
    Store(database).db.close()
    digest = hashlib.sha256(database.read_bytes()).digest()
    with pytest.raises(ValueError, match="original traveler encryption key"):
        with TestClient(create_app()):
            pass
    assert hashlib.sha256(database.read_bytes()).digest() == digest
    assert not (database.parent / "siu-web-traveler.key").exists()


def test_relative_overrides_still_resolve_against_runtime_root(tmp_path, monkeypatch):
    monkeypatch.setenv("RELOHOME_RUNTIME_ROOT", str(tmp_path))
    monkeypatch.setenv("SIU_WEB_DB", "existing/custom.sqlite3")
    monkeypatch.setenv("SIU_HOUSING_MEDIA_DIR", "existing/media")
    assert database_path(runtime_root()) == tmp_path / "existing/custom.sqlite3"
    assert media_path(runtime_root()) == tmp_path / "existing/media"


@pytest.mark.parametrize(
    "module", ["server", "store", "roommate_gateway", "runtime_paths", "admin_provision", "cloud_backup"]
)
def test_canonical_modules_have_one_source_owner(module):
    implementation = importlib.import_module("relohome_gateway." + module)
    source = Path(__file__).resolve().parents[1] / "src/relohome_gateway" / (module + ".py")
    assert Path(implementation.__file__).resolve() == source
    assert not list((Path(__file__).resolve().parents[3] / "Frontend").glob("*.py"))


@pytest.mark.parametrize(
    "module", ["server", "store", "roommate_gateway", "runtime_paths", "admin_provision", "cloud_backup"]
)
def test_reinstalled_gateway_imports_from_outside_checkout(module, tmp_path):
    source = Path(__file__).resolve().parents[1] / "src/relohome_gateway" / (module + ".py")
    result = subprocess.run(
        [sys.executable, "-I", "-c", "import importlib, sys; print(importlib.import_module('relohome_gateway.' + sys.argv[1]).__file__)", module],
        cwd=tmp_path, capture_output=True, text=True, check=False,
    )
    assert result.returncode == 0, result.stderr
    assert Path(result.stdout.strip()).resolve() == source
