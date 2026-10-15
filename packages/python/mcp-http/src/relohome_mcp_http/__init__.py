"""Internal MCP bearer authentication; matches @relohome/mcp-core's contract."""

import re
import secrets
from functools import wraps

from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from starlette.responses import JSONResponse

TOKEN_PATTERN = re.compile(r"[A-Za-z0-9._~+/-]+=*")


def require_service_token(token: str, name: str = "MCP_AUTH_TOKEN") -> str:
    if len(token) < 32 or not TOKEN_PATTERN.fullmatch(token):
        raise ValueError(f"{name} must contain at least 32 ASCII token characters")
    return token


def valid_bearer_token(header: str | None, expected: str) -> bool:
    if not header or not re.fullmatch(r"(?i:Bearer) [A-Za-z0-9._~+/-]+=*", header):
        return False
    return secrets.compare_digest(header[7:].encode("ascii"), expected.encode("ascii"))


def auth_error(code: str, status: int) -> JSONResponse:
    headers = {"Cache-Control": "no-store"}
    if status == 401:
        headers["WWW-Authenticate"] = "Bearer"
    return JSONResponse({"status": "error", "code": code}, status_code=status, headers=headers)


class ServiceTokenMiddleware:
    def __init__(self, app, token: str):
        self.app, self.token = app, require_service_token(token)

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["path"].startswith("/mcp"):
            headers = scope.get("headers", [])
            if any(key == b"origin" for key, _ in headers):
                await auth_error("ORIGIN_NOT_ALLOWED", 403)(scope, receive, send)
                return
            credentials = [value.decode("latin-1") for key, value in headers if key == b"authorization"]
            if len(credentials) != 1 or not valid_bearer_token(credentials[0], self.token):
                await auth_error("UNAUTHORIZED", 401)(scope, receive, send)
                return
        await self.app(scope, receive, send)


class HttpServiceMCP(MCPServer):
    def __init__(self, *args, service_token: str = "", host: str = "127.0.0.1", port: int = 8000, **kwargs):
        super().__init__(*args, **kwargs)
        self.service_token = service_token
        self.host, self.port = host, port

    def run(self, transport="stdio", **kwargs):
        if transport != "stdio":
            kwargs.setdefault("host", self.host)
            kwargs.setdefault("port", self.port)
        super().run(transport=transport, **kwargs)

    def streamable_http_app(self, **kwargs):
        require_service_token(self.service_token)
        kwargs.setdefault("host", self.host)
        app = super().streamable_http_app(**kwargs)
        app.add_middleware(ServiceTokenMiddleware, token=self.service_token)
        return app


def tool_errors(fn, error_type):
    """Expose only the service's safe business errors to MCP callers."""
    @wraps(fn)
    async def wrapped(*args, **kwargs):
        try:
            return await fn(*args, **kwargs)
        except error_type as exc:
            raise ToolError(str(exc)) from exc
    return wrapped
