"""Node `load_context` (agent-graph.md §6.0): tải bộ nhớ người dùng, reset field theo lượt."""

from __future__ import annotations

import logging

from src.agents.deps import GraphDeps
from src.agents.models import SessionContext, error_record
from src.agents.state import WorkflowState

logger = logging.getLogger(__name__)


def make_load_context(deps: GraphDeps):
    async def load_context(state: WorkflowState) -> dict:
        """Đọc `SessionPort`; không có dữ liệu thì dùng bộ nhớ rỗng, không coi là lỗi."""
        update: dict = {
            # Field chỉ có nghĩa trong một lượt: reset để respond không đọc nhầm kết quả lượt trước.
            "outcome": None,
            "validation": None,
            "transaction": None,
            "user_decision": None,
            "change_context": None,
            "dispatch": [],
            "replan_count": 0,
            "housing_selection_changed": False,
        }
        try:
            update["session"] = await deps.session.load(state.get("user_id") or "anonymous")
        except Exception as exc:
            logger.warning("session load failed: %s", type(exc).__name__)
            update["session"] = SessionContext()
            update["errors"] = [error_record("load_context", "không đọc được bộ nhớ người dùng", deps.clock())]
        return update

    return load_context
