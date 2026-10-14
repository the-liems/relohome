import pytest
from fastapi import HTTPException
from relohome_gateway.guest_sessions import GuestSessions
from relohome_gateway.store import Store


def test_guest_tokens_expiry_restart_and_no_fake_accounts(tmp_path, monkeypatch):
    monkeypatch.setenv("RELOHOME_GUEST_ENABLED", "true")
    store = Store(tmp_path / "web.db")
    guests = GuestSessions(store)
    token, row = guests.create()
    token_b, other = guests.create()
    assert row["id"] != other["id"]
    assert row["token"] != token and len(row["token"]) == 64
    assert not store.all("SELECT * FROM users")
    assert GuestSessions(store).lookup(token)["id"] == row["id"]
    monkeypatch.setattr("relohome_gateway.guest_sessions.time.time", lambda: row["expires"] + 1)
    assert guests.lookup(token) is None
    assert guests.lookup(token, expired=True)["id"] == row["id"]
    monkeypatch.setenv("RELOHOME_GUEST_ENABLED", "false")
    assert guests.lookup(token_b) is None
    store.db.close()


def test_persistent_quota_cookie_rotation_and_atomic_failure(tmp_path, monkeypatch):
    monkeypatch.setenv("RELOHOME_GUEST_ENABLED", "true")
    monkeypatch.setenv("RELOHOME_GUEST_IP_TURNS_30M", "1")
    path = tmp_path / "web.db"
    store = Store(path)
    guests = GuestSessions(store)
    _, a = guests.create()
    guests.budget(a, "test-peer")
    _, b = guests.create()
    before = store.all("SELECT * FROM guest_budgets ORDER BY actor,period")
    with pytest.raises(HTTPException) as error:
        guests.budget(b, "test-peer")
    assert error.value.status_code == 429
    assert store.all("SELECT * FROM guest_budgets ORDER BY actor,period") == before
    store.db.close()
    store = Store(path)
    with pytest.raises(HTTPException):
        GuestSessions(store).budget(b, "test-peer")
    assert not store.all("SELECT * FROM guest_budgets WHERE actor=?", (b["id"],))
    store.db.close()
