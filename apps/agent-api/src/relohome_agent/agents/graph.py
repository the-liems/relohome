"""Dựng graph LangGraph theo agent-graph.md §4.

Topology cố định; kế hoạch (Dependency DAG) là dữ liệu trong state. Node `*_agent` được tạo động từ
`deps.agents`: lĩnh vực chưa đăng ký thì không có node.
"""

from __future__ import annotations

import inspect
import sys
from collections.abc import Iterable

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.checkpoint.serde.jsonplus import JsonPlusSerializer
from langgraph.graph import END, START, StateGraph
from langgraph.runtime import Runtime
from relohome_agent.agents import models
from relohome_agent.agents.context import GraphContext
from relohome_agent.agents.deps import GraphDeps
from relohome_agent.agents.execution import execute_agent
from relohome_agent.agents.models import AgentName
from relohome_agent.agents.nodes.await_payment import await_payment
from relohome_agent.agents.nodes.change_impact import change_impact
from relohome_agent.agents.nodes.confirm import confirm
from relohome_agent.agents.nodes.cost_summary import cost_summary
from relohome_agent.agents.nodes.executor import executor
from relohome_agent.agents.nodes.intake import intake
from relohome_agent.agents.nodes.load_context import load_context
from relohome_agent.agents.nodes.moving_quote import (
    moving_quote_agent,
    moving_quote_respond,
    moving_quote_summary,
    moving_quote_validate,
)
from relohome_agent.agents.nodes.orchestrator import orchestrator
from relohome_agent.agents.nodes.respond import respond
from relohome_agent.agents.nodes.transaction import transaction
from relohome_agent.agents.nodes.validator import validator
from relohome_agent.agents.routing import (
    agent_node_name,
    route_from_await_payment,
    route_from_confirm,
    route_from_cost_summary,
    route_from_executor,
    route_from_intake,
    route_from_orchestrator,
    route_from_start,
    route_from_transaction,
    route_from_validator,
)
from relohome_agent.agents.state import AgentInput, WorkflowState
from relohome_agent.agents.telemetry import graph_callbacks, preview_metadata

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


def make_agent_node(name: AgentName):
    async def agent_node(inp: AgentInput, runtime: Runtime[GraphContext]) -> dict:
        # Executor allocated disjoint budgets for this wave before LangGraph Send.
        deps = runtime.context.deps
        return await execute_agent(deps, name, deps.agents.get(name), inp)

    agent_node.__name__ = agent_node_name(name.value)
    return agent_node


def build_graph(agents: Iterable[AgentName], checkpointer: BaseCheckpointSaver | None = None):
    """Topology for the registered domain agents; every run supplies its GraphContext (see `run_kwargs`)."""
    graph = StateGraph(WorkflowState, context_schema=GraphContext)
    graph.add_node("load_context", load_context)
    graph.add_node("intake", intake)
    graph.add_node("orchestrator", orchestrator)
    graph.add_node("executor", executor)
    graph.add_node("validator", validator)
    graph.add_node("cost_summary", cost_summary)
    graph.add_node("confirm", confirm)
    graph.add_node("change_impact", change_impact)
    graph.add_node("transaction", transaction)
    graph.add_node("await_payment", await_payment)
    graph.add_node("respond", respond)
    agent_nodes = []
    for name in agents:
        node = agent_node_name(name.value)
        graph.add_node(node, make_agent_node(name), input_schema=AgentInput)
        graph.add_edge(node, "executor")
        agent_nodes.append(node)

    graph.add_node("moving_quote_agent", moving_quote_agent)
    graph.add_node("moving_quote_validate", moving_quote_validate)
    graph.add_node("moving_quote_summary", moving_quote_summary)
    graph.add_node("moving_quote_respond", moving_quote_respond)
    graph.add_edge("moving_quote_agent", "moving_quote_validate")
    graph.add_edge("moving_quote_validate", "moving_quote_summary")
    graph.add_edge("moving_quote_summary", "moving_quote_respond")
    graph.add_edge("moving_quote_respond", END)
    graph.add_conditional_edges(START, route_from_start, ["load_context", "moving_quote_agent"])
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


def run_kwargs(thread_id: str, deps: GraphDeps) -> dict:
    """Keyword arguments for every graph run or resume: the thread's config and this service's dependencies."""
    return {"config": run_config(thread_id, deps), "context": GraphContext(deps=deps)}


def run_config(thread_id: str, deps: GraphDeps) -> dict:
    return {
        "configurable": {"thread_id": thread_id},
        "recursion_limit": deps.settings.recursion_limit,
        "callbacks": graph_callbacks(),
        "run_name": "relohome-agent",
        "metadata": {"langfuse_session_id": thread_id, **preview_metadata()},
    }
