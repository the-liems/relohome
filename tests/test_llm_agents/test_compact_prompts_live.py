"""Opt-in paid model checks against synthetic fixtures, NOT live AhaMove/Housing.

RUN_COMPACT_PROMPT_LIVE=1 uses the configured key/model, never prints credentials.
The default suite skips these tests. Each planner/form case permits one generation;
the read-domain case permits two. No real domain API, DB or transaction is invoked.
"""

import os
from time import perf_counter

import pytest
from dotenv import dotenv_values
from relohome_agent.agents.llm import StructuredLLM
from relohome_agent.agents.models import AgentName, SessionContext
from relohome_agent.agents.planner_llm import LlmPlanner
from relohome_agent.agents.planning import PlannerInput
from relohome_agent.agents.subagents.capabilities import BASELINE_CAPABILITIES
from relohome_agent.agents.subagents.services.read_llm import ReadLlmAgent
from relohome_agent.config import Settings

from tests.test_agents.helpers import intake_result
from tests.test_agents.test_moving_suggestion_efficiency import fixture_agent, form_request
from tests.test_agents.test_token_efficiency import Housing, request

pytestmark = [
    pytest.mark.asyncio,
    pytest.mark.skipif(os.getenv("RUN_COMPACT_PROMPT_LIVE") != "1", reason="Opt-in paid model/synthetic-domain eval"),
]


def settings():
    config = Settings(_env_file=(".env", ".env.local"))
    key = config.openai_api_key.get_secret_value()
    if not key or key.startswith(("test-", "your-", "sk-your")):
        # The offline suite installs a dummy process-level key in conftest.py.
        # Paid opt-in must explicitly load the operator's configured key instead;
        # never send the dummy key or modify/export credentials to the environment.
        configured = {**dotenv_values(".env"), **dotenv_values(".env.local")}
        key = configured.get("OPENAI_API_KEY") or ""
        assert key and not key.startswith(("test-", "your-", "sk-your")), "Real configured model key required"
        config = Settings(_env_file=(".env", ".env.local"), openai_api_key=key)
    return config


@pytest.mark.parametrize("custom", [False, True])
async def test_real_model_one_form_decision_with_fixture_provider(custom):
    config = settings()
    agent, client, _ = fixture_agent()
    agent.api_key = config.openai_api_key.get_secret_value()
    agent.model = config.agent_moving_model
    agent.client = None
    req = form_request()
    req.budget.max_llm_calls = 1
    req.user_request = "Gợi ý vài gói xe để tôi so sánh giá, chưa đặt xe."
    if custom:
        req.user_request = "Tủ dài 6 mét phải chở vừa xe. Gói nào chắc chắn chở vừa?"
        for service in client.handlers["list_moving_services"]["services"]:
            service["provider_data"] = {"vehicle_info": {"length_cm": 200}}
    started = perf_counter()
    try:
        result = await agent.run_form_quote(req)
        assert result.usage.llm_calls == 1
        if custom:
            assert result.status == "needs_input"
            assert [name for name, _ in client.calls] == ["list_moving_services"]
        else:
            assert result.status == "done" and result.quotes
            assert all(row["service_id"] in {"SGN-VAN", "SGN-TRUCK-500"} for row in client.calls[-1][1]["services"])
        print(
            {
                "case": "moving_custom" if custom else "moving_base",
                "status": result.status,
                "llm_calls": result.usage.llm_calls,
                "input_tokens": result.usage.tokens_in,
                "output_tokens": result.usage.tokens_out,
                "wall_s": round(perf_counter() - started, 2),
            }
        )
    finally:
        await agent.close()


@pytest.mark.parametrize("case", ["mixed", "comparison", "map", "round_trip"])
async def test_real_planner_one_call_preserves_typed_intent(case):
    config = settings()
    llm = StructuredLLM(
        config.openai_api_key.get_secret_value(), config.agent_planner_model, timeout_s=30, max_output_tokens=1800
    )
    domains = [AgentName.PROPERTY]
    values = {"near": "Ocean Park 2", "max_price_vnd": 5_000_000}
    if case == "mixed":
        domains.append(AgentName.RELOCATION)
        values.update(moving_mode="quote", to_address="selected:property")
    elif case == "comparison":
        values = {"housing_mode": "compare", "listing_ids": ["home-a", "home-b"]}
    elif case == "map":
        domains = [AgentName.MAP]
        values = {"map_mode": "nearby", "map_near": "Hồ Gươm", "map_categories": ["pharmacy"]}
    else:
        domains = [AgentName.FLIGHT]
        values = {
            "origin": "HAN",
            "destination": "SGN",
            "flight_date": "2026-12-01",
            "return_date": "2026-12-05",
            "trip_type": "round_trip",
            "passengers": 2,
        }
    planner = LlmPlanner(llm, BASELINE_CAPABILITIES, max_calls=1)
    started = perf_counter()
    try:
        output = await planner.plan(
            PlannerInput(
                intake=intake_result(domains=domains, values=values),
                session=SessionContext(),
                available_agents=list(BASELINE_CAPABILITIES),
            )
        )
        assert planner.last_call_count == 1 and not output.plan.commit_actions
        tasks = output.plan.tasks
        assert tasks and tasks[0].agent == domains[0]
        if case == "mixed":
            assert tasks[0].inputs["max_price_vnd"] == 5_000_000
            assert not any(task.agent == AgentName.RELOCATION for task in tasks)
        elif case == "comparison":
            assert (
                tasks[0].inputs["housing_mode"] == "compare" and tasks[0].inputs["listing_ids"] == values["listing_ids"]
            )
        elif case == "map":
            assert tasks[0].inputs["near"] == "Hồ Gươm" and not tasks[0].depends_on
        else:
            assert len(tasks) == 1 and tasks[0].inputs["trip_type"] == "round_trip"
            assert tasks[0].inputs["passengers"] == {"adults": 2}
        print(
            {
                "case": case,
                "llm_calls": planner.last_call_count,
                "input_tokens": planner.usage.tokens_in,
                "output_tokens": planner.usage.tokens_out,
                "wall_s": round(perf_counter() - started, 2),
            }
        )
    finally:
        await llm.close()


async def test_real_read_domain_uses_grounded_combined_search():
    config = settings()
    adapter = Housing()
    agent = ReadLlmAgent(config.openai_api_key.get_secret_value(), config.agent_housing_model, adapter)
    req = request().model_copy(update={"retrieval_only": False, "goal": "Tìm nhà ở Ocean Park 2 dưới 5 triệu."})
    req.budget.max_llm_calls = 2
    try:
        result = await agent.run(req)
        assert result.status == "done" and len(adapter.requests) == 1
        assert adapter.requests[0].inputs["max_price_vnd"] == 5_000_000
        assert result.data["candidates"][0]["id"] == "actual-provider-id"
        assert result.usage.llm_calls <= 2
        print(
            {
                "case": "property_read",
                "llm_calls": result.usage.llm_calls,
                "input_tokens": result.usage.tokens_in,
                "output_tokens": result.usage.tokens_out,
            }
        )
    finally:
        await agent.close()
