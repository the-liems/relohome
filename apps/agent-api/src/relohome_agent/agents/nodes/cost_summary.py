"""Node `cost_summary` — Cost & Plan Summary (agent-graph.md §6.6). Tất định, không LLM."""

from __future__ import annotations

import math
from datetime import datetime, timedelta

from relohome_agent.agents.approval import confirmation_hash
from relohome_agent.agents.deps import GraphDeps
from relohome_agent.agents.housing_operations import is_housing_comparison
from relohome_agent.agents.intake import selected_fact_key
from relohome_agent.agents.models import (
    CommitAction,
    CommitActionKind,
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
from relohome_agent.agents.state import WorkflowState


def select_options(plan: Plan, results: dict[str, TaskResult], intake: IntakeResult) -> dict[str, str]:
    """Ưu tiên lựa chọn người dùng nói trong thread này; không thì lấy phương án đầu (agent đã xếp hạng).

    Lựa chọn giao dịch của lần trước không được dùng (mức 3, §6.1)."""
    selected = {}
    for task in plan.tasks:
        result = results.get(task.id)
        if is_housing_comparison(task.agent, task.inputs) or (result and result.data.get("comparison")):
            continue  # Comparison never chooses/budgets a home or changes transaction inputs.
        if result is None or not result.quotes:
            continue
        options = {q.option_id for q in result.quotes}
        fact = intake.user_confirmed_facts.get(selected_fact_key(task.agent))
        if fact is not None and str(fact.value) not in options:
            continue  # Do not silently budget a different home when the selected price is unverified.
        choice = str(fact.value) if fact is not None and str(fact.value) in options else result.quotes[0].option_id
        selected[task.id] = choice
    return selected


def _parse_dt(value) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(str(value)) if value else None
    except ValueError:
        return None
    return parsed if parsed is not None and parsed.tzinfo is not None else None


def build_summary(
    plan: Plan,
    statuses: dict[str, TaskStatus],
    results: dict[str, TaskResult],
    intake: IntakeResult,
    committed: dict[str, Receipt],
    stale_ttl: dict[str, timedelta],
    now: datetime,
    approval_ttl: timedelta,
    price_tolerance: dict[CommitActionKind, float] | None = None,
) -> CostSummary:
    results = {k: v for k, v in results.items() if statuses.get(k) == TaskStatus.DONE}
    selected = select_options(plan, results, intake)
    committed_sources = {a.source_task_id for a in plan.commit_actions if a.id in committed}
    pending: list[CommitAction] = [a for a in plan.commit_actions if a.id not in committed]
    tolerance = {a.source_task_id: (price_tolerance or {}).get(a.kind, 0.0) for a in pending}
    lines = []
    for task_id, option_id in selected.items():
        quote = next(q for q in results[task_id].quotes if q.option_id == option_id)
        amount = int(quote.amount_vnd)
        band = tolerance.get(task_id, 0.0)
        lines.append(
            CostLine(
                task_id=task_id,
                option_id=option_id,
                label=quote.label,
                amount_vnd=amount,
                recurrence=quote.recurrence,
                committed=task_id in committed_sources,
                min_amount_vnd=math.floor(amount * (1 - band)) if band else None,
                max_amount_vnd=math.ceil(amount * (1 + band)) if band else None,
            )
        )
    counted = [line for line in lines if not line.committed]
    sources = {a.source_task_id for a in pending}
    expiries = [results[t].fetched_at + stale_ttl[t] for t in sources if t in results and t in stale_ttl]
    # Hạn báo giá thật của provider (ví dụ AhaMove mặc định 5 phút) nếu subagent trả về.
    expiries += [d for t in sources if t in results and (d := _parse_dt(results[t].data.get("expires_at")))]
    quotes_expire_at = min(expiries) if expiries else now + approval_ttl
    one_time = [line for line in counted if line.recurrence == "one_time"]
    return CostSummary(
        plan_version=plan.version,
        selected=selected,
        lines=lines,
        total_one_time_vnd=sum(line.amount_vnd for line in one_time),
        total_monthly_vnd=sum(line.amount_vnd for line in counted if line.recurrence == "monthly"),
        total_one_time_max_vnd=sum(line.max_amount_vnd or line.amount_vnd for line in one_time),
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
            deps.settings.price_tolerance,
        )
        from relohome_agent.guest_access import is_guest

        auth = []
        if is_guest(state.get("user_id")) and summary.commit_actions:
            auth = ["booking"]
            summary = summary.model_copy(update={"commit_actions": []})
        update: dict = {"cost_summary": summary, "auth_required": auth}
        if not summary.commit_actions:  # chỉ tìm / báo giá (S2): không cần xác nhận
            update["outcome"] = Outcome(node="cost_summary", code=OutcomeCode.ANSWER)
        return update

    return cost_summary
