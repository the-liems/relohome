"""Opt-in paid calls to the real provider; no mock fallback or domain calls."""

import os
from uuid import uuid4

import pytest
from relohome_intake.models import IntakeRequest
from relohome_intake.service import IntakeService
from relohome_orchestrator.engine import Orchestrator
from relohome_orchestrator.models import PlanRequest
from relohome_orchestrator.planner import Planner
from relohome_orchestrator.registry import Registry, validate_plan
from relohome_orchestrator.store import WorkflowStore

from src.agent_services.common import ServiceSettings
from src.agent_services.llm import StructuredLLM


@pytest.mark.skipif(
    os.environ.get("LIFEFLOW_LIVE_LLM") != "1", reason="Opt in to real LLM calls with LIFEFLOW_LIVE_LLM=1"
)
@pytest.mark.asyncio
async def test_real_intake_and_planner_without_domain_connection(tmp_path):
    settings = ServiceSettings(orchestrator_db_path=str(tmp_path / "live.sqlite3"))
    intake_llm = StructuredLLM(settings, settings.intake_model)
    routing_llm = StructuredLLM(settings, settings.orchestrator_model)
    assert intake_llm.ready(), "A real OPENAI_API_KEY is required; no simulated fallback"
    try:
        request = IntakeRequest(
            request_id=uuid4(),
            session_id="live-acceptance-" + str(uuid4()),
            message="Liệt kê các khu vực AhaMove đang phục vụ tại Việt Nam. Tôi chỉ muốn xem thông tin.",
        )
        intake = await IntakeService(intake_llm).understand(request)
        assert intake.status == "ready", intake.model_dump_json()
        assert "moving_catalog" in intake.understanding.intents
        registry = Registry.load(settings.orchestrator_registry_path)
        store = WorkflowStore(settings.orchestrator_db_path)
        store.initialize()
        engine = Orchestrator(settings, registry, store, Planner(routing_llm, registry))
        create_request = PlanRequest(intake=intake, owner_id="live-acceptance-owner")
        workflow = await engine.create(create_request)
        plan = workflow.plan
        validate_plan(plan, registry, intake.understanding.intents)
        assert any(t.tool == "list_service_areas" for t in plan.tasks)
        assert all(registry.get(t.service, t.tool).mode == "read" for t in plan.tasks)
        assert (await engine.create(create_request)).workflow_id == workflow.workflow_id
        advanced = await engine.advance(workflow.workflow_id, workflow.owner_id, workflow.revision)
        assert all(t.result is None and t.attempts == 0 for t in advanced.tasks)
        assert any(t.status == "blocked_integration" for t in advanced.tasks)
        restarted = WorkflowStore(settings.orchestrator_db_path)
        assert restarted.get(workflow.workflow_id, workflow.owner_id) == advanced
    finally:
        await intake_llm.close()
        await routing_llm.close()


@pytest.mark.skipif(os.environ.get("LIFEFLOW_LIVE_LLM") != "1", reason="Opt-in real LLM evaluation")
@pytest.mark.parametrize(
    "message,expected_intents,expected_status",
    [
        ("Chuyển giúp tôi.", set(), "needs_clarification"),
        (
            "Tìm phòng dưới 7 triệu ở Thủ Đức rồi báo giá chuyển đồ từ Quận 1 đến phòng tôi chọn.",
            {"housing_search", "moving_quote"},
            None,
        ),
        ("Viết giúp tôi bài thơ về vũ trụ.", {"out_of_scope"}, "out_of_scope"),
    ],
)
@pytest.mark.asyncio
async def test_real_intake_boundaries(message, expected_intents, expected_status):
    settings = ServiceSettings()
    llm = StructuredLLM(settings, settings.intake_model)
    try:
        result = await IntakeService(llm).understand(
            IntakeRequest(request_id=uuid4(), session_id="live-boundary-" + str(uuid4()), message=message)
        )
        assert expected_intents <= set(result.understanding.intents), result.model_dump_json()
        if expected_status:
            assert result.status == expected_status, result.model_dump_json()
        if result.status == "needs_clarification":
            assert result.understanding.clarification_questions
    finally:
        await llm.close()
