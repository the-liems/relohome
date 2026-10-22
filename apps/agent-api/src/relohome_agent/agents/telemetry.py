"""LangGraph callbacks that preserve OTEL context inside async nodes."""

import os
import re

from langfuse import get_client
from langfuse.langchain import CallbackHandler
from opentelemetry import trace
from opentelemetry.sdk.trace import ReadableSpan
from opentelemetry.trace import Status, StatusCode


def preview_metadata() -> dict[str, str]:
    """Carry PR identity on Langfuse observations, which bypass the Collector."""
    if os.getenv('OTEL_DEPLOYMENT_ENVIRONMENT') != 'preview':
        return {}
    hostname = os.getenv('PREVIEW_HOSTNAME', '')
    match = re.fullmatch(r'pr-([0-9]+)\.[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*', hostname)
    if not match:
        return {}
    return {'preview.id': match[1], 'preview.hostname': hostname,
            'service.version': os.getenv('RELEASE_SHA', '')}


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


def record_node_failure(node_name: str, error_type: str, detail: str) -> None:
    """Enrich the existing node span for errors returned as application data.

    The official callback owns span creation, timing, export and context. Never
    annotate a parent HTTP span when callbacks are disabled or used outside a graph.
    """
    span = trace.get_current_span()
    if not isinstance(span, ReadableSpan) or span.name != node_name or not span.is_recording():
        return
    detail = detail.removeprefix(f"{error_type}: ")[:500]
    span.set_attribute("error.type", error_type)
    span.set_status(Status(StatusCode.ERROR, detail))
    get_client().update_current_span(level="ERROR", status_message=detail)
