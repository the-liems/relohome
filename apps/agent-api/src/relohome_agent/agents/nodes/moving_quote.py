"""Graph branch for a prevalidated quote form; never plans chat or executes bookings."""

from datetime import datetime

from langgraph.runtime import Runtime
from relohome_agent.agents.context import GraphContext
from relohome_agent.agents.cost import subagent_llm_calls_left
from relohome_agent.agents.execution import execute_agent
from relohome_agent.agents.models import AgentName, Outcome, OutcomeCode, TaskStatus, ValidationIssue, ValidationReport
from relohome_agent.agents.nodes.cost_summary import make_cost_summary
from relohome_agent.agents.nodes.respond import make_respond
from relohome_agent.agents.nodes.validator import DEFAULT_RULES, check_task
from relohome_agent.agents.state import AgentInput, WorkflowState
from relohome_agent.agents.telemetry import record_node_failure


async def moving_quote_agent(state: WorkflowState, runtime: Runtime[GraphContext]) -> dict:
    deps = runtime.context.deps
    task = state["plan"].task(state["moving_quote_context"]["task_id"])
    counts = await deps.usage.counts(state["thread_id"], state["request_id"])
    agent = deps.moving_quote_agent
    if agent is None:
        raise ValueError("Moving quote agent is not configured")
    update = await execute_agent(
        deps,
        AgentName.RELOCATION,
        agent,
        AgentInput(
            task=task,
            allocated_llm_calls=subagent_llm_calls_left(counts, deps.settings),
            user_id=state["user_id"],
            plan_version=state["plan"].version,
            attempt=1,
            request_id=state["request_id"],
            thread_id=state["thread_id"],
            constraints=state["intake"].constraints,
            goal="Báo giá Moving từ form đã xác nhận",
            user_request=state["intake"].normalized_goal,
            hints={},
            upstream={},
        ),
        raise_unexpected=True,
    )

    result = update["task_results"][task.id]
    if result.status == "failed":
        record_node_failure("moving_quote_agent", result.error_code or "internal", result.error or "Quote failed")
    return update


async def moving_quote_validate(state: WorkflowState, runtime: Runtime[GraphContext]) -> dict:
    deps = runtime.context.deps
    task_id = state["moving_quote_context"]["task_id"]
    # Preserve the agent-node checkpoint when validation changes a result.
    result = state["task_results"][task_id].model_copy(deep=True)
    capability = deps.moving_quote_agent.capability
    validation = None
    if result.status == "done":
        findings = check_task(task_id, result, capability, capability.stale_ttl_s, [], deps.clock())
        try:
            expiry = datetime.fromisoformat(result.data.get("expires_at", ""))
            fresh = expiry.tzinfo is not None and expiry > deps.clock()
        except (ValueError, TypeError):
            fresh = False
        if findings or not fresh:
            result.status, result.error_code = "failed", "internal"
            result.error = "Báo giá thiếu dữ kiện hợp lệ hoặc đã hết hạn; chưa đặt đơn."
            issues = [finding.issue for finding in findings]
            if not fresh:
                issues.append(
                    ValidationIssue(code="V3", task_id=task_id, message="Quote expires_at is invalid or expired")
                )
            validation = ValidationReport(verdict="NEED_MORE", action="GIVE_UP", issues=issues)
            record_node_failure("moving_quote_validate", "invalid_quote", result.error)
    code = {"done": OutcomeCode.ANSWER, "needs_input": OutcomeCode.ASK_USER, "failed": OutcomeCode.ERROR}[result.status]
    update = {
        "task_results": {task_id: result},
        "task_status": {task_id: TaskStatus(result.status)},
        "validation": (
            ValidationReport(verdict="NEED_MORE", action="ASK_USER", questions=result.questions)
            if result.status == "needs_input"
            else validation
        ),
        "outcome": Outcome(
            node="moving_quote_validate",
            code=code,
            detail=(result.error or "") if result.status == "failed" else "",
        ),
    }
    if result.status == "done":
        current_results = {
            tid: item for tid, item in state["task_results"].items() if state["task_status"].get(tid) == TaskStatus.DONE
        }
        current_results[task_id] = result
        conflicts = [
            ValidationIssue(code="V5", message=message)
            for rule in DEFAULT_RULES
            for message in rule(state["plan"], current_results, state["intake"])
        ]
        if conflicts:
            update["validation"] = ValidationReport(verdict="NEED_MORE", action="ASK_USER", issues=conflicts)
            update["outcome"] = Outcome(node="moving_quote_validate", code=OutcomeCode.ASK_USER)
    return update


async def moving_quote_summary(state: WorkflowState, runtime: Runtime[GraphContext]) -> dict:
    deps = runtime.context.deps
    update = await make_cost_summary(deps)(state)
    # A quote plan has no commit actions. The normal summary's ANSWER would
    # hide a failed/needs-input/conflicting quote and its diagnostic detail.
    update.pop("outcome", None)
    return update


async def moving_quote_respond(state: WorkflowState, runtime: Runtime[GraphContext]) -> dict:
    deps = runtime.context.deps
    update = await make_respond(deps)(state)
    update["moving_quote_context"] = None
    return update
