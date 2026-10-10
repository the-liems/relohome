"""HTTP service authentication shared by the Flight and Payment MCP servers."""

import secrets

from mcp.server.fastmcp import FastMCP
from starlette.responses import JSONResponse


class ServiceTokenMiddleware:
    def __init__(self, app, token: str):
        self.app, self.token = app, token

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["path"].startswith("/mcp") and self.token:
            headers = dict(scope.get("headers", []))
            if b"origin" in headers:
                response = JSONResponse({"error": "browser origins are not allowed"}, status_code=403)
                await response(scope, receive, send)
                return
            supplied = headers.get(b"authorization", b"").decode("latin-1")
            if not secrets.compare_digest(supplied, "Bearer " + self.token):
                response = JSONResponse({"error": "unauthorized"}, status_code=401)
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)


class HttpServiceMCP(FastMCP):
    def __init__(self, *args, service_token: str = "", **kwargs):
        super().__init__(*args, **kwargs)
        self.service_token = service_token

    def streamable_http_app(self):
        app = super().streamable_http_app()
        app.add_middleware(ServiceTokenMiddleware, token=self.service_token)
        return app
