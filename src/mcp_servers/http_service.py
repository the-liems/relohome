"""Internal MCP bearer authentication; matches @relohome/mcp-core's contract."""

import re
import secrets

from mcp.server.fastmcp import FastMCP
from starlette.responses import JSONResponse

from src.observability import initialize, operation
from src.observability.asgi import TelemetryMiddleware

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


class HttpServiceMCP(FastMCP):
    def __init__(self, *args, service_token: str = "", **kwargs):
        super().__init__(*args, **kwargs)
        self.service_token = service_token

    async def call_tool(self, name, arguments):
        # Request metadata works over HTTP and stdio; it never enters business arguments.
        try:
            metadata = self.get_context().request_context.meta
            carrier = metadata.model_dump() if metadata else None
        except (ValueError, LookupError):
            carrier = None
        with operation(name, "tool", inputs=arguments, remote=carrier,
                       attributes={"rpc.system": "mcp", "rpc.method": name}) as op:
            result = await super().call_tool(name, arguments)
            op.output(result)
            return result

    def streamable_http_app(self):
        require_service_token(self.service_token)
        app = super().streamable_http_app()
        initialize(self.name)
        app.add_middleware(TelemetryMiddleware, service_name=self.name)
        app.add_middleware(ServiceTokenMiddleware, token=self.service_token)
        return app
