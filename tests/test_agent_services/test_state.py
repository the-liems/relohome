"""Exercise real SQLite and actual planning policies without provider responses."""

import json
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from uuid import uuid4

import pytest
from pydantic import SecretStr
from relohome_intake.models import IntakeRequest
from relohome_intake.service import normalize
from relohome_orchestrator.engine import Orchestrator
from relohome_orchestrator.models import ApprovalRequest, PlanTask, Workflow
from relohome_orchestrator.planner import Planner
from relohome_orchestrator.registry import Registry
from relohome_orchestrator.store import WorkflowStore

from src.agent_services.common import ServiceError, ServiceSettings, fingerprint, now
from src.agent_services.llm import StructuredLLM
from tests.test_agent_services.test_contracts import catalog_task, draft, understanding


def setup_engine(tmp_path):
    settings = ServiceSettings(
        _env_file=None, openai_api_key=SecretStr(""), orchestrator_db_path=str(tmp_path / "state.sqlite3")
    )
    registry = Registry.load(settings.orchestrator_registry_path)
    store = WorkflowStore(settings.orchestrator_db_path)
    store.initialize()
    return Orchestrator(
        settings, registry, store, Planner(StructuredLLM(settings, settings.orchestrator_model), registry)
    )


def save_workflow(engine, tasks=None):
    request = IntakeRequest(request_id=uuid4(), session_id="contract-session", message="Xem khu vực phục vụ")
    intake = normalize(request, understanding(), "policy-only")
    plan = draft(*(tasks if tasks is not None else [catalog_task()]))
    workflow = Workflow(
        workflow_id=uuid4(),
        owner_id="contract-owner",
        session_id=request.session_id,
        request_id=request.request_id,
        request_hash=fingerprint(request.model_dump(mode="json")),
        registry_hash=engine.registry.digest,
        intake=intake,
        plan=plan,
        tasks=engine.new_tasks(plan),
    )
    engine.refresh(workflow)
    return engine.store.create(workflow)


@pytest.mark.asyncio
async def test_disconnected_orchestrator_never_claims_tool_success(tmp_path):
    engine = setup_engine(tmp_path)
    workflow = save_workflow(engine)
    result = await engine.advance(workflow.workflow_id, workflow.owner_id, workflow.revision)
    assert result.tasks[0].status == "blocked_integration"
    assert result.tasks[0].result is None
    assert result.tasks[0].attempts == 0
    # Restart against the same real SQLite file.
    restored = setup_engine(tmp_path).store.get(result.workflow_id, result.owner_id)
    assert restored == result
    assert len(engine.store.events(result.workflow_id, result.owner_id)) == 2


def test_compare_and_swap_only_one_concurrent_update_wins(tmp_path):
    engine = setup_engine(tmp_path)
    workflow = save_workflow(engine)

    def change():
        try:
            engine.store.save(workflow.model_copy(deep=True), 1, "concurrency_check")
            return "saved"
        except ServiceError as exc:
            return exc.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(lambda _: change(), range(2)))
    assert sorted(outcomes) == ["REVISION_CONFLICT", "saved"]


def test_owner_and_request_id_isolation(tmp_path):
    engine = setup_engine(tmp_path)
    workflow = save_workflow(engine)
    assert engine.store.create(workflow) == workflow
    with pytest.raises(ServiceError) as exc:
        engine.store.get(workflow.workflow_id, "another-owner")
    assert exc.value.code == "NOT_FOUND"
    duplicate = workflow.model_copy(deep=True)
    duplicate.workflow_id = uuid4()
    duplicate.request_hash = "different"
    with pytest.raises(ServiceError) as exc:
        engine.store.create(duplicate)
    assert exc.value.code == "REQUEST_CONFLICT"


def test_approval_is_payload_bound_and_replan_revokes_it(tmp_path):
    engine = setup_engine(tmp_path)
    cancel = PlanTask(
        task_id="cancel",
        service="moving",
        tool="cancel_move_order",
        purpose="Kiểm tra chính sách hủy",
        arguments_json=json.dumps({"tracking_number": "contract-input", "comment": "Hủy theo yêu cầu"}),
        depends_on=[],
        input_refs=[],
    )
    workflow = save_workflow(engine, [cancel])
    workflow.intake.understanding.intents = ["moving_cancel"]
    assert workflow.tasks[0].status == "waiting_approval"
    request = ApprovalRequest(
        expected_revision=1,
        approval_id=uuid4(),
        actor_id=workflow.owner_id,
        payload_hash="0" * 64,
        expires_at=now() + timedelta(minutes=5),
    )
    with pytest.raises(ServiceError) as exc:
        engine.approve(workflow.workflow_id, workflow.owner_id, "cancel", request)
    assert exc.value.code == "APPROVAL_MISMATCH"
    request.payload_hash = workflow.tasks[0].payload_hash
    approved = engine.approve(workflow.workflow_id, workflow.owner_id, "cancel", request)
    assert approved.tasks[0].status == "blocked_integration"
    assert approved.tasks[0].resolved_arguments["approval_id"] == str(request.approval_id)
    replanned = engine.apply_plan(approved, approved.plan, workflow.intake, approved.revision)
    assert replanned.plan_version == 2
    assert replanned.tasks[0].approval is None
    assert replanned.tasks[0].status == "waiting_approval"


def test_rejection_cancels_descendants(tmp_path):
    engine = setup_engine(tmp_path)
    workflow = save_workflow(engine, [catalog_task("a"), catalog_task("b", ["a"])])
    rejected = engine.reject(workflow.workflow_id, workflow.owner_id, "a", workflow.revision)
    assert [t.status for t in rejected.tasks] == ["cancelled", "cancelled"]


def test_expired_write_lease_requires_reconciliation(tmp_path):
    engine = setup_engine(tmp_path)
    workflow = save_workflow(engine)
    # State-machine input, not a simulated provider result or network call.
    state = workflow.tasks[0]
    state.mode, state.status = "write", "running"
    state.lease_id, state.lease_expires_at = uuid4(), now() - timedelta(seconds=1)
    engine.refresh(workflow)
    assert state.status == "needs_reconciliation"
    assert state.result is None


def test_plan_registry_change_blocks_execution(tmp_path):
    engine = setup_engine(tmp_path)
    workflow = save_workflow(engine)
    engine.registry.source += " changed"
    with pytest.raises(ServiceError) as exc:
        engine.load(workflow.workflow_id, workflow.owner_id)
    assert exc.value.code == "REGISTRY_CHANGED"
