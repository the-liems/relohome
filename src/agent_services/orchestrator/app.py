from contextlib import asynccontextmanager
from typing import Annotated
from uuid import UUID

from fastapi import Depends, FastAPI, Header

from src.agent_services.common import ServiceError, ServiceSettings, install_http, require_token, token_configured
from src.agent_services.llm import StructuredLLM
from src.agent_services.orchestrator.engine import Orchestrator
from src.agent_services.orchestrator.models import (
    ApprovalRequest,
    PlanDraft,
    PlanRequest,
    ReplanRequest,
    Revision,
    Workflow,
)
from src.agent_services.orchestrator.planner import Planner
from src.agent_services.orchestrator.registry import Registry, validate_plan
from src.agent_services.orchestrator.store import WorkflowStore

Owner = Annotated[str, Header(alias="X-Owner-ID", min_length=1, max_length=128)]


def create_app(settings: ServiceSettings | None = None) -> FastAPI:
    settings = settings or ServiceSettings()
    registry = Registry.load(settings.orchestrator_registry_path)
    llm = StructuredLLM(settings, settings.orchestrator_model)
    store = WorkflowStore(settings.orchestrator_db_path)
    engine = Orchestrator(settings, registry, store, Planner(llm, registry))

    @asynccontextmanager
    async def lifespan(app):
        store.initialize()
        yield
        await llm.close()

    app = FastAPI(title="LifeFlow Routing Orchestrator", version="1.0.0", lifespan=lifespan)
    app.state.engine = engine
    install_http(app, settings, "lifeflow-orchestrator")
    authenticated = [Depends(require_token(settings.orchestrator_api_token))]

    @app.get("/ready")
    def ready():
        try:
            store.ready()
        except Exception:
            raise ServiceError("STATE_NOT_READY", "Workflow store unavailable.", 503) from None
        if not token_configured(settings.orchestrator_api_token):
            raise ServiceError("NOT_READY", "Configure orchestrator service token.", 503)
        return {
            "status": "ready",
            "planning": "configured" if llm.ready() else "llm_not_configured",
            "execution": "disconnected",
            "registry_tools": len(registry.tools),
        }

    @app.get("/v1/capabilities", dependencies=authenticated)
    def capabilities():
        return {
            "registry": registry.model_dump(),
            "registry_hash": registry.digest,
            "execution": "disconnected",
            "approval": "trusted_backend_required",
        }

    @app.post("/v1/plans/validate", dependencies=authenticated)
    def validate(plan: PlanDraft):
        validate_plan(plan, registry)
        return {"valid": True, "registry_hash": registry.digest, "execution": "not_performed"}

    @app.post("/v1/workflows", response_model=Workflow, dependencies=authenticated)
    async def create(request: PlanRequest, owner: Owner):
        if owner != request.owner_id:
            raise ServiceError("OWNER_MISMATCH", "Owner does not match the trusted caller context.", 403)
        return await engine.create(request)

    @app.get("/v1/workflows/{workflow_id}", response_model=Workflow, dependencies=authenticated)
    def get(workflow_id: UUID, owner: Owner):
        return engine.inspect(workflow_id, owner)

    @app.get("/v1/workflows/{workflow_id}/events", dependencies=authenticated)
    def events(workflow_id: UUID, owner: Owner):
        return {"events": store.events(workflow_id, owner)}

    @app.post("/v1/workflows/{workflow_id}/advance", response_model=Workflow, dependencies=authenticated)
    async def advance(workflow_id: UUID, request: Revision, owner: Owner):
        return await engine.advance(workflow_id, owner, request.expected_revision)

    @app.post("/v1/workflows/{workflow_id}/replan", response_model=Workflow, dependencies=authenticated)
    async def replan(workflow_id: UUID, request: ReplanRequest, owner: Owner):
        return await engine.replan(workflow_id, owner, request.expected_revision, request.intake)

    @app.post("/v1/workflows/{workflow_id}/cancel", response_model=Workflow, dependencies=authenticated)
    def cancel(workflow_id: UUID, request: Revision, owner: Owner):
        return engine.cancel(workflow_id, owner, request.expected_revision)

    @app.post("/v1/workflows/{workflow_id}/tasks/{task_id}/reject", response_model=Workflow, dependencies=authenticated)
    def reject(workflow_id: UUID, task_id: str, request: Revision, owner: Owner):
        return engine.reject(workflow_id, owner, task_id, request.expected_revision)

    @app.post(
        "/v1/workflows/{workflow_id}/tasks/{task_id}/approve",
        response_model=Workflow,
        dependencies=[Depends(require_token(settings.orchestrator_approval_token))],
    )
    def approve(workflow_id: UUID, task_id: str, request: ApprovalRequest, owner: Owner):
        if settings.orchestrator_api_token == settings.orchestrator_approval_token:
            raise ServiceError("APPROVAL_NOT_CONFIGURED", "Approval and orchestration credentials must differ.", 503)
        return engine.approve(workflow_id, owner, task_id, request)

    return app


app = create_app()
