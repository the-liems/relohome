"""Invocation dependencies, supplied via LangGraph context rather than checkpoint state.

See https://docs.langchain.com/oss/python/langgraph/use-graph-api#add-runtime-configuration
Every node reads `runtime.context.deps`, so every run and resume passes `run_kwargs(...)`.
"""

from dataclasses import dataclass, field

from relohome_agent.agents.deps import GraphDeps


@dataclass(frozen=True)
class GraphContext:
    deps: GraphDeps = field(repr=False)
