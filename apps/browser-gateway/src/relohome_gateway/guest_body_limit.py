"""Bound guest/auth request bodies while streaming, before JSON parsing."""

import asyncio
from http.cookies import CookieError, SimpleCookie

from relohome_gateway.guest_sessions import enabled
from starlette.responses import JSONResponse


class GuestBodyLimit:
    def __init__(self, app, gateway):
        self.app, self.gateway = app, gateway

    async def __call__(self, scope, receive, send):
        if (
            scope["type"] != "http"
            or not enabled()
            or not scope["path"].startswith("/web/api")
            or scope["method"] in {"GET", "HEAD", "OPTIONS"}
        ):
            return await self.app(scope, receive, send)
        cookies = SimpleCookie()
        try:
            cookies.load(dict(scope["headers"]).get(b"cookie", b"").decode("latin1"))
        except CookieError:
            return await JSONResponse({"detail": "Invalid cookie"}, status_code=400)(scope, receive, send)
        cookie = cookies.get("siu_session")
        if self.gateway.state.store.session_user(cookie.value if cookie else ""):
            return await self.app(scope, receive, send)
        chunks, size = [], 0
        try:
            async with asyncio.timeout(10):
                while True:
                    message = await receive()
                    if message["type"] == "http.disconnect":
                        return
                    chunk = message.get("body", b"")
                    size += len(chunk)
                    if size > 64 * 1024:
                        return await JSONResponse(
                            {"code": "payload_too_large", "detail": "Yêu cầu quá dài."}, status_code=413
                        )(scope, receive, send)
                    chunks.append(chunk)
                    if not message.get("more_body", False):
                        break
        except TimeoutError:
            return await JSONResponse({"detail": "Gửi dữ liệu quá chậm. Hãy thử lại."}, status_code=408)(
                scope, receive, send
            )
        first = True

        async def buffered_receive():
            nonlocal first
            if first:
                first = False
                return {"type": "http.request", "body": b"".join(chunks), "more_body": False}
            return await receive()

        await self.app(scope, buffered_receive, send)
