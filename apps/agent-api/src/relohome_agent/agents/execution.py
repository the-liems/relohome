"""Shared application policy for graph nodes executing an explicitly supplied agent."""

import time

from relohome_agent.agents.cost import subagent_llm_calls_left
from relohome_agent.agents.deps import GraphDeps
from relohome_agent.agents.models import AgentName
from relohome_agent.agents.state import AgentInput
from relohome_agent.agents.subagents.base import AgentPolicy, DomainAgent, run_with_policy
from relohome_agent.agents.subagents.services.payment import ACTOR_ID
from relohome_agent.guest_access import READ_AGENTS, is_guest


async def execute_agent(
    deps: GraphDeps, name: AgentName, agent: DomainAgent, inp: AgentInput, *, raise_unexpected: bool = False
) -> dict:
    capability = agent.capability
    # Use the domain selected by trusted graph wiring, including before any
    # provider-specific capability access in the guest authorization branch.
    if is_guest(inp.get("user_id")) and name.value not in READ_AGENTS:
        from relohome_agent.agents.models import TaskResult

        task = inp["task"]
        return {
            "task_results": {
                task.id: TaskResult(
                    task_id=task.id,
                    agent=name,
                    plan_version=inp["plan_version"],
                    status="failed",
                    fetched_at=deps.clock(),
                    source="authorization",
                    error_code="unsupported_contract",
                    error="Đăng nhập để sử dụng dịch vụ này.",
                    data={"authentication_required": True, "service": name.value},
                )
            }
        }
    thread_id, request_id = inp["thread_id"], inp["request_id"]
    counts = await deps.usage.counts(thread_id, request_id)
    policy = AgentPolicy(
        timeout_s=deps.settings.timeout_for(name),
        transport_retries=deps.settings.agent_transport_retries,
        raise_unexpected=raise_unexpected,
        max_subagent_llm_calls_left=min(
            inp.get("allocated_llm_calls", capability.default_budget.max_llm_calls),
            subagent_llm_calls_left(counts, deps.settings),
        ),
    )

    async def record(req, result, elapsed_ms: int) -> None:
        await deps.usage.record_subagent(thread_id, request_id, name, capability.cost_tier, result.usage, elapsed_ms)

    actor = ACTOR_ID.set(inp.get("user_id"))
    started_at, started = deps.clock(), time.monotonic()
    try:
        update = await run_with_policy(agent, inp, policy=policy, clock=deps.clock, record=record)
        for result in update.get("task_results", {}).values():
            if deps.guardrail and capability.uses_llm:
                deps.guardrail.observe_assessment(inp, result)
            result.data["execution"] = {
                "request_id": request_id,
                "started_at": started_at.isoformat(),
                "finished_at": deps.clock().isoformat(),
                "elapsed_ms": round((time.monotonic() - started) * 1000),
                "allocated_llm_calls": policy.max_subagent_llm_calls_left,
                "depends_on": list(inp["task"].depends_on),
            }
        return update
    finally:
        ACTOR_ID.reset(actor)
