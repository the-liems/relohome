"""Node `change_impact` — Change Impact / Compensation (agent-graph.md §6.8). Code thuần."""

from __future__ import annotations

from relohome_agent.agents.deps import GraphDeps
from relohome_agent.agents.models import AgentName, ChangeContext, Plan, TaskStatus, active_commits
from relohome_agent.agents.state import WorkflowState


def downstream_closure(plan: Plan, targets: set[str]) -> set[str]:
    """Target và mọi task phụ thuộc (trực tiếp hoặc gián tiếp) vào target theo `depends_on`."""
    affected = set(targets)
    changed = True
    while changed:
        changed = False
        for task in plan.tasks:
            if task.id not in affected and affected.intersection(task.depends_on):
                affected.add(task.id)
                changed = True
    return affected


def selection_impact(plan: Plan, source_task_id: str, domain: AgentName, previous_id: str | None) -> set[str]:
    """Selection references are dependencies even when the task fetches an entity directly."""
    targets = {source_task_id}
    if domain == AgentName.PROPERTY and previous_id:
        targets.update(
            t.id
            for t in plan.tasks
            if t.inputs.get("selected_listing_id") == previous_id or previous_id in (t.inputs.get("listing_ids") or [])
        )
    return downstream_closure(plan, targets)


def make_change_impact(deps: GraphDeps):
    async def change_impact(state: WorkflowState) -> dict:
        """Đánh dấu STALE phần bị ảnh hưởng; thứ đã đặt thì không tự huỷ (§6.8 bước 7)."""
        plan = state["plan"]
        intake = state["intake"]
        results = state.get("task_results") or {}
        ids = {t.id for t in plan.tasks}
        targets = {t for t in intake.target_task_ids if t in ids}
        if not targets:
            targets = {t.id for t in plan.tasks if (r := results.get(t.id)) is not None and r.quotes}
        committed = active_commits(state.get("committed"))
        booked_sources = {a.source_task_id: a.id for a in plan.commit_actions if a.id in committed}
        blocked = [booked_sources[t] for t in sorted(targets) if t in booked_sources]
        targets -= set(booked_sources)
        affected = downstream_closure(plan, targets) - set(booked_sources) if targets else set()
        statuses = state.get("task_status") or {}
        reusable = [t.id for t in plan.tasks if t.id not in affected and statuses.get(t.id) == TaskStatus.DONE]
        return {
            "task_status": {tid: TaskStatus.STALE for tid in affected},
            "change_context": ChangeContext(
                request=intake.change_request,
                invalidated_task_ids=sorted(affected),
                reusable_task_ids=reusable,
                blocked_by_commit=blocked,
            ),
        }

    return change_impact
