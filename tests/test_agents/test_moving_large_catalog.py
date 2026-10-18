"""Offline regression for real-catalog size, without model/provider network calls."""

import copy
import json
from random import Random

import pytest
from relohome_agent.agents.llm_context import model_json
from relohome_agent.agents.subagents.services.moving_context import (
    compact_selection_catalog,
    selection_catalog_for_model,
)
from relohome_agent.agents.subagents.services.moving_llm import MAX_SELECTION_REQUEST_BYTES
from relohome_privacy import redact_pii

from tests.test_agents.test_moving_suggestion_efficiency import Responses, fixture_agent, form_request


def install_catalog(client, count, *, repeated_rules=False):
    common = {
        "available_districts": [
            {"id": f"district-{i}", "label": f"Provider district {i}"} for i in range(200 if count == 2 else 120)
        ],
        "opening_hours": {"from": "08:00", "to": "20:00"},
        "truck_ban": "Không vào đường cấm; phải tuân thủ quy định địa phương. " * 12,
        "cross_city": False,
        "require_request": True,
    }
    services = [
        {
            "service_id": f"observed-vehicle-{i}",
            "name": f"Xe {i}",
            "description": "Xe chuyển đồ; giá và khả năng phục vụ cần provider xác nhận.",
            "delivery_type": "TRUCK",
            "provider_data": {
                **(copy.deepcopy(common) if repeated_rules else {}),
                "vehicle_info": {
                    "capacity_kg": 500 + i,
                    "liftgate": i % 2 == 0 or i == count - 1,
                    "body_type": "closed",
                },
            },
            "requests": [{"_id": "liftgate", "description": "Cần xác nhận bửng nâng"}],
        }
        for i in range(count)
    ]
    client.handlers["list_moving_services"] = {"services": services}
    selected = services[-1]["service_id"]
    client.handlers["estimate_move"]["quote"]["options"] = [
        {"service_id": selected, "service_name": services[-1]["name"], "fee": {"total_price": 234_000}}
    ]
    return services, selected


def install_trace_sized_catalog(client):
    """Synthetic size witness, NOT the user's unavailable production payload."""
    services, _ = install_catalog(client, 19)
    for index, service in enumerate(services):
        service["service_id"] = f"observed-{index:02d}-" + "x" * 80
        service["description"] = f"Xe {index}: cần xác nhận giới hạn vận chuyển và bửng nâng."
    projected = selection_catalog_for_model({s["service_id"]: s for s in services})
    current = len(model_json(compact_selection_catalog(projected)))
    padding = ("Chỉ dùng xe kín; kiểm tra bửng nâng và giới hạn đường đi. " * 1000)[: 29_924 - current]
    services[0]["description"] += padding
    selected = services[-1]["service_id"]
    client.handlers["estimate_move"]["quote"]["options"] = [
        {"service_id": selected, "service_name": services[-1]["name"], "fee": {"total_price": 234_000}}
    ]
    return services, selected


@pytest.mark.asyncio
async def test_nineteen_services_at_trace_size_use_one_complete_bounded_request_without_losing_facts():
    agent, client, responses = fixture_agent()
    services, selected = install_trace_sized_catalog(client)
    before = copy.deepcopy(services)
    responses.output.output[0].arguments = json.dumps({"service_ids": [selected]})
    note = "Cần xe có bửng nâng, không dùng xe thùng hở; gọi 0901234567"
    result = await agent.run_form_quote(form_request(moving_options={"remarks": note}))
    assert result.status == "done"
    assert result.usage.llm_calls == len(responses.calls) == 1
    assert [name for name, _ in client.calls] == ["list_moving_services", "estimate_move"]
    context = json.loads(responses.calls[0]["input"][0]["content"])
    assert expand_catalog(context) == selection_catalog_for_model({s["service_id"]: s for s in services})
    assert context["remarks"] == redact_pii(note)
    assert client.calls[-1][1]["services"] == [{"service_id": selected}]
    assert services == before
    metrics = result.data["agent_trace"]["catalog_selection"]
    assert metrics["service_count"] == 19 and metrics["catalog_chars"] == 29_924
    assert metrics["context_chars"] > 24_000 and metrics["request_chars"] > 32_000
    serialized = json.dumps(responses.calls[0], ensure_ascii=False, separators=(",", ":"))
    assert metrics["request_bytes"] == len(serialized.encode("utf-8")) <= metrics["request_byte_limit"]
    assert metrics["request_byte_limit"] == MAX_SELECTION_REQUEST_BYTES and metrics["status"] == "ready"
    assert "0901234567" not in json.dumps(metrics) and selected not in json.dumps(metrics)


def expand_catalog(context):
    """Expand only the explicit, code-owned reference maps; provider values stay opaque."""
    facts = context.get("catalog_facts", {})
    rows = []
    for service in context["services"]:
        row = {**copy.deepcopy(context.get("catalog_defaults", {})), **copy.deepcopy(service)}
        row["constraints"] = {
            **copy.deepcopy(context.get("catalog_defaults", {}).get("constraints", {})),
            **copy.deepcopy(service["constraints"]),
        }
        row.update({key: copy.deepcopy(facts[ref]) for key, ref in row.pop("fact_refs", {}).items()})
        row["constraints"].update(
            {key: copy.deepcopy(facts[ref]) for key, ref in row.pop("constraint_refs", {}).items()}
        )
        rows.append(row)
    return rows


@pytest.mark.asyncio
@pytest.mark.parametrize("count", [2, 60])
async def test_repeated_large_catalog_keeps_all_facts_and_selects_last_observed_service_in_one_call(count):
    responses = Responses()
    agent, client, _ = fixture_agent(responses)
    services, selected = install_catalog(client, count, repeated_rules=True)
    responses.output.output[0].arguments = json.dumps({"service_ids": [selected]})
    before = copy.deepcopy(services)
    projected = selection_catalog_for_model({service["service_id"]: service for service in services})
    assert len(model_json(projected)) > 20_000  # This catalog was refused by main before the fix.
    note = "Cần xe có bửng nâng, không dùng xe thùng hở; gọi 0901234567 hoặc driver@example.test"
    req = form_request(moving_options={"remarks": note})
    result = await agent.run_form_quote(req)
    assert result.status == "done"
    assert result.usage.llm_calls == len(responses.calls) == 1
    assert result.usage.provider_calls == 2
    assert [name for name, _ in client.calls] == ["list_moving_services", "estimate_move"]
    call = responses.calls[0]
    context = json.loads(call["input"][0]["content"])
    assert expand_catalog(context) == projected
    assert len(context["services"]) == count
    assert context["remarks"] == redact_pii(note)
    assert "0901234567" not in model_json(context) and "driver@example.test" not in model_json(context)
    schema = call["tools"][0]["parameters"]["properties"]["service_ids"]
    assert schema["items"]["enum"] == [service["service_id"] for service in services]
    estimate = client.calls[-1][1]
    assert estimate["services"] == [{"service_id": selected}]
    assert estimate["draft"]["remarks"] == redact_pii(note)
    assert result.quotes[0].amount_vnd == 234_000
    assert services == before
    metrics = result.data["agent_trace"]["catalog_selection"]
    assert metrics["service_count"] == count and metrics["shared_fact_count"] > 0
    assert metrics["projected_chars"] > metrics["catalog_chars"]
    assert metrics["catalog_chars"] <= 20_000 and metrics["context_chars"] <= 24_000
    assert metrics["status"] == "ready"
    assert "district-" not in json.dumps(metrics) and "0901234567" not in json.dumps(metrics)


@pytest.mark.asyncio
async def test_more_than_fifty_small_services_is_not_refused_or_truncated():
    agent, client, responses = fixture_agent()
    services, selected = install_catalog(client, 60)
    responses.output.output[0].arguments = json.dumps({"service_ids": [selected]})
    result = await agent.run_form_quote(form_request())
    assert result.status == "done" and len(responses.calls) == 1
    context = json.loads(responses.calls[0]["input"][0]["content"])
    assert len(context["services"]) == len(services) == 60
    assert expand_catalog(context) == selection_catalog_for_model({s["service_id"]: s for s in services})


@pytest.mark.asyncio
async def test_irreducible_catalog_stays_bounded_without_choosing_first_n_or_charging_a_model_call():
    agent, client, responses = fixture_agent()
    services, _ = install_catalog(client, 2)
    services[0]["description"] = "catalog rule " * (MAX_SELECTION_REQUEST_BYTES // 12)
    result = await agent.run_form_quote(form_request())
    assert result.status == "needs_input" and result.usage.llm_calls == 0 and not responses.calls
    assert [name for name, _ in client.calls] == ["list_moving_services"]
    metrics = result.data["agent_trace"]["catalog_selection"]
    assert metrics["status"] == "request_limit"
    assert metrics["request_bytes"] > MAX_SELECTION_REQUEST_BYTES


@pytest.mark.asyncio
async def test_explicit_selection_still_bypasses_compaction_and_model_for_large_catalog():
    agent, client, responses = fixture_agent()
    _, selected = install_catalog(client, 60, repeated_rules=True)
    result = await agent.run_form_quote(form_request(moving_options={"service_id": selected}))
    assert result.status == "done" and not responses.calls and result.usage.llm_calls == 0
    assert client.calls[-1][1]["services"] == [{"service_id": selected}]


def test_partial_repetition_preserves_missing_false_and_distinct_limits_without_provider_reference_confusion():
    shared = [{"id": f"district-{i}"} for i in range(30)]
    catalog = {
        "first": {"provider_data": {"available_districts": shared, "cross_city": False, "max_cod": 0}},
        "second": {"provider_data": {"available_districts": shared, "cross_city": True, "max_cod": 1_000}},
        "unknown": {"provider_data": {"vehicle_info": {"fact_refs": {"provider_field": "opaque"}}}},
    }
    original = copy.deepcopy(catalog)
    rows = selection_catalog_for_model(catalog)
    compact = compact_selection_catalog(rows)
    assert expand_catalog(compact) == rows
    assert (
        compact["services"][0]["constraint_refs"]["available_districts"]
        == compact["services"][1]["constraint_refs"]["available_districts"]
    )
    assert "available_districts" not in compact.get("catalog_defaults", {}).get("constraints", {})
    assert "constraint_refs" not in compact["services"][2]
    assert catalog == original and selection_catalog_for_model(catalog) == rows


def test_fact_table_is_redacted_and_never_turns_provider_text_into_instructions():
    restriction = "Cần xác nhận bửng nâng; gọi 0901234567, email provider@example.test. " * 5
    rows = selection_catalog_for_model(
        {
            "a": {"provider_data": {"truck_ban": restriction}},
            "b": {"provider_data": {"truck_ban": restriction}},
            "c": {},
        }
    )
    compact = compact_selection_catalog(rows)
    assert expand_catalog(compact) == rows
    serialized = model_json(compact)
    assert "bửng nâng" in serialized and "0901234567" not in serialized and "provider@example.test" not in serialized
    assert len(compact["catalog_facts"]) == 1


@pytest.mark.parametrize("count", [0, 1, 2, 3, 51, 60])
def test_compaction_round_trip_keeps_types_nested_values_and_unknowns(count):
    random = Random(226)
    options = [None, False, 0, True, 1, 1.5, "restriction " * 25, {"fact_refs": {"opaque": [False, 0, None]}}]
    catalog = {}
    for i in range(count):
        provider = {
            key: copy.deepcopy(random.choice(options))
            for key in ("vehicle_info", "max_cod", "opening_hours", "truck_ban", "cross_city")
            if random.choice([False, True])
        }
        catalog[f"observed-{i}"] = {
            "description": random.choice([None, "provider text " * 20]),
            "provider_data": provider,
        }
    original = copy.deepcopy(catalog)
    rows = selection_catalog_for_model(catalog)
    compact = compact_selection_catalog(rows)
    assert json.dumps(expand_catalog(compact), sort_keys=True) == json.dumps(rows, sort_keys=True)
    assert catalog == original and selection_catalog_for_model(catalog) == rows


@pytest.mark.asyncio
async def test_tool_enum_size_is_bounded_even_when_the_catalog_and_context_fit():
    agent, client, responses = fixture_agent()
    client.handlers["list_moving_services"] = {
        "services": [{"service_id": f"observed-{i:03d}-" + "x" * 300} for i in range(110)]
    }
    result = await agent.run_form_quote(form_request())
    assert result.status == "needs_input" and result.usage.llm_calls == 0 and not responses.calls
    assert [name for name, _ in client.calls] == ["list_moving_services"]
    metrics = result.data["agent_trace"]["catalog_selection"]
    assert metrics["status"] == "request_limit"
    assert metrics["catalog_chars"] < MAX_SELECTION_REQUEST_BYTES
    assert metrics["context_chars"] < MAX_SELECTION_REQUEST_BYTES
    assert metrics["request_bytes"] > MAX_SELECTION_REQUEST_BYTES


@pytest.mark.asyncio
async def test_unicode_is_bounded_by_utf8_bytes_before_constructing_a_model_client(monkeypatch):
    from relohome_agent.agents.subagents.services import moving_llm

    agent, client, responses = fixture_agent()
    services, _ = install_catalog(client, 2)
    services[0]["description"] = "ế " * 17_000
    agent.client = None

    def unexpected_client(**kwargs):
        raise AssertionError("Oversized input must stop before allocating a model client")

    monkeypatch.setattr(moving_llm, "AsyncOpenAI", unexpected_client)
    result = await agent.run_form_quote(form_request())
    assert result.status == "needs_input" and not responses.calls and result.usage.llm_calls == 0
    assert [name for name, _ in client.calls] == ["list_moving_services"]
    metrics = result.data["agent_trace"]["catalog_selection"]
    assert metrics["request_chars"] < MAX_SELECTION_REQUEST_BYTES < metrics["request_bytes"]
    assert metrics["status"] == "request_limit"


@pytest.mark.asyncio
async def test_complete_request_boundary_includes_json_escaping_tools_and_unicode(monkeypatch):
    from relohome_agent.agents.subagents.services import moving_llm

    agent, client, responses = fixture_agent()
    req = form_request(moving_options={"remarks": 'Xe kín; chữ "trích dẫn" và ký tự \\ cần giữ nguyên.'})
    baseline = await agent.run_form_quote(req)
    assert baseline.status == "done"
    measured = len(json.dumps(responses.calls[0], ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    for limit, expected in ((measured, "done"), (measured - 1, "needs_input")):
        monkeypatch.setattr(moving_llm, "MAX_SELECTION_REQUEST_BYTES", limit)
        responses.calls.clear()
        client.calls.clear()
        result = await agent.run_form_quote(req)
        assert result.status == expected
        assert len(responses.calls) == result.usage.llm_calls == int(expected == "done")
        metrics = result.data["agent_trace"]["catalog_selection"]
        assert metrics["request_bytes"] == measured and metrics["request_byte_limit"] == limit


@pytest.mark.asyncio
async def test_size_diagnostics_do_not_misreport_missing_model_key_as_catalog_limit():
    agent, client, responses = fixture_agent()
    agent.api_key = ""
    result = await agent.run_form_quote(form_request())
    assert result.status == "failed" and result.error.code == "provider_unavailable"
    assert not responses.calls and [name for name, _ in client.calls] == ["list_moving_services"]
    assert result.data["agent_trace"]["catalog_selection"]["status"] == "prepared"
