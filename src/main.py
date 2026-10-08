from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from src.agents.wiring import AgentService
from src.api.moving_quotes import router as moving_quote_router
from src.api.routes import router
from src.api.sandbox_payments import router as sandbox_payment_router
from src.api.web_actions import router as web_actions_router
from src.config import get_settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    print(f"Starting {settings.app_name} in {settings.app_env} mode")
    service = await AgentService.open()
    app.state.agent_service = service
    try:
        yield
    finally:
        await service.close()
        print("Shutting down...")


app = FastAPI(
    title="AI20K Agent",
    description="AI Agent built with LangGraph",
    version="1.0.0",
    lifespan=lifespan,
)

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


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request, exc):
    # Pydantic errors normally include rejected inputs, which may contain PII.
    return JSONResponse(
        status_code=422,
        content={"detail": [{"loc": list(e["loc"]), "type": e["type"]} for e in exc.errors()]},
    )


@app.get("/health")
async def health():
    return {"status": "ok", "env": settings.app_env}
