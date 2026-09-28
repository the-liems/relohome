from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI

from src.agent_services.common import ServiceError, ServiceSettings, install_http, require_token, token_configured
from src.agent_services.intake.models import IntakeRequest, IntakeResult
from src.agent_services.intake.service import IntakeService
from src.agent_services.llm import StructuredLLM


def create_app(settings: ServiceSettings | None = None) -> FastAPI:
    settings = settings or ServiceSettings()
    llm = StructuredLLM(settings, settings.intake_model)
    service = IntakeService(llm)

    @asynccontextmanager
    async def lifespan(app):
        yield
        await llm.close()

    app = FastAPI(title="LifeFlow Intake", version="1.0.0", lifespan=lifespan)
    install_http(app, settings, "lifeflow-intake")

    @app.get("/ready")
    def ready():
        if not token_configured(settings.intake_api_token) or not llm.ready():
            raise ServiceError("NOT_READY", "Configure service token and LLM credentials.", 503)
        return {"status": "ready", "provider_connectivity": "not_probed"}

    @app.post(
        "/v1/intake", response_model=IntakeResult, dependencies=[Depends(require_token(settings.intake_api_token))]
    )
    async def understand(request: IntakeRequest):
        return await service.understand(request)

    return app


app = create_app()
