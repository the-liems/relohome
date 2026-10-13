from __future__ import annotations

import hashlib
import hmac
import json
import logging
import time
from datetime import UTC, datetime
from typing import Annotated, Any
from uuid import uuid4

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class ServiceError(Exception):
    def __init__(self, code: str, message: str, status: int = 409, retryable: bool = False):
        self.code, self.message, self.status, self.retryable = code, message, status, retryable
        super().__init__(message)


class ServiceSettings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore", env_file_encoding="utf-8")
    openai_api_key: SecretStr = SecretStr("")
    intake_model: str = "gpt-4o-mini"
    orchestrator_model: str = "gpt-4o-mini"
    intake_api_token: SecretStr = SecretStr("")
    orchestrator_api_token: SecretStr = SecretStr("")
    orchestrator_approval_token: SecretStr = SecretStr("")
    orchestrator_db_path: str = "data/orchestrator.sqlite3"
    orchestrator_registry_path: str = "config/agent-services/registry.json"
    agent_llm_timeout_seconds: float = Field(default=45, ge=1, le=120)
    agent_llm_max_output_tokens: int = Field(default=6000, ge=256, le=16000)
    agent_max_body_bytes: int = Field(default=262144, ge=1024, le=1048576)
    agent_max_parallel_tasks: int = Field(default=4, ge=1, le=16)
    agent_max_attempts: int = Field(default=3, ge=1, le=5)
    agent_max_plan_versions: int = Field(default=10, ge=1, le=50)
    agent_task_lease_seconds: int = Field(default=120, ge=10, le=600)


def now() -> datetime:
    return datetime.now(UTC)


def canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def fingerprint(value: Any) -> str:
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def token_configured(token: SecretStr) -> bool:
    value = token.get_secret_value()
    return len(value) >= 32 and not value.startswith(("replace-", "your-", "sk-your"))


bearer = HTTPBearer(auto_error=False)


def require_token(secret: SecretStr):
    def authenticate(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]):
        if not token_configured(secret):
            raise ServiceError("NOT_CONFIGURED", "Service token is not configured.", 503)
        if credentials is None or not hmac.compare_digest(credentials.credentials, secret.get_secret_value()):
            raise ServiceError("UNAUTHORIZED", "A valid service bearer token is required.", 401)

    return authenticate


def install_http(app: FastAPI, settings: ServiceSettings, name: str):
    logger = logging.getLogger(name)
    logger.setLevel(logging.INFO)
    logger.propagate = False
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(asctime)s %(name)s %(levelname)s %(message)s"))
        logger.addHandler(handler)
    @app.exception_handler(ServiceError)
    async def service_error(request: Request, exc: ServiceError):
        return JSONResponse(
            status_code=exc.status,
            content={
                "error": {
                    "code": exc.code,
                    "message": exc.message,
                    "retryable": exc.retryable,
                    "request_id": getattr(request.state, "request_id", ""),
                }
            },
        )

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request: Request, exc: RequestValidationError):
        # Never echo invalid input values (which may contain credentials or PII).
        return JSONResponse(
            status_code=422,
            content={
                "error": {
                    "code": "INVALID_REQUEST",
                    "message": "Request does not match the API schema.",
                    "retryable": False,
                    "request_id": getattr(request.state, "request_id", ""),
                    "fields": [".".join(map(str, e["loc"])) for e in exc.errors()],
                }
            },
        )

    @app.middleware("http")
    async def audit_and_bound(request: Request, call_next):
        request.state.request_id = str(uuid4())
        start = time.monotonic()
        # Bound streamed bodies too, not only Content-Length.
        data = bytearray()
        async for chunk in request.stream():
            data.extend(chunk)
            if len(data) > settings.agent_max_body_bytes:
                return await service_error(request, ServiceError("BODY_TOO_LARGE", "Request body too large.", 413))
        request._body = bytes(data)
        try:
            response = await call_next(request)
        except Exception:
            logger.error("unhandled request_id=%s", request.state.request_id)
            response = await service_error(request, ServiceError("INTERNAL_ERROR", "Unexpected service error.", 500))
        response.headers["X-Request-ID"] = request.state.request_id
        response.headers["Cache-Control"] = "no-store"
        logger.info(
            "request_id=%s method=%s status=%s duration_ms=%d",
            request.state.request_id,
            request.method,
            response.status_code,
            (time.monotonic() - start) * 1000,
        )
        return response

    @app.get("/health")
    def health():
        return {"service": name, "version": "1.0.0", "status": "alive"}
