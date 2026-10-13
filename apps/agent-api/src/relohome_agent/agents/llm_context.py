"""Decision-focused views, separate from authoritative workflow/provider data.

No LLM summaries, keyword routing or list truncation. Unknown fields are kept;
only known presentation/debug fields are removed. Facts, IDs, sources, monetary
units, uncertainty, expiry, coordinates and assessments remain available.
"""

from __future__ import annotations

import json
from typing import Any

from relohome_agent.agents.llm_runtime import public_data
from relohome_roommate.agent_projection import reference_data

# These keys describe rendering, tracing or repeated schema, not domain facts.
PRESENTATION_KEYS = frozenset(
    {"thumbnail_url", "images", "map_context", "agent_trace", "execution", "usage", "geometry", "polyline"}
)


def decision_data(value: Any) -> Any:
    """New, redacted projection; never mutate stored results or drop unknown facts."""

    def project(item):
        if isinstance(item, dict):
            return {key: project(val) for key, val in item.items() if key not in PRESENTATION_KEYS}
        if isinstance(item, (list, tuple)):
            return [project(val) for val in item]
        return item

    return public_data(project(value))


def result_context(result) -> dict:
    """One result with its provenance and freshness, without duplicate quote rows."""
    return decision_data(
        {
            "status": result.status,
            "source": result.source,
            "source_kind": result.source_kind,
            "source_refs": result.source_refs,
            "fetched_at": result.fetched_at.isoformat(),
            "missing_fields": result.missing_fields,
            "questions": [q.model_dump(mode="json") for q in result.questions],
            "error": result.error.model_dump(mode="json") if hasattr(result.error, "model_dump") else result.error,
            "data": reference_data(result.data) if getattr(result, "agent", None) == "roommate" else result.data,
        }
    )


def model_json(value: Any) -> str:
    """Compact JSON is for model input only, not the API/UI response contract."""
    return json.dumps(decision_data(value), ensure_ascii=False, separators=(",", ":"), default=str)


def compact_tool_history(history: list, *, superseded: set[str]) -> None:
    """Replace repeated snapshots, keeping all call/output and reasoning items.

    The latest result remains complete in its decision projection. Earlier snapshots
    of the SAME tool are unnecessary, but retain the protocol pair and a short marker.
    Detail/preparation outputs are retained because they can contain distinct facts.
    """
    latest: dict[str, int] = {}
    names: dict[str, str] = {}
    for index, item in enumerate(history):
        kind = item.get("type") if isinstance(item, dict) else getattr(item, "type", None)
        if kind == "function_call":
            call_id = item.get("call_id") if isinstance(item, dict) else item.call_id
            name = item.get("name") if isinstance(item, dict) else item.name
            names[call_id] = name
        elif kind == "function_call_output":
            name = names.get(item["call_id"])
            if name in superseded:
                if name in latest:
                    history[latest[name]]["output"] = model_json({"superseded_by_latest_result": name})
                latest[name] = index
