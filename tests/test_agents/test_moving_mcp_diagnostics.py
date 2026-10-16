"""Offline SDK error-envelope regressions; no model, real contacts or provider calls."""

import json
from datetime import timedelta
from types import SimpleNamespace

import pytest
from mcp.types import CallToolResult, TextContent
from relohome_agent.agents.common import utcnow
from relohome_agent.agents.graph import run_config
from relohome_agent.agents.models import AgentName
from relohome_agent.agents.subagents.conformance import sample_request
from relohome_agent.agents.subagents.services.moving import QuoteContact
from relohome_agent.agents.subagents.services.moving_diagnostics import record_tool_failure
from relohome_agent.agents.subagents.services.moving_llm import MovingLlmAgent
from relohome_agent.api.moving_quotes import quote_form
from relohome_agent.services.adapters.fakes import InMemoryUsageMeter
from relohome_agent.services.adapters.mcp import ToolCallError, unwrap

from tests.test_agents.test_moving_quote_crash_usage import form, service
from tests.test_agents.test_service_subagents import moving_client


def error_result(text):
    return CallToolResult(isError=True, content=[TextContent(type="text", text=text)])


# Exact shape observed from the real TS SDK over loopback HTTP with a fake service.
INPUT_ERROR = (
    "Input validation error: Invalid arguments for tool estimate_move: "
    "draft.pickup.mobile: Invalid string: must match pattern /^\\+?\\d{9,15}$/, "
    "draft.destinations.0.mobile: Invalid string: must match pattern /^\\+?\\d{9,15}$/"
)
OUTPUT_ERROR = (
    "Output validation error: Invalid structured content for tool estimate_move: quote.quote_id: Invalid UUID"
)


@pytest.mark.parametrize(
    "message,code",
    [
        (INPUT_ERROR, "MCP_INPUT_VALIDATION_ERROR"),
        (OUTPUT_ERROR, "MCP_OUTPUT_VALIDATION_ERROR"),
        (
            "Output validation error: Tool estimate_move has an output schema but no structured content was provided",
            "MCP_OUTPUT_VALIDATION_ERROR",
        ),
        (
            "Input validation error: Invalid arguments for tool x: draft.remarks: received unavailable",
            "MCP_INPUT_VALIDATION_ERROR",
        ),
    ],
)
def test_sdk_schema_failures_are_distinct_and_not_retried(message, code):
    with pytest.raises(ToolCallError) as error:
        unwrap(error_result(message))
    assert error.value.code == code
    assert not error.value.retryable and not error.value.transport


@pytest.mark.parametrize("retryable", [False, True])
def test_structured_provider_errors_keep_server_code_and_retryability(retryable):
    payload = {"code": "PROVIDER_REJECTED", "message": "Fixture rejection", "retryable": retryable}
    with pytest.raises(ToolCallError) as error:
        unwrap(error_result(json.dumps(payload)))
    assert error.value.code == "PROVIDER_REJECTED"
    assert error.value.message == payload["message"]
    assert error.value.retryable is retryable


def test_successful_result_is_not_classified_by_its_text():
    assert unwrap(CallToolResult(content=[TextContent(type="text", text=INPUT_ERROR)])) == INPUT_ERROR


@pytest.mark.parametrize(
    "message,expected_code,expected_fields,retryable",
    [
        (INPUT_ERROR, "invalid_input", ["draft.pickup.mobile", "draft.destinations.0.mobile"], False),
        (OUTPUT_ERROR, "internal", ["quote.quote_id"], False),
        ("Unknown SDK failure: PRIVATE Contact 0900000000", "internal", [], False),
        ("Fixture service temporarily unavailable", "provider_unavailable", [], True),
    ],
)
@pytest.mark.asyncio
async def test_real_form_agent_keeps_tool_diagnostics_without_model_calls(
    message, expected_code, expected_fields, retryable, monkeypatch, caplog
):
    def forbidden_model(*args, **kwargs):
        raise AssertionError("Selected-service form must not construct an LLM client")

    monkeypatch.setattr("relohome_agent.agents.subagents.services.moving_llm.AsyncOpenAI", forbidden_model)
    client = moving_client()
    client.endpoint = SimpleNamespace(service="moving")

    def rejected(_):
        return unwrap(error_result(message))

    client.handlers["estimate_move"] = rejected
    agent = MovingLlmAgent("", "unused", client, contact=QuoteContact("Private Fixture", "0900000000"))
    request = sample_request(
        AgentName.RELOCATION,
        {
            "mode": "quote",
            "from_address": "Fixture A",
            "to_address": "Fixture B",
            "pickup_coordinate": {"lat": 21.03, "lng": 105.8},
            "destination_coordinate": {"lat": 21.04, "lng": 105.81},
            "move_date": (utcnow() + timedelta(days=2)).date().isoformat(),
            "move_time": "14:00",
            "moving_options": {"service_id": "SGN-TRUCK-500"},
        },
    )
    result = await agent.run_form_quote(request)
    assert result.status == "failed" and result.error.code == expected_code
    assert result.error.retryable is retryable
    assert result.usage.llm_calls == 0 and result.usage.provider_calls == 2
    assert [name for name, _ in client.calls] == ["list_moving_services", "estimate_move"]
    diagnostic = result.data["agent_trace"]["tool_errors"][0]
    assert diagnostic["tool"] == "estimate_move"
    assert diagnostic["validation_fields"] == expected_fields
    assert message not in caplog.text
    assert "0900000000" not in caplog.text and "PRIVATE Contact" not in caplog.text
    assert "Private Fixture" not in json.dumps(result.data)


def test_diagnostics_drop_values_unknown_codes_and_dynamic_field_names(caplog):
    message = (
        "Input validation error: Invalid arguments for tool estimate_move: "
        "draft.pickup.name: received Private Fixture, "
        "draft.pickup.mobile: received 0900000000, "
        "draft.PRIVATE_CONTACT: do not retain this key, "
        "quote.provider_data.PRIVATE_ADDRESS: do not retain this key"
    )
    diagnostic = record_tool_failure(ToolCallError("MCP_INPUT_VALIDATION_ERROR", message), "estimate_move")
    assert diagnostic["validation_fields"] == ["draft.pickup.name", "draft.pickup.mobile"]
    unknown = record_tool_failure(ToolCallError("SECRET_TOKEN_IN_CODE", "PRIVATE_ADDRESS"), "estimate_move")
    assert unknown["code"] == "UNCLASSIFIED_TOOL_ERROR"
    assert all(
        secret not in caplog.text
        for secret in ("Private Fixture", "0900000000", "PRIVATE_CONTACT", "PRIVATE_ADDRESS", "SECRET_TOKEN_IN_CODE")
    )


def test_diagnostic_fields_are_deduplicated_and_bounded():
    details = ", ".join(f"draft.destinations.{index}.mobile: invalid" for index in range(100))
    diagnostic = record_tool_failure(
        ToolCallError("MCP_INPUT_VALIDATION_ERROR", "Input validation error: Invalid arguments for tool x: " + details),
        "estimate_move",
    )
    assert len(diagnostic["validation_fields"]) <= 16
    assert len(set(diagnostic["validation_fields"])) == len(diagnostic["validation_fields"])


@pytest.mark.asyncio
async def test_quote_graph_persists_safe_diagnostics_and_keeps_normal_failure_response():
    runtime, client = service(InMemoryUsageMeter())

    def rejected(_):
        return unwrap(error_result(INPUT_ERROR))

    client.handlers["estimate_move"] = rejected
    thread = "fixture-mcp-diagnostics"
    reply = await quote_form(thread, form(), runtime, "fixture-owner")
    assert reply.response["kind"] == "ERROR"
    values = (await runtime.graph.aget_state(run_config(thread, runtime.deps))).values
    result = next(iter(values["task_results"].values()))
    assert result.error_code == "invalid_input"
    assert result.data["agent_trace"]["tool_errors"] == [
        {
            "tool": "estimate_move",
            "code": "MCP_INPUT_VALIDATION_ERROR",
            "category": "input_validation",
            "retryable": False,
            "transport": False,
            "validation_fields": ["draft.pickup.mobile", "draft.destinations.0.mobile"],
        }
    ]
    assert not values["plan"].commit_actions and not values.get("committed")
    assert (await runtime.deps.usage.counts(thread)).subagent_llm_calls == 0


@pytest.mark.asyncio
async def test_successful_quote_does_not_add_error_diagnostics_or_logs(caplog):
    runtime, _ = service(InMemoryUsageMeter())
    thread = "fixture-mcp-diagnostics-success"
    reply = await quote_form(thread, form(), runtime, "fixture-owner")
    assert reply.response["kind"] == "ANSWER"
    values = (await runtime.graph.aget_state(run_config(thread, runtime.deps))).values
    result = next(iter(values["task_results"].values()))
    assert "tool_errors" not in result.data["agent_trace"]
    assert "Moving MCP failure" not in caplog.text
