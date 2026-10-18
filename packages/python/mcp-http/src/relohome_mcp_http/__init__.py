"""SDK authentication for internal MCP services with pre-shared bearer tokens."""

import json
import re
import secrets
from functools import wraps

from mcp.server import MCPServer
from mcp.server.auth.middleware.auth_context import AuthContextMiddleware
from mcp.server.auth.middleware.bearer_auth import BearerAuthBackend, RequireAuthMiddleware
from mcp.server.auth.provider import AccessToken, TokenVerifier
from mcp.types import CallToolResult, TextContent
from starlette.middleware.authentication import AuthenticationMiddleware
from starlette.responses import JSONResponse

TOKEN_PATTERN = re.compile(r"[A-Za-z0-9._~+/-]+=*")


def require_service_token(token: str, name: str = "MCP_AUTH_TOKEN") -> str:
    if len(token) < 32 or not TOKEN_PATTERN.fullmatch(token):
        raise ValueError(f"{name} must contain at least 32 ASCII token characters")
    return token


class ServiceTokenVerifier(TokenVerifier):
    def __init__(self, token: str):
        self._token = require_service_token(token).encode("ascii")

    async def verify_token(self, token: str) -> AccessToken | None:
        if not secrets.compare_digest(token.encode("utf-8"), self._token):
            return None
        return AccessToken(token=token, client_id="internal-service", scopes=[])


class InternalRequestGuard:
    """Keep browser and ambiguous-header restrictions outside authentication."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["path"].startswith("/mcp"):
            headers = scope.get("headers", [])
            if any(key == b"origin" for key, _ in headers):
                await JSONResponse({"error": "origin_not_allowed"}, status_code=403)(scope, receive, send)
                return
            if sum(key == b"authorization" for key, _ in headers) > 1:
                await JSONResponse({"error": "invalid_request"}, status_code=400)(scope, receive, send)
                return
        await self.app(scope, receive, send)


def create_http_app(server: MCPServer, token: str, *, host: str = "127.0.0.1"):
    """Use SDK bearer auth without advertising an OAuth issuer for static tokens."""
    verifier = ServiceTokenVerifier(token)
    app = server.streamable_http_app(host=host)
    for route in app.routes:
        if route.path.startswith("/mcp"):
            route.app = RequireAuthMiddleware(route.app, required_scopes=[])
    app.add_middleware(AuthContextMiddleware)
    app.add_middleware(AuthenticationMiddleware, backend=BearerAuthBackend(verifier))
    app.add_middleware(InternalRequestGuard)
    return app


def tool_errors(fn, error_type):
    """Return the service's safe business errors as structured tool errors: `{code, message, retryable}`.

    A returned error result reaches the client unchanged; a raised ToolError would get an SDK prefix
    (`Error executing tool …`) and lose its JSON shape. The TypeScript servers use the same shape.
    """
    @wraps(fn)
    async def wrapped(*args, **kwargs):
        try:
            return await fn(*args, **kwargs)
        except error_type as exc:
            text = json.dumps({"code": exc.code, "message": str(exc), "retryable": exc.retryable}, ensure_ascii=False)
            return CallToolResult(content=[TextContent(type="text", text=text)], is_error=True)
    return wrapped
