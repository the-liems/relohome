"""Optional FastAPI boundary for handled failures; core telemetry has no FastAPI dependency."""

from fastapi import HTTPException
from fastapi.exception_handlers import http_exception_handler
from fastapi.responses import JSONResponse

from .runtime import record_http_error


class DiagnosticHTTPException(HTTPException):
    """Carry a fixed diagnostic code until the HTTP exception is actually handled."""

    def __init__(self, status_code, detail, *, error_type, headers=None):
        super().__init__(status_code, detail, headers)
        self.error_type = error_type


async def diagnostic_exception_handler(request, exc):
    record_http_error(exc.error_type)
    return await http_exception_handler(request, exc)


class DiagnosticJSONResponse(JSONResponse):
    """Annotate a handled failure only when its response is sent, preserving the body."""

    def __init__(self, content, *, status_code, error_type, headers=None):
        super().__init__(content, status_code=status_code, headers=headers)
        self.error_type = error_type

    async def __call__(self, scope, receive, send):
        record_http_error(self.error_type)
        await super().__call__(scope, receive, send)
