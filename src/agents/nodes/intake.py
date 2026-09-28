"""Node `intake` (agent-graph.md §6.1): vỏ quanh `deps.intake`, kiểm kết quả bằng code.

Node không chọn agent/tool, không tạo DAG, không tạo approval.
"""

from __future__ import annotations

import logging

from langchain_core.messages import HumanMessage

from src.agents.cost import llm_calls_left
from src.agents.deps import GraphDeps
from src.agents.intake import IntakeInput, commit_fact_key, ground_facts, resolve_missing
from src.agents.models import (
    CommitActionKind,
    IntakeResult,
    Outcome,
    OutcomeCode,
    RequestKind,
    TaskOutline,
    active_commits,
    error_record,
)
from src.agents.state import WorkflowState

logger = logging.getLogger(__name__)


def plan_outline(state: WorkflowState) -> list[TaskOutline] | None:
    plan = state.get("plan")
    if plan is None:
        return None
    results = state.get("task_results") or {}
    summary = state.get("cost_summary")
    outline = []
    for task in plan.tasks:
        result = results.get(task.id)
        options = [{"option_id": q.option_id, "label": q.label} for q in (result.quotes if result else [])][:10]
        outline.append(
            TaskOutline(
                id=task.id,
                agent=task.agent,
                options=options,
                selected=summary.selected.get(task.id) if summary else None,
            )
        )
    return outline


def make_intake(deps: GraphDeps):
    async def intake(state: WorkflowState) -> dict:
        """Hiểu yêu cầu qua `deps.intake`, rồi kiểm evidence, gộp dữ kiện và tính phần thiếu bằng code."""
        now = deps.clock()
        thread_id, request_id = state.get("thread_id", ""), state.get("request_id", "")
        uses_llm = getattr(deps.intake, "uses_llm", False)
        if uses_llm:
            counts = await deps.usage.counts(thread_id, request_id)
            if llm_calls_left(counts, deps.settings) <= 0:
                return {
                    "outcome": Outcome(node="intake", code=OutcomeCode.BUDGET, detail="hết lượt LLM trong lượt này")
                }
        previous: IntakeResult | None = state.get("intake")
        last_response = state.get("response")
        messages = state.get("messages") or []
        try:
            raw = await deps.intake.understand(
                IntakeInput(
                    messages=messages,
                    session=state.get("session"),
                    previous=previous,
                    plan_outline=plan_outline(state),
                    decision=state.get("user_decision"),
                    pending_questions=last_response.questions if last_response else [],
                    last_suggestions=last_response.suggestions if last_response else [],
                    supported_domains=deps.agents.names(),
                )
            )
            result = IntakeResult.model_validate(raw.model_dump() if isinstance(raw, IntakeResult) else raw)
        except Exception as exc:
            logger.exception("intake failed")
            return {
                "outcome": Outcome(node="intake", code=OutcomeCode.ERROR, detail="không hiểu được yêu cầu"),
                "errors": [error_record("intake", f"intake error: {type(exc).__name__}", now)],
            }
        if uses_llm:
            tokens_in, tokens_out = getattr(deps.intake, "last_usage", (0, 0))
            await deps.usage.record_llm(
                thread_id, request_id, "intake", deps.settings.llm_models["light"], tokens_in, tokens_out
            )

        decision = state.get("user_decision")
        plan = state.get("plan")
        if decision is not None and decision.kind == "REJECT" and result.kind != RequestKind.CHANGE and plan:
            results = state.get("task_results") or {}
            targets = decision.target_task_ids or [
                t.id for t in plan.tasks if (r := results.get(t.id)) is not None and r.quotes
            ]
            result = result.model_copy(update={"kind": RequestKind.CHANGE, "target_task_ids": targets})
        elif (
            decision is not None
            and decision.kind == "CHANGE"
            and decision.target_task_ids
            and not result.target_task_ids
        ):
            result = result.model_copy(update={"target_task_ids": decision.target_task_ids})

        # Dữ kiện: evidence phải là lời người dùng; không nhận dữ liệu cá nhân; gộp qua các lượt.
        user_texts = [str(m.content) for m in messages if isinstance(m, HumanMessage)]
        suggestion_keys = [s.key for s in last_response.suggestions] if last_response else []
        previous_facts = dict(previous.user_confirmed_facts) if previous else {}
        # Ý muốn đặt đã được thực hiện thì không mang sang lượt sau (tránh đặt lại ngoài ý muốn).
        for receipt in active_commits(state.get("committed")).values():
            key = commit_fact_key(receipt.kind)
            fact = previous_facts.get(key)
            if fact is not None and receipt.created_at >= fact.stated_at:
                previous_facts.pop(key)
        grounded = ground_facts(result.user_confirmed_facts, previous_facts, result.kind, user_texts, suggestion_keys)
        errors = [
            error_record("intake", f"bỏ dữ kiện không có căn cứ hoặc là dữ liệu cá nhân: {name}", now)
            for name in grounded.dropped
        ]
        if previous is not None:
            for key in previous.prefilled:
                fact = grounded.facts.get(key)
                if fact is not None and fact.value != previous.prefilled[key].value:
                    logger.info("prefill_corrected field=%s thread_id=%s request_id=%s", key, thread_id, request_id)
        commit_requested = [k for k in CommitActionKind if commit_fact_key(k) in grounded.facts]
        values = dict(result.constraints.values)
        if previous is not None and result.kind != RequestKind.NEW_GOAL:
            # Gộp dần qua các lượt: ràng buộc đã nói ở lượt trước vẫn giữ, giá trị mới thắng.
            carried = {k: v for k, v in previous.constraints.values.items() if k not in previous.prefilled}
            values = {**carried, **values}
        result = result.model_copy(
            update={
                "constraints": result.constraints.model_copy(update={"values": values}),
                "user_confirmed_facts": grounded.facts,
                "commit_requested": commit_requested,
                "conflicts": list(dict.fromkeys([*result.conflicts, *grounded.conflicts])),
                "declined_suggestions": [k for k in result.declined_suggestions if k in suggestion_keys],
            }
        )
        result = resolve_missing(
            result,
            session=state.get("session"),
            plan=plan if result.kind != RequestKind.NEW_GOAL else None,
            cost_tiers=deps.agents.cost_tiers(),
            prefill_ttl=deps.settings.prefill_ttl,
            now=now,
        )
        update: dict = {"intake": result, "declined_suggestions": result.declined_suggestions}
        if errors:
            update["errors"] = errors
        if result.kind == RequestKind.UNSUPPORTED:
            update["outcome"] = Outcome(node="intake", code=OutcomeCode.UNSUPPORTED)
        elif result.needs_clarification:
            update["outcome"] = Outcome(node="intake", code=OutcomeCode.CLARIFY)
        return update

    return intake
