"""Opt-in paid Intake checks; domain providers are fixtures, never real Housing/transactions.

RUN_HOUSING_FILTER_LIVE=1 python -m pytest <this file> --env-test <vendor-config>
Default skip. At most nine generations, no hidden model fallback/repair.
"""

import json
import os
from time import perf_counter

import pytest
from langchain_core.messages import HumanMessage
from relohome_agent.agents.deps import AgentRegistry, fake_registry, test_deps
from relohome_agent.agents.intake import IntakeInput
from relohome_agent.agents.intake_llm import LlmIntake
from relohome_agent.agents.llm import StructuredLLM
from relohome_agent.agents.models import AgentName, SessionContext
from relohome_agent.agents.planner_llm import LlmPlanner
from relohome_agent.agents.subagents.capabilities import BASELINE_CAPABILITIES
from relohome_agent.agents.subagents.services.read_llm import ReadLlmAgent
from relohome_agent.config import Settings

from tests import live
from tests.test_agents.helpers import Session
from tests.test_agents.test_housing_filter_followups import BASE, FIRST, prior
from tests.test_agents.test_token_efficiency import Housing, Model

pytestmark = [
    pytest.mark.asyncio,
    pytest.mark.skipif(os.getenv("RUN_HOUSING_FILTER_LIVE") != "1", reason="Paid Intake-only opt-in; domain fixtures"),
]
DOMAINS = [AgentName.PROPERTY, AgentName.MAP, AgentName.RELOCATION, AgentName.FLIGHT, AgentName.PAYMENT]


class MeteredModel(StructuredLLM):
    """Measure in the invocation's context, not the parent LangGraph caller's ContextVar."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.samples = []

    async def parse(self, instructions, data, schema):
        try:
            return await super().parse(instructions, data, schema)
        finally:
            self.samples.append(self.last_usage)


def configured_model(monkeypatch):
    monkeypatch.setenv("LANGFUSE_TRACING_ENABLED", "false")
    monkeypatch.setenv("OTEL_SDK_DISABLED", "true")
    return MeteredModel(
        live.env_test("OPENAI_API_KEY"),
        live.env_test("AGENT_INTAKE_MODEL", required=False)
        or Settings.model_fields["agent_intake_model"].default,
        max_output_tokens=2000,
    )


async def test_real_intake_multi_turn_edits_use_one_generation_and_preserve_exact_filters(monkeypatch):
    llm = configured_model(monkeypatch)
    intake = LlmIntake(llm, max_calls=1)
    planner_model, adapter = Model(), Housing()
    agent = ReadLlmAgent("unused-key", "unused-model", adapter)
    fake = fake_registry()
    registry = AgentRegistry({name: agent if name == AgentName.PROPERTY else fake.get(name) for name in DOMAINS})
    deps = test_deps(
        intake=intake, planner=LlmPlanner(planner_model, BASELINE_CAPABILITIES, max_calls=1), agents=registry
    )
    session = Session(deps)
    turns = [
        (FIRST, dict(BASE)),
        ("Giảm xuống dưới 4 triệu.", {**BASE, "max_price_vnd": 4_000_000}),
        (
            "Thêm điều kiện có điều hòa.",
            {**BASE, "max_price_vnd": 4_000_000, "must_have": ["internet", "air_conditioning"]},
        ),
        ("Bỏ điều kiện điều hòa.", {**BASE, "max_price_vnd": 4_000_000}),
        ("Chuyển sang Đà Nẵng, giữ mức giá.", {**BASE, "city": "Đà Nẵng", "max_price_vnd": 4_000_000}),
        ("Tìm căn khác.", {**BASE, "city": "Đà Nẵng", "max_price_vnd": 4_000_000}),
        ("Không giới hạn giá nữa.", {"city": "Đà Nẵng", "must_have": ["internet"]}),
    ]
    try:
        for index, (text, expected) in enumerate(turns, 1):
            started = perf_counter()
            state = await session.say(text)
            print(
                "HOUSING_FILTER_MODEL "
                + json.dumps(
                    {
                        "turn": index,
                        "model": llm.model,
                        "calls_total": len(llm.samples),
                        "tokens_in": llm.samples[-1][0],
                        "tokens_out": llm.samples[-1][1],
                        "wall_s": round(perf_counter() - started, 3),
                        "kind": state["response"].kind,
                        "filters": state["intake"].constraints.values,
                    },
                    ensure_ascii=False,
                ),
                flush=True,
            )
            assert state["response"].kind == "ANSWER", state.get("outcome")
            actual = dict(state["intake"].constraints.values)
            actual.pop("housing_mode", None)  # Explicit/default search are equivalent.
            assert actual == expected
            assert len(adapter.requests) == index and not planner_model.calls
            counts = await deps.usage.counts("th1", f"r{index}")
            assert counts.llm_calls == 1 and counts.subagent_llm_calls == 0
            assert len(llm.samples) == index and not state.get("committed")
        assert agent.llm_client is None
    finally:
        await llm.close()


@pytest.mark.parametrize(
    "message",
    [
        "Giảm giá xuống dưới 4 triệu và báo giá chuyển đồ tới căn đó.",
        "So sánh các căn vừa tìm được, căn nào yên tĩnh hơn?",
    ],
)
async def test_real_intake_keeps_mixed_services_and_custom_assessment_off_the_shortcut(monkeypatch, message):
    llm = configured_model(monkeypatch)
    intake = LlmIntake(llm, max_calls=1)
    try:
        result = await intake.understand(
            IntakeInput(
                messages=[HumanMessage(FIRST), HumanMessage(message)],
                session=SessionContext(),
                previous=prior(),
                supported_domains=DOMAINS,
            )
        )
        assert not result.retrieval_only and intake.last_call_count == 1
    finally:
        await llm.close()
