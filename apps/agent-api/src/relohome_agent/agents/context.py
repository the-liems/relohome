"""Invocation dependencies, supplied via LangGraph context rather than checkpoint state.

See https://docs.langchain.com/oss/python/langgraph/use-graph-api#add-runtime-configuration
Quote runs and checkpoint resumes must supply GraphContext. Existing chat nodes
continue to use their construction-time dependencies.
"""

from dataclasses import dataclass, field

from relohome_agent.agents.deps import GraphDeps


@dataclass(frozen=True)
class GraphContext:
    deps: GraphDeps = field(repr=False)
