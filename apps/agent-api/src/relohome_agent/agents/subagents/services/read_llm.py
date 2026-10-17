"""Bounded, mission-driven domain agents with grounded read tools."""

from __future__ import annotations

import asyncio
import logging
from datetime import timedelta
from time import perf_counter

from jsonschema import Draft202012Validator
from langfuse.openai import AsyncOpenAI
from openai import APIError
from relohome_agent.agents.common import utcnow
from relohome_agent.agents.contracts import AgentTaskRequest, AgentTaskResult, failed_result, reject_unsupported
from relohome_agent.agents.llm import LLMError
from relohome_agent.agents.llm_context import compact_tool_history, decision_data, model_json
from relohome_agent.agents.llm_provider import client_options, provider_model
from relohome_agent.agents.llm_runtime import Invocation, json_object
from relohome_agent.agents.models import AgentName
from relohome_agent.agents.subagents.base import AgentTransportError
from relohome_agent.agents.subagents.services.common import BudgetExceededError
from relohome_agent.agents.subagents.services.domain_tools import DomainToolSession
from relohome_agent.agents.task_prompts import READ_CORE, READ_DOMAINS
from relohome_agent.services.adapters.mcp import ToolCallError

logger = logging.getLogger(__name__)
MAX_DOMAIN_CALLS = 6


class ReadLlmAgent:
    """Separate domain missions and tool namespaces; one invocation-local runtime."""

    def __init__(self, key, model, adapter):
        self.api_key, self.model, self.adapter = key, model, adapter
        self.client = adapter.client
        self.llm_client = None
        self.capability = adapter.capability.model_copy(deep=True)
        self.capability.uses_llm = True
        self.capability.default_budget.max_llm_calls = MAX_DOMAIN_CALLS
        self.capability.default_budget.max_provider_calls += 3
        self.capability.commit_kinds = []

    async def close(self):
        if self.llm_client:
            await self.llm_client.close()

    async def run(self, req: AgentTaskRequest) -> AgentTaskResult:
        domain = self.capability.agent
        source_kind = "sandbox" if domain == AgentName.PAYMENT else "live"
        source = "lifeflow-" + domain.value
        if rejected := reject_unsupported(req, source, source_kind):
            return rejected
        if req.agent != domain or not Draft202012Validator(self.capability.input_schema).is_valid(req.inputs):
            return failed_result(
                req, "invalid_input", "Task không đúng capability của subagent.", False, source, source_kind
            )
        if hasattr(self.adapter, "authorized") and not self.adapter.authorized(req):
            return failed_result(
                req, "invalid_input", "Không tìm thấy thanh toán thuộc người dùng hiện tại.", False, source, source_kind
            )
        run = Invocation(
            max_calls=min(req.budget.max_llm_calls, MAX_DOMAIN_CALLS),
            deadline=min(
                req.budget.deadline_at or utcnow() + timedelta(seconds=100), utcnow() + timedelta(seconds=100)
            ),
        )
        session = DomainToolSession(req, self.adapter)
        trace, decisions = [], []
        started = perf_counter()
        timing = {"llm_ms": 0, "tool_ms": 0}
        history = [
            {
                "role": "user",
                "content": model_json(
                    decision_data(
                        {
                            "domain": domain.value,
                            "goal": req.goal,
                            "user_request": req.user_request,
                            "inputs": req.inputs,
                            "constraints": req.constraints,
                            "hints": req.hints,
                            "upstream": {
                                k: {"agent": v.agent.value, "source_refs": v.source_refs, "data": v.data}
                                for k, v in req.upstream.items()
                            },
                            "limits": {"llm_calls": run.max_calls, "provider_calls": req.budget.max_provider_calls},
                        }
                    ),
                ),
            }
        ]

        def finish():
            result = session.result
            run.usage.provider_calls = session.tools.calls
            run.usage.cached_calls = session.tools.cached_calls
            result.usage = run.usage.model_copy()
            result.data["agent_trace"] = {
                "implementation": "llm-tool-loop",
                "policy": "mission-driven-v3-facts-completion",
                "domain": domain.value,
                "tools": trace,
                "decisions": decisions,
                "model": self.model,
                "cached_calls": session.tools.cached_calls,
                "timing": {**timing, "total_ms": round((perf_counter() - started) * 1000)},
            }
            return result

        try:
            if (
                req.retrieval_only
                and domain == AgentName.PROPERTY
                and req.inputs.get("housing_mode", "search") == "search"
                and "listing_ids" not in req.inputs
                and not req.upstream
                and not req.hints
                and req.attempt == 1
            ):
                # Use the existing grounded tool, including provider resolution,
                # ambiguity, hard filters, pagination and normal usage accounting.
                # No synthetic ranking/assessment or provider facts are introduced.
                trace.append("search_housing_and_return")
                call_started = perf_counter()
                async with asyncio.timeout(run.remaining()):
                    await session.execute("search_housing_and_return", {"limit": req.inputs.get("limit")})
                timing["tool_ms"] += round((perf_counter() - call_started) * 1000)
                result = finish()
                result.data["agent_trace"]["implementation"] = "validated-filter-retrieval"
                return result
            if self.llm_client is None:
                self.llm_client = AsyncOpenAI(
                    api_key=self.api_key, max_retries=0, timeout=45, **client_options(self.api_key)
                )
            while True:
                available = session.available(
                    final_call=run.usage.llm_calls >= run.max_calls - 1 and session.result is not None
                )
                # Reserve one call for assessment, not only preparation.
                if session.result is None and run.usage.llm_calls >= run.max_calls - 2:
                    available = [
                        t for t in available if t["name"] not in {"resolve_location", "search_areas", "search_airports"}
                    ]
                run.reserve()
                call_started = perf_counter()
                async with asyncio.timeout(run.remaining()):
                    reply = await self.llm_client.responses.create(
                        model=provider_model(self.api_key, self.model),
                        instructions=READ_CORE + "\n" + READ_DOMAINS[domain],
                        input=history,
                        tools=available,
                        tool_choice="required",
                        parallel_tool_calls=False,
                        max_output_tokens=900,
                        store=False,
                        **({"reasoning": {"effort": "none"}} if self.model == "gpt-6-luna" else {}),
                        **({"temperature": 0} if self.model.startswith(("gpt-4.1", "gpt-4o")) else {}),
                    )
                timing["llm_ms"] += round((perf_counter() - call_started) * 1000)
                if reply.usage:
                    run.usage.tokens_in += reply.usage.input_tokens
                    run.usage.tokens_out += reply.usage.output_tokens
                calls = [o for o in reply.output if o.type == "function_call"]
                if reply.status != "completed" or len(calls) != 1:
                    raise ValueError("LLM must return one completed tool call")
                history.extend(reply.output)
                call = calls[0]
                args = json_object(call.arguments)
                schema = next((t["parameters"] for t in available if t["name"] == call.name), None)
                if schema is None or not Draft202012Validator(schema).is_valid(args):
                    raise ValueError("Invalid or unobserved tool argument")
                trace.append(call.name)
                decisions.append({"tool": call.name, **{k: args[k] for k in ("field", "id", "limit") if k in args}})
                call_started = perf_counter()
                async with asyncio.timeout(run.remaining()):
                    output, terminal = await session.execute(call.name, args)
                timing["tool_ms"] += round((perf_counter() - call_started) * 1000)
                if terminal:
                    return finish()
                history.append(
                    {
                        "type": "function_call_output",
                        "call_id": call.call_id,
                        "output": model_json(output),
                    }
                )
                compact_tool_history(history, superseded={"search_housing", "search_flights"})
        except (
            LLMError,
            TimeoutError,
            APIError,
            ToolCallError,
            AgentTransportError,
            BudgetExceededError,
            ValueError,
            KeyError,
            TypeError,
        ) as exc:
            logger.warning(
                "Domain tool loop failed domain=%s cause=%s", domain.value, type(exc).__name__, exc_info=True
            )
            run.usage.provider_calls = session.tools.calls
            run.usage.cached_calls = session.tools.cached_calls
            code = (
                "budget_exceeded"
                if isinstance(exc, BudgetExceededError) or (isinstance(exc, LLMError) and exc.code == "LLM_BUDGET")
                else "timeout"
                if isinstance(exc, TimeoutError)
                else "provider_unavailable"
            )
            failure = failed_result(
                req,
                code,
                "Subagent chưa hoàn thành vòng tool; không dùng dữ liệu suy đoán.",
                False,
                source,
                source_kind,
                run.usage,
            )
            failure.data["agent_trace"] = {
                "implementation": "llm-tool-loop",
                "policy": "mission-driven-v3-facts-completion",
                "domain": domain.value,
                "tools": trace,
                "decisions": decisions,
                "model": self.model,
                "failure_code": exc.code if isinstance(exc, ToolCallError) else type(exc).__name__,
                "timing": {**timing, "total_ms": round((perf_counter() - started) * 1000)},
            }
            return failure
