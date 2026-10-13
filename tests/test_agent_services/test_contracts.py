"""Pure contract/policy tests. No provider data, mock server or patched LLM."""

import json
from uuid import uuid4

import pytest
from relohome_agent_services.intake_models import Fact, IntakeRequest, Understanding
from relohome_intake.service import normalize
from relohome_orchestrator.models import InputReference, PlanDraft, PlanTask
from relohome_orchestrator.registry import Registry, validate_plan

from src.agent_services.common import ServiceError


def catalog_task(task_id="areas", depends_on=None):
    return PlanTask(
        task_id=task_id,
        service="moving",
        tool="list_service_areas",
        purpose="Xem khu vực phục vụ",
        arguments_json='{"country_id":"VN"}',
        depends_on=depends_on or [],
        input_refs=[],
    )


def draft(*tasks):
    return PlanDraft(
        summary="Xem khu vực phục vụ", tasks=list(tasks), clarification_questions=[], unsupported_requests=[]
    )


def test_actual_registry_and_literal_inputs():
    registry = Registry.load("config/agent-services/registry.json")
    assert len(registry.tools) == 13
    assert validate_plan(draft(catalog_task()), registry).tasks[0].tool == "list_service_areas"


@pytest.mark.parametrize(
    "kind,expected",
    [
        ("cycle", "CYCLIC_PLAN"),
        ("duplicate", "DUPLICATE_TASK"),
        ("unknown_tool", "TOOL_NOT_ALLOWED"),
        ("bad_input", "INVALID_TOOL_INPUT"),
        ("missing_dependency", "INVALID_DEPENDENCY"),
    ],
)
def test_reject_invalid_plan(kind, expected):
    registry = Registry.load("config/agent-services/registry.json")
    plan = draft(catalog_task())
    if kind == "cycle":
        plan.tasks = [catalog_task("a", ["b"]), catalog_task("b", ["a"])]
    elif kind == "duplicate":
        plan.tasks.append(catalog_task())
    elif kind == "unknown_tool":
        plan.tasks[0].tool = "arbitrary_unregistered_tool"
    elif kind == "bad_input":
        plan.tasks[0].arguments_json = '{"country_id":123}'
    else:
        plan.tasks[0].depends_on = ["absent"]
    with pytest.raises(ServiceError) as exc:
        validate_plan(plan, registry)
    assert exc.value.code == expected


def test_reference_requires_explicit_dependency():
    plan = draft(catalog_task("a"), catalog_task("b"))
    plan.tasks[1].arguments_json = "{}"
    plan.tasks[1].input_refs = [InputReference(argument="country_id", task_id="a", pointer="/cities/0/country_id")]
    with pytest.raises(ServiceError, match="direct dependency"):
        validate_plan(plan, Registry.load("config/agent-services/registry.json"))


def test_model_cannot_supply_approval_or_promote_read_intent_to_write():
    registry = Registry.load("config/agent-services/registry.json")
    task = PlanTask(
        task_id="cancel",
        service="moving",
        tool="cancel_move_order",
        purpose="Hủy theo yêu cầu",
        arguments_json=json.dumps({"tracking_number": "contract-input", "comment": "Kiểm tra contract"}),
        depends_on=[],
        input_refs=[],
    )
    with pytest.raises(ServiceError) as exc:
        validate_plan(draft(task), registry, ["moving_quote"])
    assert exc.value.code == "WRITE_NOT_REQUESTED"
    validate_plan(draft(task), registry, ["moving_cancel"])
    task.arguments_json = json.dumps(
        {"tracking_number": "contract-input", "comment": "Kiểm tra contract", "approval_id": str(uuid4())}
    )
    with pytest.raises(ServiceError) as exc:
        validate_plan(draft(task), registry, ["moving_cancel"])
    assert exc.value.code == "TRUSTED_INPUT_OVERRIDE"


def test_cancel_cannot_target_both_order_and_tracking_number():
    task = PlanTask(
        task_id="cancel",
        service="moving",
        tool="cancel_move_order",
        purpose="Kiểm tra contract",
        arguments_json='{"order_id":"contract-input","tracking_number":"contract-input","comment":"Hủy"}',
        depends_on=[],
        input_refs=[],
    )
    with pytest.raises(ServiceError) as exc:
        validate_plan(draft(task), Registry.load("config/agent-services/registry.json"))
    assert exc.value.code == "INVALID_TOOL_INPUT"


def understanding():
    return Understanding(
        normalized_goal="Tìm phòng",
        intents=["housing_search"],
        entities=[],
        constraints=[],
        missing_fields=[],
        conflicts=[],
        clarification_questions=[],
        confidence=0.9,
    )


def test_intake_requires_user_evidence_and_does_not_invent_confirmed_facts():
    request = IntakeRequest(request_id=uuid4(), session_id="contract-session", message="Tìm phòng dưới 7 triệu")
    value = understanding()
    value.constraints = [Fact(name="budget", value="7000000 VND", source="message", evidence="dưới 7 triệu")]
    result = normalize(request, value, "policy-only")
    assert result.status == "ready"
    assert result.user_confirmed_facts == {}
    value.constraints[0].evidence = "giá được provider xác nhận"
    with pytest.raises(ServiceError) as exc:
        normalize(request, value, "policy-only")
    assert exc.value.code == "UNGROUNDED_EXTRACTION"


def test_missing_fields_and_low_confidence_force_clarification():
    request = IntakeRequest(request_id=uuid4(), session_id="contract-session", message="Chuyển giúp tôi")
    value = understanding()
    value.confidence = 0.2
    result = normalize(request, value, "policy-only")
    assert result.status == "needs_clarification"
    assert result.understanding.clarification_questions
