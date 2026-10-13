"""Kiểm trần chi phí (agent-graph.md §7.5). Hàm thuần; số đếm lấy từ `UsageMeter`."""

from __future__ import annotations

from typing import TYPE_CHECKING

from relohome_agent.agents.models import UsageCounts

if TYPE_CHECKING:
    from relohome_agent.agents.deps import GraphSettings


def paid_slots_left(turn: UsageCounts, thread: UsageCounts, settings: GraphSettings) -> int:
    """Số task `paid` còn được dispatch trong lượt này."""
    return max(
        0,
        min(settings.max_paid_calls_per_turn - turn.paid_calls, settings.max_paid_calls_per_thread - thread.paid_calls),
    )


def llm_calls_left(turn: UsageCounts, settings: GraphSettings) -> int:
    """Số LLM call của graph (intake, orchestrator) còn được dùng trong lượt này."""
    return max(0, settings.max_llm_calls_per_turn - turn.llm_calls)


def subagent_llm_calls_left(turn: UsageCounts, settings: GraphSettings) -> int:
    return max(0, settings.max_subagent_llm_calls_per_turn - turn.subagent_llm_calls)


async def call_graph_component(component, method, inp, deps, state, node):
    """Account actual calls, including repair/refusal/failure; keep budget invocation-local."""
    from relohome_agent.agents.llm_runtime import CALL_LIMIT

    thread, request = state.get("thread_id", ""), state.get("request_id", "")
    if not getattr(component, "uses_llm", False):
        return await getattr(component, method)(inp)
    left = llm_calls_left(await deps.usage.counts(thread, request), deps.settings)
    token = CALL_LIMIT.set(left)
    try:
        return await getattr(component, method)(inp)
    finally:
        CALL_LIMIT.reset(token)
        usage = getattr(component, "usage", None)
        calls = usage.llm_calls if usage else 1
        tokens = getattr(component, "last_usage", (0, 0))
        model = getattr(getattr(component, "llm", None), "model", "unknown")
        for index in range(calls):
            await deps.usage.record_llm(
                thread, request, node, model, tokens[0] if index == 0 else 0, tokens[1] if index == 0 else 0
            )
