from types import SimpleNamespace

import pytest
from relohome_gateway.guest_body_limit import GuestBodyLimit


@pytest.mark.asyncio
async def test_chunked_guest_body_is_bounded_before_parsing(monkeypatch):
    monkeypatch.setenv("RELOHOME_GUEST_ENABLED", "true")
    parsed, sent = [], []

    async def app(scope, receive, send):
        parsed.append((await receive())["body"])

    gateway = SimpleNamespace(state=SimpleNamespace(store=SimpleNamespace(session_user=lambda cookie: None)))
    middleware = GuestBodyLimit(app, gateway)
    scope = {"type": "http", "path": "/web/api/threads/t/chat", "method": "POST", "headers": []}

    async def receive():
        return {"type": "http.request", "body": b"x" * 32768, "more_body": True}

    async def send(message):
        sent.append(message)

    await middleware(scope, receive, send)
    assert sent[0]["status"] == 413 and not parsed

    async def small_receive():
        return {"type": "http.request", "body": b'{"message":"hello"}', "more_body": False}

    await middleware(scope, small_receive, send)
    assert parsed == [b'{"message":"hello"}']


@pytest.mark.asyncio
async def test_account_upload_limits_are_unchanged(monkeypatch):
    monkeypatch.setenv("RELOHOME_GUEST_ENABLED", "true")
    parsed = []

    async def app(scope, receive, send):
        parsed.append((await receive())["body"])

    async def receive():
        return {"type": "http.request", "body": b"x" * 70000, "more_body": False}

    async def send(message):
        raise AssertionError("Account request was intercepted")

    gateway = SimpleNamespace(
        state=SimpleNamespace(store=SimpleNamespace(session_user=lambda cookie: {"id": "account"}))
    )
    await GuestBodyLimit(app, gateway)(
        {
            "type": "http",
            "path": "/web/api/housing-management/photos",
            "method": "POST",
            "headers": [(b"cookie", b"siu_session=valid")],
        },
        receive,
        send,
    )
    assert len(parsed[0]) == 70000
