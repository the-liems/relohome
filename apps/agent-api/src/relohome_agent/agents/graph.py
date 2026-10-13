"""Dựng graph LangGraph theo agent-graph.md §4.

Topology cố định; kế hoạch (Dependency DAG) là dữ liệu trong state. Node `*_agent` được tạo động từ
`deps.agents`: lĩnh vực chưa đăng ký thì không có node.
"""

from __future__ import annotations

import inspect
import sys
import time

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.checkpoint.serde.jsonplus import JsonPlusSerializer
from langgraph.graph import END, START, StateGraph
from relohome_agent.agents import models
from relohome_agent.agents.cost import subagent_llm_calls_left
from relohome_agent.agents.deps import GraphDeps
from relohome_agent.agents.models import AgentName
from relohome_agent.agents.nodes.await_payment import make_await_payment
from relohome_agent.agents.nodes.change_impact import make_change_impact
from relohome_agent.agents.nodes.confirm import make_confirm
from relohome_agent.agents.nodes.cost_summary import make_cost_summary
from relohome_agent.agents.nodes.executor import make_executor
from relohome_agent.agents.nodes.intake import make_intake
from relohome_agent.agents.nodes.load_context import make_load_context
from relohome_agent.agents.nodes.orchestrator import make_orchestrator
from relohome_agent.agents.nodes.respond import make_respond
from relohome_agent.agents.nodes.transaction import make_transaction
from relohome_agent.agents.nodes.validator import make_validator
from relohome_agent.agents.routing import (
    agent_node_name,
    route_from_await_payment,
    route_from_confirm,
    route_from_cost_summary,
    route_from_executor,
    route_from_intake,
    route_from_orchestrator,
    route_from_transaction,
    route_from_validator,
)
from relohome_agent.agents.state import AgentInput, WorkflowState
from relohome_agent.agents.subagents.base import AgentPolicy, run_with_policy
from relohome_agent.agents.subagents.services.payment import ACTOR_ID
from relohome_observability import traced_node

LEGACY_MODELS_MODULE = "src.agents.models"  # Persisted before the ReloHome package migration.


def checkpoint_serde() -> JsonPlusSerializer:
    """Serializer chỉ cho phép khôi phục kiểu dữ liệu của graph (không mở cho mọi class)."""
    # Persisted identifiers outlive source shims; retain until old checkpoints expire.
    sys.modules[LEGACY_MODELS_MODULE] = models
    allowed = [
        (module, name)
        for name, obj in inspect.getmembers(models)
        if inspect.isclass(obj) and obj.__module__ in {models.__name__, LEGACY_MODELS_MODULE}
        for module in (models.__name__, LEGACY_MODELS_MODULE)
    ]
    return JsonPlusSerializer(allowed_msgpack_modules=allowed)


def default_checkpointer() -> BaseCheckpointSaver:
    """Dev/test: bộ nhớ trong process. Checkpointer bền vững chốt ở ADR-017 (Q3)."""
    return InMemorySaver(serde=checkpoint_serde())


def make_agent_node(deps: GraphDeps, name: AgentName):
    agent = deps.agents.get(name)
    capability = agent.capability

    async def invoke(inp: AgentInput) -> dict:
        """Gọi subagent của lĩnh vực qua `run_with_policy`; lỗi là dữ liệu, không raise."""
        thread_id, request_id = inp["thread_id"], inp["request_id"]
        counts = await deps.usage.counts(thread_id, request_id)
        policy = AgentPolicy(
            timeout_s=deps.settings.timeout_for(name),
            transport_retries=deps.settings.agent_transport_retries,
            max_subagent_llm_calls_left=min(
                inp.get("allocated_llm_calls", capability.default_budget.max_llm_calls),
                subagent_llm_calls_left(counts, deps.settings),
            ),
        )

        async def record(req, result, elapsed_ms: int) -> None:
            await deps.usage.record_subagent(
                thread_id, request_id, name, capability.cost_tier, result.usage, elapsed_ms
            )

        actor = ACTOR_ID.set(inp.get("user_id"))
        started_at, started = deps.clock(), time.monotonic()
        try:
            update = await run_with_policy(agent, inp, policy=policy, clock=deps.clock, record=record)
            for result in update.get("task_results", {}).values():
                result.data["execution"] = {
                    "request_id": request_id,
                    "started_at": started_at.isoformat(),
                    "finished_at": deps.clock().isoformat(),
                    "elapsed_ms": round((time.monotonic() - started) * 1000),
                    "allocated_llm_calls": policy.max_subagent_llm_calls_left,
                    "depends_on": list(inp["task"].depends_on),
                }
            return update
        finally:
            ACTOR_ID.reset(actor)

    async def agent_node(inp: AgentInput) -> dict:
        # Executor allocated disjoint budgets for this wave before LangGraph Send.
        return await invoke(inp)

    agent_node.__name__ = agent_node_name(name.value)
    return agent_node


def build_graph(deps: GraphDeps, checkpointer: BaseCheckpointSaver | None = None):
    graph = StateGraph(WorkflowState)
    graph.add_node("load_context", traced_node("load_context", make_load_context(deps)))
    graph.add_node("intake", traced_node("intake", make_intake(deps)))
    graph.add_node("orchestrator", traced_node("orchestrator", make_orchestrator(deps)))
    graph.add_node("executor", traced_node("executor", make_executor(deps)))
    graph.add_node("validator", traced_node("validator", make_validator(deps)))
    graph.add_node("cost_summary", traced_node("cost_summary", make_cost_summary(deps)))
    graph.add_node("confirm", traced_node("confirm", make_confirm(deps)))
    graph.add_node("change_impact", traced_node("change_impact", make_change_impact(deps)))
    graph.add_node("transaction", traced_node("transaction", make_transaction(deps)))
    graph.add_node("await_payment", traced_node("await_payment", make_await_payment(deps)))
    graph.add_node("respond", traced_node("respond", make_respond(deps)))
    agent_nodes = []
    for name in deps.agents.names():
        node = agent_node_name(name.value)
        graph.add_node(node, traced_node(node, make_agent_node(deps, name)), input_schema=AgentInput)
        graph.add_edge(node, "executor")
        agent_nodes.append(node)

    graph.add_edge(START, "load_context")
    graph.add_edge("load_context", "intake")
    graph.add_conditional_edges("intake", route_from_intake, ["respond", "change_impact", "orchestrator"])
    graph.add_conditional_edges("orchestrator", route_from_orchestrator, ["respond", "executor"])
    graph.add_edge("change_impact", "orchestrator")
    graph.add_conditional_edges("executor", route_from_executor, ["validator", *agent_nodes])
    graph.add_conditional_edges(
        "validator", route_from_validator, ["cost_summary", "executor", "orchestrator", "respond"]
    )
    graph.add_conditional_edges("cost_summary", route_from_cost_summary, ["confirm", "respond"])
    graph.add_conditional_edges("confirm", route_from_confirm, ["confirm", "transaction", "intake", "respond"])
    graph.add_conditional_edges("transaction", route_from_transaction, ["await_payment", "respond"])
    graph.add_conditional_edges("await_payment", route_from_await_payment, ["await_payment", "transaction"])
    graph.add_edge("respond", END)
    return graph.compile(checkpointer=checkpointer)


def run_config(thread_id: str, deps: GraphDeps) -> dict:
    return {"configurable": {"thread_id": thread_id}, "recursion_limit": deps.settings.recursion_limit}
