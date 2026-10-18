import logging
from contextlib import asynccontextmanager
from time import monotonic

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from relohome_agent.agents.wiring import AgentService
from relohome_agent.api.checkout import router as checkout_router
from relohome_agent.api.moving_quotes import router as moving_quote_router
from relohome_agent.api.roommate_access import router as roommate_access_router
from relohome_agent.api.roommate_connections import router as roommate_connections_router
from relohome_agent.api.roommate_discovery import router as roommate_discovery_router
from relohome_agent.api.roommate_map import router as roommate_map_router
from relohome_agent.api.roommate_media import router as roommate_media_router
from relohome_agent.api.roommate_notifications import router as roommate_notifications_router
from relohome_agent.api.roommate_operations import router as roommate_operations_router
from relohome_agent.api.roommate_privacy import router as roommate_privacy_router
from relohome_agent.api.roommate_profiles import router as roommate_profiles_router
from relohome_agent.api.roommate_safety import router as roommate_safety_router
from relohome_agent.api.routes import router
from relohome_agent.api.sandbox_payments import router as sandbox_payment_router
from relohome_agent.api.viewings import router as viewings_router
from relohome_agent.api.web_actions import router as web_actions_router
from relohome_agent.checkout.models import CheckoutError
from relohome_agent.config import get_settings
from relohome_agent.roommate_runtime import RoommateRuntime
from relohome_roommate.background import RoommateMaintenance

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    logger.info("Starting %s in %s mode", settings.app_name, settings.app_env)
    roommate = RoommateRuntime.open(settings)
    app.state.roommate_runtime = roommate
    service = None
    maintenance = RoommateMaintenance(roommate) if roommate else None
    try:
        service = await AgentService.open(roommate_runtime=roommate)
        app.state.agent_service = service
        if service.checkout is not None:
            # Chạy tiếp công việc hoàn tất còn dở sau khi khởi động lại (payment-design §7.4).
            await service.checkout.start()
        if maintenance:
            maintenance.start()
        yield
    finally:
        if maintenance:
            await maintenance.stop()
        if service:
            if service.checkout is not None:
                await service.checkout.stop()
            await service.close()
        if roommate:
            roommate.close()
        logger.info("Shut down %s", settings.app_name)


app = FastAPI(
    telemetry={"tracing": False},
    title="ReloHome Agent",
    description="AI Agent built with LangGraph",
    version="1.0.0",
    lifespan=lifespan,
)

@app.exception_handler(CheckoutError)
async def checkout_error(request, exc: CheckoutError):
    # Checkout and viewing business errors keep their {detail, code} contract for the UI.
    return JSONResponse(status_code=exc.status, content={"detail": exc.message, "code": exc.code})


settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api/v1")
app.include_router(sandbox_payment_router, prefix="/api/v1")
app.include_router(web_actions_router, prefix="/api/v1")
app.include_router(moving_quote_router, prefix="/api/v1")
app.include_router(checkout_router, prefix="/api/v1")
app.include_router(viewings_router, prefix="/api/v1")
app.include_router(roommate_access_router, prefix="/api/v1")
app.include_router(roommate_discovery_router, prefix="/api/v1")
app.include_router(roommate_profiles_router, prefix="/api/v1")
app.include_router(roommate_connections_router, prefix="/api/v1")
app.include_router(roommate_safety_router, prefix="/api/v1")
app.include_router(roommate_media_router, prefix="/api/v1")
app.include_router(roommate_map_router, prefix="/api/v1")
app.include_router(roommate_notifications_router, prefix="/api/v1")
app.include_router(roommate_privacy_router, prefix="/api/v1")
app.include_router(roommate_operations_router, prefix="/api/v1")


@app.middleware("http")
async def roommate_private_cache(request, call_next):
    started = monotonic()
    response = await call_next(request)
    if request.url.path.startswith("/api/v1/roommate/") and not request.url.path.endswith("/availability"):
        response.headers["Cache-Control"] = "private, no-store"
        response.headers["Pragma"] = "no-cache"
        route = getattr(request.scope.get("route"), "path", "unknown")
        logging.getLogger("roommate.http").info(
            "roommate_request route=%s status=%d seconds=%.3f", route, response.status_code, monotonic() - started
        )
    return response


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request, exc):
    # Pydantic errors normally include rejected inputs, which may contain PII.
    errors = [{"loc": list(e["loc"]), "type": e["type"]} for e in exc.errors()]
    # In deployment only the web gateway calls this API, so a 422 means their contracts drifted.
    logger.warning("request validation failed path=%s errors=%s", request.url.path, errors)
    return JSONResponse(status_code=422, content={"detail": errors})


@app.get("/health")
async def health():
    return {"status": "ok", "env": settings.app_env}
