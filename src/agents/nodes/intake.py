"""Node `intake` (agent-graph.md §6.1): vỏ quanh `deps.intake`, kiểm kết quả bằng code.

Node không chọn agent/tool, không tạo DAG, không tạo approval.
"""

from __future__ import annotations

import logging

from langchain_core.messages import HumanMessage

from src.agents.cost import call_graph_component, llm_calls_left
from src.agents.deps import GraphDeps
from src.agents.intake import (
    LOCATION_KEYS,
    IntakeInput,
    abbreviation_questions,
    commit_fact_key,
    ground_facts,
    redact_pii,
    resolve_missing,
)
from src.agents.models import (
    AgentName,
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
        # Tin nhắn gửi cho Intake (LLM) đã che dữ liệu cá nhân; state giữ nguyên để hiển thị lịch sử.
        messages = [
            HumanMessage(redact_pii(str(m.content))) if isinstance(m, HumanMessage) else m
            for m in (state.get("messages") or [])
        ]
        try:
            raw = await call_graph_component(
                deps.intake,
                "understand",
                IntakeInput(
                    messages=messages,
                    session=state.get("session"),
                    previous=previous,
                    plan_outline=plan_outline(state),
                    decision=state.get("user_decision"),
                    pending_questions=last_response.questions if last_response else [],
                    last_suggestions=last_response.suggestions if last_response else [],
                    supported_domains=deps.agents.names(),
                ),
                deps,
                state,
                "intake",
            )
            result = IntakeResult.model_validate(raw.model_dump() if isinstance(raw, IntakeResult) else raw)
        except Exception as exc:
            logger.warning("intake failed: %s", type(exc).__name__)
            return {
                "outcome": Outcome(node="intake", code=OutcomeCode.ERROR, detail="không hiểu được yêu cầu"),
                "errors": [error_record("intake", f"intake error: {type(exc).__name__}", now)],
            }

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
        supported_actions = {kind for name in deps.agents.names() for kind in deps.agents.commit_kinds(name)}
        unsupported = [kind for kind in commit_requested if kind not in supported_actions]
        if unsupported:
            result.conflicts.append(
                "Hiện chưa kết nối giao dịch thật cho yêu cầu này. Bạn muốn chỉ tìm thông tin/báo giá không?"
            )
        # Tên viết tắt ("Q10", "BV", "HCM"): không dùng, hỏi lại tên đầy đủ. Bỏ giá trị viết tắt khỏi dữ kiện
        # để câu trả lời lượt sau không bị coi là mâu thuẫn với nó.
        stated_now = {
            **{k: f.value for k, f in result.user_confirmed_facts.items() if k in grounded.facts},
            **result.constraints.values,
        }
        abbreviated = {k for k in LOCATION_KEYS if abbreviation_questions({k: stated_now.get(k)})}
        abbreviation_asks = abbreviation_questions(stated_now)
        facts = {k: f for k, f in grounded.facts.items() if k not in abbreviated}
        values = {k: v for k, v in result.constraints.values.items() if k not in abbreviated}
        if previous is not None and result.kind != RequestKind.NEW_GOAL:
            # Gộp dần qua các lượt: ràng buộc đã nói ở lượt trước vẫn giữ, giá trị mới thắng.
            carried = {k: v for k, v in previous.constraints.values.items() if k not in previous.prefilled}
            values = {**carried, **values}
        # A point confirmed for an old address cannot silently survive an address edit.
        for key, address_key in (("pickup_coordinate", "from_address"), ("destination_coordinate", "to_address")):
            if previous and previous.constraints.values.get(address_key) != values.get(address_key):
                values.pop(key, None)
        if AgentName.RELOCATION in result.domains:
            for endpoint, address_key, coord_key in (
                ("pickup", "from_address", "pickup_coordinate"),
                ("destination", "to_address", "destination_coordinate"),
            ):
                pin = (state.get("moving_locations") or {}).get(endpoint)
                if pin and pin.get("confirmed") is True:
                    # Only the validated API input can supply this point, never a model draft.
                    values[address_key] = pin["address"]
                    values[coord_key] = {"lat": pin["lat"], "lng": pin["lng"]}
        result = result.model_copy(
            update={
                "constraints": result.constraints.model_copy(update={"values": values}),
                "user_confirmed_facts": facts,
                "commit_requested": commit_requested,
                "conflicts": list(dict.fromkeys([*result.conflicts, *grounded.conflicts, *abbreviation_asks])),
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
