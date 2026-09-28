"""Kiểm trần chi phí (agent-graph.md §7.5). Hàm thuần; số đếm lấy từ `UsageMeter`."""

from __future__ import annotations

from typing import TYPE_CHECKING

from src.agents.models import UsageCounts

if TYPE_CHECKING:
    from src.agents.deps import GraphSettings


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
