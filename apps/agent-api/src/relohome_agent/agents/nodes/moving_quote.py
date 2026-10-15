"""Graph branch for a prevalidated quote form; never plans chat or executes bookings."""

from collections.abc import Awaitable, Callable
from datetime import datetime
from time import time

from relohome_agent.agents.cost import subagent_llm_calls_left
from relohome_agent.agents.deps import GraphDeps
from relohome_agent.agents.models import AgentName, Outcome, OutcomeCode, TaskStatus, ValidationIssue, ValidationReport
from relohome_agent.agents.nodes.cost_summary import make_cost_summary
from relohome_agent.agents.nodes.respond import make_respond
from relohome_agent.agents.nodes.validator import DEFAULT_RULES, check_task
from relohome_agent.agents.state import AgentInput, WorkflowState


class FormQuoteAgent:
    """Use the existing form mode without mutating the shared domain agent."""

    def __init__(self, agent):
        self.agent, self.capability = agent, agent.capability

    async def run(self, request):
        return await self.agent.run_form_quote(request)


def make_moving_quote_agent(deps: GraphDeps, invoke: Callable[[AgentInput], Awaitable[dict]]):
    async def moving_quote_agent(state: WorkflowState) -> dict:
        task = state["plan"].task(state["moving_quote_context"]["task_id"])
        counts = await deps.usage.counts(state["thread_id"], state["request_id"])
        return await invoke(
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
            )
        )

    return moving_quote_agent


def make_moving_quote_validate(deps: GraphDeps):
    async def moving_quote_validate(state: WorkflowState) -> dict:
        task_id = state["moving_quote_context"]["task_id"]
        # Preserve the agent-node checkpoint when validation changes a result.
        result = state["task_results"][task_id].model_copy(deep=True)
        capability = deps.agents.capability(AgentName.RELOCATION)
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
        code = {"done": OutcomeCode.ANSWER, "needs_input": OutcomeCode.ASK_USER, "failed": OutcomeCode.ERROR}[
            result.status
        ]
        update = {
            "task_results": {task_id: result},
            "task_status": {task_id: TaskStatus(result.status)},
            "validation": (
                ValidationReport(verdict="NEED_MORE", action="ASK_USER", questions=result.questions)
                if result.status == "needs_input"
                else None
            ),
            "outcome": Outcome(
                node="moving_quote_validate",
                code=code,
                detail=(result.error or "") if result.status == "failed" else "",
            ),
        }
        if result.status == "done":
            current_results = {
                tid: item
                for tid, item in state["task_results"].items()
                if state["task_status"].get(tid) == TaskStatus.DONE
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

    return moving_quote_validate


def make_moving_quote_summary(deps: GraphDeps):
    summarize = make_cost_summary(deps)

    async def moving_quote_summary(state: WorkflowState) -> dict:
        update = await summarize(state)
        # A quote plan has no commit actions. The normal summary's ANSWER would
        # hide a failed/needs-input/conflicting quote and its diagnostic detail.
        update.pop("outcome", None)
        return update

    return moving_quote_summary


def make_moving_quote_respond(deps: GraphDeps):
    respond = make_respond(deps)

    async def moving_quote_respond(state: WorkflowState) -> dict:
        update = await respond(state)
        context = state["moving_quote_context"]
        result = state["task_results"][context["task_id"]].model_copy(deep=True)
        # Wall time survives checkpoint recovery across processes; monotonic
        # timestamps cannot be persisted and compared after a restart.
        result.data["form_elapsed_ms"] = max(0, round((time() - context["started_at"]) * 1000))
        update["task_results"] = {context["task_id"]: result}
        update["moving_quote_context"] = None
        return update

    return moving_quote_respond
