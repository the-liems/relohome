"""Node `executor` — Executor của Routing Orchestrator (agent-graph.md §6.4).

Code thuần: tính task READY, chọn task gửi đi song song, đếm lượt. Không bao giờ sửa plan.
"""

from __future__ import annotations

from relohome_agent.agents.cost import paid_slots_left, subagent_llm_calls_left
from relohome_agent.agents.deps import GraphDeps
from relohome_agent.agents.models import AgentUsage, Plan, TaskResult, TaskStatus
from relohome_agent.agents.state import WorkflowState

S = TaskStatus


def compute_ready(
    plan: Plan, task_status: dict[str, TaskStatus], task_attempts: dict[str, int], max_attempts: int
) -> tuple[dict[str, TaskStatus], list[str]]:
    """Trả (trạng thái mới của các task thay đổi, id task READY còn lượt theo thứ tự plan)."""
    status = {t.id: task_status.get(t.id, S.PENDING) for t in plan.tasks}
    changed: dict[str, TaskStatus] = {}

    def put(task_id: str, value: TaskStatus) -> None:
        if status[task_id] != value:
            status[task_id] = changed[task_id] = value

    progress = True
    while progress:
        progress = False
        for task in plan.tasks:
            current = status[task.id]
            if current not in (S.PENDING, S.STALE):
                continue
            deps = [status.get(d, S.PENDING) for d in task.depends_on]
            if any(d in (S.FAILED, S.SKIPPED) for d in deps):
                put(task.id, S.SKIPPED)
                progress = True
            elif all(d == S.DONE for d in deps):
                put(task.id, S.READY)
                progress = True
            elif current == S.STALE:
                put(task.id, S.PENDING)
    ready = []
    for task in plan.tasks:
        if status[task.id] != S.READY:
            continue
        if task_attempts.get(task.id, 0) >= max_attempts:
            put(task.id, S.FAILED)
        else:
            ready.append(task.id)
    return changed, ready


def make_executor(deps: GraphDeps):
    async def executor(state: WorkflowState) -> dict:
        """Chọn task READY để `Send` (tối đa `max_parallel_tasks`), kiểm trần task `paid`."""
        plan = state["plan"]
        now = deps.clock()
        statuses = dict(state.get("task_status") or {})
        attempts = dict(state.get("task_attempts") or {})
        # Task RUNNING mà không có kết quả sau fan-in là bị mất (không nên xảy ra): coi như FAILED.
        lost = {t.id: S.FAILED for t in plan.tasks if statuses.get(t.id) == S.RUNNING}
        statuses.update(lost)
        changed, ready = compute_ready(plan, statuses, attempts, deps.settings.max_task_attempts)
        changed = {**lost, **changed}
        thread_id, request_id = state.get("thread_id", ""), state.get("request_id", "")
        slots = None
        llm_left = subagent_llm_calls_left(await deps.usage.counts(thread_id, request_id), deps.settings)
        budgets: dict[str, int] = {}
        dispatch: list[str] = []
        failures: dict[str, TaskResult] = {}
        for task_id in ready:
            if len(dispatch) >= deps.settings.max_parallel_tasks:
                break  # task READY còn lại chờ vòng sau
            task = plan.task(task_id)
            capability = deps.agents.capability(task.agent)
            wanted = capability.default_budget.max_llm_calls if capability else 0
            # Reserve a whole invocation before fan-out. If another task can free
            # unused budget at fan-in, defer this task instead of starving it.
            if wanted > llm_left and dispatch:
                continue
            if capability is not None and capability.cost_tier == "paid":
                if slots is None:
                    turn = await deps.usage.counts(thread_id, request_id)
                    whole = await deps.usage.counts(thread_id)
                    slots = paid_slots_left(turn, whole, deps.settings)
                if slots <= 0:
                    changed[task_id] = S.FAILED
                    failures[task_id] = TaskResult(
                        task_id=task_id,
                        agent=task.agent,
                        plan_version=plan.version,
                        status="failed",
                        source="graph",
                        fetched_at=now,
                        usage=AgentUsage(),
                        error="budget_exceeded: vượt trần chi phí",
                        error_code="budget_exceeded",
                        retryable=False,
                    )
                    continue
                slots -= 1
            dispatch.append(task_id)
            budgets[task_id] = min(wanted, llm_left)
            llm_left -= budgets[task_id]
            changed[task_id] = S.RUNNING
            attempts[task_id] = attempts.get(task_id, 0) + 1
        update: dict = {
            "task_status": changed,
            "dispatch": dispatch,
            "dispatch_llm_budgets": budgets,
            "task_attempts": {tid: attempts[tid] for tid in dispatch},
        }
        if failures:
            update["task_results"] = failures
        return update

    return executor
