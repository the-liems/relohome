"""LangGraph callbacks that preserve OTEL context inside async nodes."""

import os

from langfuse.langchain import CallbackHandler


def graph_callbacks() -> list[CallbackHandler]:
    # Avoid callback bookkeeping when no observations can be exported.
    if (
        os.getenv("LANGFUSE_TRACING_ENABLED", "true").lower() == "false"
        or os.getenv("OTEL_SDK_DISABLED", "false").lower() == "true"
        or not os.getenv("LANGFUSE_PUBLIC_KEY")
        or not os.getenv("LANGFUSE_SECRET_KEY")
    ):
        return []
    # Keep run state per invocation and context changes on the graph's task.
    handler = CallbackHandler()
    handler.run_inline = True
    return [handler]
