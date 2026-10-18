"""Offline real Moving agent: one form decision, provider-authoritative batched prices."""

import asyncio
import copy
import json
from datetime import timedelta
from types import SimpleNamespace

import pytest
from relohome_agent.agents.common import utcnow
from relohome_agent.agents.llm_runtime import capture_invocation_usage
from relohome_agent.agents.models import AgentName
from relohome_agent.agents.subagents.conformance import sample_request
from relohome_agent.agents.subagents.services.moving import QuoteContact
from relohome_agent.agents.subagents.services.moving_context import selection_catalog_for_model
from relohome_agent.agents.subagents.services.moving_llm import MAX_SELECTION_REQUEST_BYTES, MovingLlmAgent
from relohome_agent.agents.task_prompts import FORM_SELECTION, MOVING_CORE, MOVING_MODES
from relohome_agent.services.adapters.mcp import ToolCallError
from relohome_privacy import redact_pii

from tests.test_agents.test_service_subagents import moving_client


def form_request(**patch):
    return sample_request(
        AgentName.RELOCATION,
        {
            "mode": "quote",
            "from_address": "Fixture A",
            "to_address": "Fixture B",
            "pickup_coordinate": {"lat": 21.03, "lng": 105.8},
            "destination_coordinate": {"lat": 21.04, "lng": 105.81},
            "move_date": (utcnow() + timedelta(days=2)).date().isoformat(),
            "move_time": "14:00",
            **patch,
        },
    )


class Responses:
    def __init__(self, name="estimate_move", args=None, count=1, status="completed", error=None):
        self.calls = []
        self.error = error
        self.output = SimpleNamespace(
            status=status,
            usage=SimpleNamespace(input_tokens=700, output_tokens=30),
            output=[
                SimpleNamespace(
                    type="function_call",
                    call_id="fixture-call",
                    name=name,
                    arguments=json.dumps(args or {"service_ids": ["SGN-TRUCK-500", "SGN-VAN"]}),
                )
            ]
            * count,
        )

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return self.output


def fixture_agent(responses=None):
    client = moving_client()
    client.endpoint = SimpleNamespace(service="moving")
    client.handlers["list_moving_services"]["services"][0].update(
        {
            "name": "Xe tải nhỏ",
            "description": "Dành cho vận chuyển đồ",
            "delivery_type": "TRUCK",
            "provider_data": {
                "vehicle_info": {"capacity_kg": 500},
                "cross_city": False,
                "icon_url": "https://image.test/large",
                "fleet_debug": "private-debug",
            },
        }
    )
    quote = client.handlers["estimate_move"]["quote"]
    quote["expires_at"] = (utcnow() + timedelta(minutes=4)).isoformat()
    quote["options"].append({"service_id": "SGN-VAN", "service_name": "Xe van", "fee": {"total_price": 200_000}})
    agent = MovingLlmAgent(
        "configured-fixture-key", "gpt-6-luna", client, contact=QuoteContact("PRIVATE CONTACT", "19001234")
    )
    responses = responses or Responses()
    agent.client = SimpleNamespace(responses=responses)
    return agent, client, responses


@pytest.mark.asyncio
async def test_auto_suggest_uses_one_generation_no_geocoding_and_one_batched_estimate():
    agent, client, responses = fixture_agent()
    req = form_request(moving_options={"packages": [{"weight_kg": 20}]})
    original = copy.deepcopy(req.inputs)
    result = await agent.run_form_quote(req)
    assert result.status == "done"
    assert len(responses.calls) == result.usage.llm_calls == 1
    assert result.usage.tokens_in == 700 and result.usage.tokens_out == 30
    assert result.usage.provider_calls == 2
    assert [name for name, _ in client.calls] == ["list_moving_services", "estimate_move"]
    assert client.calls[0][1] == {"lat": 21.03, "lng": 105.8, "delivery_type": "TRUCK"}
    estimate = client.calls[1][1]
    assert estimate["services"] == [{"service_id": "SGN-TRUCK-500"}, {"service_id": "SGN-VAN"}]
    assert estimate["draft"]["pickup"]["coordinate"] == req.inputs["pickup_coordinate"]
    assert estimate["draft"]["destinations"][0]["coordinate"] == req.inputs["destination_coordinate"]
    assert estimate["draft"]["packages"] == [{"weight_kg": 20}]
    assert len(result.quotes) == 2 and result.quotes[0].amount_vnd == 250_000
    assert result.data["agent_completion"]["model_assessed"] is False
    assert result.data["agent_trace"]["strategy"] == "single-decision"
    call = responses.calls[0]
    assert call["instructions"] == FORM_SELECTION
    assert {tool["name"] for tool in call["tools"]} == {"estimate_move", "ask_user"}
    assert len(call["input"]) == 1
    context = call["input"][0]["content"]
    assert "PRIVATE CONTACT" not in context and "19001234" not in context
    assert "private-debug" not in context and "icon_url" not in context and "provider_data" not in context
    assert '"capacity_kg":500' in context and '"cross_city":false' in context
    assert req.inputs == original


@pytest.mark.asyncio
@pytest.mark.parametrize("contact", ["", "; gọi 0901234567 hoặc fixture@example.test"])
async def test_vehicle_requirements_in_remarks_reach_the_single_selection_with_contact_redacted(contact):
    requirement = "Cần xe có bửng nâng, không dùng xe thùng hở"
    raw_note = requirement + contact
    req = form_request(moving_options={"remarks": raw_note})
    original = copy.deepcopy(req.inputs)
    agent, client, responses = fixture_agent()
    result = await agent.run_form_quote(req)
    assert result.status == "done" and result.usage.llm_calls == len(responses.calls) == 1
    call = responses.calls[0]
    context = json.loads(call["input"][0]["content"])
    assert context.get("remarks") == redact_pii(raw_note)
    assert requirement in context["remarks"]
    assert requirement not in call["instructions"]  # Notes stay untrusted user data, not system instructions.
    assert "0901234567" not in call["input"][0]["content"]
    assert "fixture@example.test" not in call["input"][0]["content"]
    estimate = next(arguments for name, arguments in client.calls if name == "estimate_move")
    assert estimate["draft"]["remarks"] == redact_pii(raw_note)
    assert req.inputs == original and len(client.calls) == 2


@pytest.mark.asyncio
async def test_user_selected_service_keeps_zero_generations_even_without_a_model_key():
    agent, client, responses = fixture_agent()
    agent.api_key = ""
    result = await agent.run_form_quote(form_request(moving_options={"service_id": "SGN-TRUCK-500"}))
    assert result.status == "done" and result.usage.llm_calls == 0 and not responses.calls
    assert result.data["agent_trace"]["strategy"] == "explicit-service"
    assert client.calls[1][1]["services"] == [{"service_id": "SGN-TRUCK-500"}]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "args",
    [
        {"service_ids": ["invented"]},
        {"service_ids": []},
        {"service_ids": ["SGN-VAN", "SGN-VAN"]},
        {"service_ids": ["SGN-VAN"] * 4},
        {"service_ids": ["SGN-VAN"], "draft": {"pickup": "invented"}},
        {"service_ids": "SGN-VAN"},
    ],
)
async def test_bad_service_selection_never_calls_estimate_or_retries_model(args):
    agent, client, responses = fixture_agent(Responses(args=args))
    result = await agent.run_form_quote(form_request())
    assert result.status == "failed" and result.error.code == "invalid_input"
    assert len(responses.calls) == result.usage.llm_calls == 1
    assert [name for name, _ in client.calls] == ["list_moving_services"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "name,count,status",
    [
        ("get_moving_service", 1, "completed"),
        ("estimate_move", 2, "completed"),
        ("estimate_move", 0, "completed"),
        ("estimate_move", 1, "incomplete"),
    ],
)
async def test_non_selection_outputs_end_without_an_extra_generation(name, count, status):
    agent, client, responses = fixture_agent(Responses(name=name, count=count, status=status))
    result = await agent.run_form_quote(form_request())
    assert result.status == "failed" and len(responses.calls) == 1
    assert result.usage.tokens_in == 700
    assert len(client.calls) == 1


@pytest.mark.asyncio
async def test_one_available_service_remains_a_model_choice_not_a_first_n_fallback():
    agent, client, responses = fixture_agent(Responses(args={"service_ids": ["SGN-VAN"]}))
    client.handlers["list_moving_services"] = {"services": [{"service_id": "SGN-VAN"}]}
    client.handlers["estimate_move"]["quote"]["options"] = client.handlers["estimate_move"]["quote"]["options"][1:]
    result = await agent.run_form_quote(form_request())
    assert result.status == "done" and len(result.quotes) == 1 and len(responses.calls) == 1
    schema = responses.calls[0]["tools"][0]["parameters"]["properties"]["service_ids"]
    assert schema["maxItems"] == 1 and schema["items"]["enum"] == ["SGN-VAN"]


@pytest.mark.asyncio
async def test_model_can_ask_without_quoting_or_silently_dropping_a_custom_requirement():
    responses = Responses(
        name="ask_user", args={"field": "moving_request", "question": "Bạn cho biết kích thước tủ nhé?"}
    )
    agent, client, _ = fixture_agent(responses)
    result = await agent.run_form_quote(form_request())
    assert result.status == "needs_input" and "kích thước" in result.questions[0].text
    assert len(client.calls) == 1 and result.usage.llm_calls == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("case", ["empty", "missing_pin", "too_large", "large_load"])
async def test_preparation_problem_asks_without_model_or_estimate(case):
    agent, client, responses = fixture_agent()
    req = form_request()
    if case == "empty":
        client.handlers["list_moving_services"] = {"services": []}
    elif case == "missing_pin":
        del req.inputs["pickup_coordinate"]
    elif case == "too_large":
        client.handlers["list_moving_services"]["services"][0]["description"] = "catalog rule " * (
            MAX_SELECTION_REQUEST_BYTES // 12
        )
    elif case == "large_load":
        req.inputs["moving_options"] = {"packages": [{"weight_kg": 1, "description": "x" * 500}] * 200}
    result = await agent.run_form_quote(req)
    assert result.status == "needs_input" and not responses.calls and result.usage.llm_calls == 0
    assert all(name == "list_moving_services" for name, _ in client.calls)


@pytest.mark.asyncio
@pytest.mark.parametrize("limit", ["llm", "provider"])
async def test_budget_still_blocks_calls(limit):
    agent, client, responses = fixture_agent()
    req = form_request()
    if limit == "llm":
        req.budget.max_llm_calls = 0
    else:
        req.budget.max_provider_calls = 1
    result = await agent.run_form_quote(req)
    assert result.status == "failed" and result.error.code == "budget_exceeded"
    assert len(client.calls) == 1
    assert len(responses.calls) == (0 if limit == "llm" else 1)


@pytest.mark.asyncio
@pytest.mark.parametrize("retryable", [False, True])
async def test_provider_rejection_does_not_guess_city_support_or_loop_to_other_services(retryable):
    agent, client, responses = fixture_agent()

    def refused(_):
        raise ToolCallError("PROVIDER_REJECTED", "Không hỗ trợ tuyến này", retryable=retryable)

    client.handlers["estimate_move"] = refused
    result = await agent.run_form_quote(form_request())
    assert result.status == ("failed" if retryable else "needs_input")
    assert len(client.calls) == 2 and len(responses.calls) == 1
    assert result.usage.provider_calls == 2 and result.usage.tokens_in == 700


@pytest.mark.asyncio
async def test_timeout_keeps_consumed_model_and_catalog_usage():
    agent, client, responses = fixture_agent(Responses(error=TimeoutError()))
    result = await agent.run_form_quote(form_request())
    assert result.status == "failed" and result.error.code == "timeout"
    assert result.usage.llm_calls == 1 and result.usage.provider_calls == 1 and len(responses.calls) == 1


@pytest.mark.asyncio
async def test_crashed_estimate_preserves_original_exception_and_usage_capture():
    agent, client, _ = fixture_agent()
    del client.handlers["estimate_move"]["quote"]["quote_id"]
    with capture_invocation_usage() as capture:
        with pytest.raises(KeyError, match="quote_id"):
            await agent.run_form_quote(form_request())
    usage = capture.snapshot()
    assert usage.llm_calls == 1 and usage.provider_calls == 2 and usage.tokens_in == 700


@pytest.mark.asyncio
async def test_form_cancellation_propagates_without_losing_consumed_usage():
    agent, _, _ = fixture_agent(Responses(error=asyncio.CancelledError()))
    with capture_invocation_usage() as capture:
        with pytest.raises(asyncio.CancelledError):
            await agent.run_form_quote(form_request())
    assert capture.snapshot().llm_calls == 1 and capture.snapshot().provider_calls == 1


@pytest.mark.asyncio
async def test_concurrent_forms_keep_separate_routes_and_usage_on_one_shared_agent():
    agent, client, responses = fixture_agent()
    original_create = responses.create

    async def interleave(**kwargs):
        await asyncio.sleep(0)
        return await original_create(**kwargs)

    responses.create = interleave
    first = form_request()
    second = form_request(
        pickup_coordinate={"lat": 10.77, "lng": 106.69}, destination_coordinate={"lat": 10.78, "lng": 106.7}
    )
    results = await asyncio.gather(agent.run_form_quote(first), agent.run_form_quote(second))
    for result, req in zip(results, (first, second), strict=True):
        assert result.status == "done" and result.usage.llm_calls == 1 and result.usage.provider_calls == 2
        assert result.data["route"]["pickup"]["lat"] == req.inputs["pickup_coordinate"]["lat"]
        assert result.data["route"]["destination"]["lng"] == req.inputs["destination_coordinate"]["lng"]
    assert len(responses.calls) == 2 and [name for name, _ in client.calls].count("estimate_move") == 2


def test_projection_keeps_all_candidates_constraints_and_does_not_mutate_provider_data():
    catalog = {
        "s": {
            "service_id": "s",
            "requests": [{"_id": "required"}],
            "provider_data": {
                "require_request": True,
                "opening_hours": [8, 20],
                "truck_ban": "rule",
                "vehicle_info": {"width_cm": 100},
                "unknown_secret_debug": "not-needed",
            },
        }
    }
    before = copy.deepcopy(catalog)
    row = selection_catalog_for_model(catalog)[0]
    assert row["constraints"] == {
        "require_request": True,
        "opening_hours": [8, 20],
        "truck_ban": "rule",
        "vehicle_info": {"width_cm": 100},
    }
    assert row["required_request_options"] == [{"_id": "required"}] and catalog == before
    assert "unknown_secret_debug" not in json.dumps(row)


@pytest.mark.asyncio
async def test_order_and_catalog_conversation_paths_retain_scoped_prompts_and_loop():
    for mode, read, args in [
        ("catalog", "list_service_areas", {}),
        ("order_status", "get_move_order", {"order_id": "O1"}),
    ]:
        agent, client, responses = fixture_agent()
        client.handlers["list_service_areas"] = {"cities": [{"city_id": "SGN", "name": "TP.HCM"}]}
        outputs = [
            Responses(name=read, args={"unused": True}).output,
            Responses(name="finish", args={"option_ids": []}).output,
        ]

        async def create(responses=responses, outputs=outputs, **kwargs):  # bind this iteration's fakes
            responses.calls.append(kwargs)
            return outputs.pop(0)

        # Preparation reads have empty-argument contracts.
        outputs[0].output[0].arguments = "{}"
        responses.create = create
        req = sample_request(AgentName.RELOCATION, {"mode": mode, **args})
        result = await agent.run(req)
        assert result.status == "done" and len(responses.calls) == 2
        assert responses.calls[0]["instructions"] == MOVING_CORE + "\n" + MOVING_MODES[mode]
        assert result.data["agent_trace"]["strategy"] == "tool-loop"
