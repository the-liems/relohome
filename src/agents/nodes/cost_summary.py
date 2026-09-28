"""Node `cost_summary` — Cost & Plan Summary (agent-graph.md §6.6). Tất định, không LLM."""

from __future__ import annotations

from datetime import datetime, timedelta

from src.agents.approval import confirmation_hash
from src.agents.deps import GraphDeps
from src.agents.intake import selected_fact_key
from src.agents.models import (
    CommitAction,
    CostLine,
    CostSummary,
    IntakeResult,
    Outcome,
    OutcomeCode,
    Plan,
    Receipt,
    TaskResult,
    TaskStatus,
    active_commits,
)
from src.agents.state import WorkflowState


def select_options(plan: Plan, results: dict[str, TaskResult], intake: IntakeResult) -> dict[str, str]:
    """Ưu tiên lựa chọn người dùng nói trong thread này; không thì lấy phương án đầu (agent đã xếp hạng).

    Lựa chọn giao dịch của lần trước không được dùng (mức 3, §6.1)."""
    selected = {}
    for task in plan.tasks:
        result = results.get(task.id)
        if result is None or not result.quotes:
            continue
        options = {q.option_id for q in result.quotes}
        fact = intake.user_confirmed_facts.get(selected_fact_key(task.agent))
        choice = str(fact.value) if fact is not None and str(fact.value) in options else result.quotes[0].option_id
        selected[task.id] = choice
    return selected


def build_summary(
    plan: Plan,
    statuses: dict[str, TaskStatus],
    results: dict[str, TaskResult],
    intake: IntakeResult,
    committed: dict[str, Receipt],
    stale_ttl: dict[str, timedelta],
    now: datetime,
    approval_ttl: timedelta,
) -> CostSummary:
    results = {k: v for k, v in results.items() if statuses.get(k) == TaskStatus.DONE}
    selected = select_options(plan, results, intake)
    committed_sources = {a.source_task_id for a in plan.commit_actions if a.id in committed}
    lines = []
    for task_id, option_id in selected.items():
        quote = next(q for q in results[task_id].quotes if q.option_id == option_id)
        lines.append(
            CostLine(
                task_id=task_id,
                option_id=option_id,
                label=quote.label,
                amount_vnd=int(quote.amount_vnd),
                recurrence=quote.recurrence,
                committed=task_id in committed_sources,
            )
        )
    pending: list[CommitAction] = [a for a in plan.commit_actions if a.id not in committed]
    counted = [line for line in lines if not line.committed]
    sources = {a.source_task_id for a in pending}
    expiries = [results[t].fetched_at + stale_ttl[t] for t in sources if t in results and t in stale_ttl]
    quotes_expire_at = min(expiries) if expiries else now + approval_ttl
    return CostSummary(
        plan_version=plan.version,
        selected=selected,
        lines=lines,
        total_one_time_vnd=sum(line.amount_vnd for line in counted if line.recurrence == "one_time"),
        total_monthly_vnd=sum(line.amount_vnd for line in counted if line.recurrence == "monthly"),
        commit_actions=pending,
        payload_hash=confirmation_hash(plan.version, selected, lines, pending),
        quotes_expire_at=quotes_expire_at,
    )


def make_cost_summary(deps: GraphDeps):
    async def cost_summary(state: WorkflowState) -> dict:
        """Tổng chi phí bằng số nguyên VND và `payload_hash` để xác nhận."""
        plan = state["plan"]
        ttl = {}
        for task in plan.tasks:
            capability = deps.agents.capability(task.agent)
            if capability is not None:
                ttl[task.id] = deps.settings.stale_ttl(capability)
        summary = build_summary(
            plan,
            state.get("task_status") or {},
            state.get("task_results") or {},
            state["intake"],
            active_commits(state.get("committed")),
            ttl,
            deps.clock(),
            deps.settings.approval_ttl,
        )
        update: dict = {"cost_summary": summary}
        if not summary.commit_actions:  # chỉ tìm / báo giá (S2): không cần xác nhận
            update["outcome"] = Outcome(node="cost_summary", code=OutcomeCode.ANSWER)
        return update

    return cost_summary
