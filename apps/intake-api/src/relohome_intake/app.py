from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from relohome_agent_services.common import ServiceError, ServiceSettings, install_http, require_token, token_configured
from relohome_agent_services.intake_models import IntakeRequest, IntakeResult
from relohome_agent_services.llm import StructuredLLM
from relohome_intake.service import IntakeService


def create_app(settings: ServiceSettings | None = None) -> FastAPI:
    settings = settings or ServiceSettings()
    llm = StructuredLLM(settings, settings.intake_model)
    service = IntakeService(llm)

    @asynccontextmanager
    async def lifespan(app):
        yield
        await llm.close()

    app = FastAPI(title="ReloHome Intake", version="1.0.0", lifespan=lifespan)
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
