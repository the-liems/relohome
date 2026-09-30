"""Node `orchestrator` — Planner của Routing Orchestrator (agent-graph.md §6.2).

Node là vỏ: gọi `deps.planner`, `validate_plan`, tăng version và khởi tạo trạng thái task.
Đây là nơi duy nhất tạo hoặc sửa plan.
"""

from __future__ import annotations

import logging

from src.agents.cost import call_graph_component, llm_calls_left
from src.agents.deps import GraphDeps
from src.agents.llm import LLMError
from src.agents.models import (
    Outcome,
    OutcomeCode,
    Plan,
    RequestKind,
    TaskStatus,
    active_commits,
    error_record,
)
from src.agents.planning import PlannerInput, validate_plan
from src.agents.state import WorkflowState

logger = logging.getLogger(__name__)


def _signature(plan: Plan) -> list:
    return sorted((t.id, t.agent.value, repr(sorted(t.inputs.items())), tuple(t.depends_on)) for t in plan.tasks)


def initial_status(
    new: Plan, old: Plan | None, state: WorkflowState, deps: GraphDeps, reuse: bool, invalidated: set[str]
) -> dict[str, TaskStatus]:
    """DONE cho task giữ nguyên từ plan cũ mà kết quả còn hợp lệ; còn lại PENDING (kể cả NEEDS_INPUT)."""
    statuses = state.get("task_status") or {}
    results = state.get("task_results") or {}
    now = deps.clock()
    out: dict[str, TaskStatus] = {}
    for task in _topological(new):
        previous = old.task(task.id) if (old and reuse) else None
        result = results.get(task.id)
        capability = deps.agents.capability(task.agent)
        fresh = (
            result is not None
            and capability is not None
            and result.fetched_at + deps.settings.stale_ttl(capability) > now
        )
        reusable = (
            previous == task
            and task.id not in invalidated
            and statuses.get(task.id) == TaskStatus.DONE
            and fresh
            and all(out.get(d) == TaskStatus.DONE for d in task.depends_on)
        )
        out[task.id] = TaskStatus.DONE if reusable else TaskStatus.PENDING
    return out


def _topological(plan: Plan):
    done: set[str] = set()
    ordered = []
    remaining = list(plan.tasks)
    while remaining:
        ready = [t for t in remaining if set(t.depends_on) <= done]
        if not ready:  # chu trình đã bị validate_plan chặn; phòng thủ
            ordered.extend(remaining)
            break
        for task in ready:
            ordered.append(task)
            done.add(task.id)
        remaining = [t for t in remaining if t.id not in done]
    return ordered


def make_orchestrator(deps: GraphDeps):
    async def orchestrator(state: WorkflowState) -> dict:
        """Lập / lập lại plan; route sang respond nếu plan rỗng, lỗi hoặc vượt trần."""
        now = deps.clock()
        intake = state["intake"]
        previous: Plan | None = state.get("plan")
        validation = state.get("validation")
        change = state.get("change_context")
        is_replan = bool((validation and validation.action == "REPLAN") or change is not None)
        replan_count = (state.get("replan_count") or 0) + (1 if is_replan else 0)

        def stop(code: OutcomeCode, detail: str, errors: list[str] | None = None) -> dict:
            update: dict = {
                "outcome": Outcome(node="orchestrator", code=code, detail=detail),
                "replan_count": replan_count,
            }
            if errors:
                update["errors"] = [error_record("orchestrator", e, now) for e in errors]
            return update

        if replan_count > deps.settings.max_replans:
            return stop(OutcomeCode.MAX_REPLANS, "đã lập lại kế hoạch quá số lần cho phép")
        if change is not None and change.blocked_by_commit and not change.invalidated_task_ids:
            return stop(OutcomeCode.CHANGE_BLOCKED, ",".join(change.blocked_by_commit))
        uses_llm = getattr(deps.planner, "uses_llm", False)
        if uses_llm:
            counts = await deps.usage.counts(state.get("thread_id", ""), state.get("request_id", ""))
            if llm_calls_left(counts, deps.settings) <= 0:
                return stop(OutcomeCode.BUDGET, "hết lượt LLM trong lượt này")
        committed = active_commits(state.get("committed"))
        reuse = intake.kind != RequestKind.NEW_GOAL
        try:
            out = await call_graph_component(
                deps.planner,
                "plan",
                PlannerInput(
                    intake=intake,
                    session=state.get("session"),
                    previous_plan=previous if reuse else None,
                    previous_results={k: v for k, v in (state.get("task_results") or {}).items()} if reuse else {},
                    validation=validation,
                    change_context=change,
                    available_agents=deps.agents.names(),
                    committed=committed,
                ),
                deps,
                state,
                "orchestrator",
            )
        except Exception as exc:
            code = exc.code if isinstance(exc, LLMError) else "PLANNER_INTERNAL_ERROR"
            detail = exc.message if isinstance(exc, LLMError) else "Bộ lập kế hoạch gặp lỗi nội bộ."
            logger.warning("planner failed: %s", code)
            return stop(OutcomeCode.ERROR, f"[{code}] {detail}", [code])
        plan = out.plan
        if not plan.tasks:
            return stop(OutcomeCode.PLAN_EMPTY, "không có task nào")
        problems = validate_plan(plan, deps.agents, intake, committed, previous if reuse else None)
        if problems:
            return stop(OutcomeCode.PLAN_INVALID, "; ".join(problems[:3]), problems)
        if (
            validation is not None
            and validation.action == "REPLAN"
            and previous
            and _signature(plan) == _signature(previous)
        ):
            # Planner không đổi được gì thì lặp lại cũng vô ích.
            return stop(OutcomeCode.GIVE_UP, "không có phương án khác")
        version = (previous.version if previous else 0) + 1
        new_plan = plan.model_copy(update={"version": version})
        invalidated = set(change.invalidated_task_ids) if change else set()
        statuses = initial_status(new_plan, previous, state, deps, reuse, invalidated)
        attempts = {tid: 0 for tid, s in statuses.items() if s == TaskStatus.PENDING}
        return {
            "plan": new_plan,
            "replan_count": replan_count,
            "task_status": statuses,
            "task_attempts": attempts,
            "validation": None,
            "user_decision": None,
            "cost_summary": None,
            "change_context": None,
            "dispatch": [],
        }

    return orchestrator
