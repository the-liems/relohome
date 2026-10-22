"""`DomainAgent` và wrapper `run_with_policy` (agent-graph.md §6.3.3, §6.3.6).

Mặc định lỗi của subagent là dữ liệu cho validator (D6). Typed form bật
raise_unexpected để lỗi lập trình đi tới graph/HTTP instrumentation.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Protocol

from pydantic import ValidationError
from relohome_agent.agents.contracts import (
    CONTRACT_VERSION,
    AgentCapability,
    AgentTaskRequest,
    AgentTaskResult,
    UpstreamResult,
    contract_major,
    failed_result,
)
from relohome_agent.agents.llm_runtime import capture_invocation_usage, public_data
from relohome_agent.agents.models import AgentBudget, TaskResult, TaskStatus
from relohome_agent.agents.state import AgentInput

logger = logging.getLogger(__name__)


class DomainAgent(Protocol):
    capability: AgentCapability

    async def run(self, req: AgentTaskRequest) -> AgentTaskResult: ...


class AgentTransportError(Exception):
    """Không gửi được task tới subagent (không kết nối được, 502/503 trước khi nhận task).

    Chỉ lỗi loại này được `run_with_policy` thử lại (một lần).
    """


@dataclass(frozen=True)
class AgentPolicy:
    timeout_s: float = 20.0
    transport_retries: int = 1
    grace_s: float = 2.0
    max_subagent_llm_calls_left: int | None = None
    raise_unexpected: bool = False


STATUS_MAP = {"done": TaskStatus.DONE, "failed": TaskStatus.FAILED, "needs_input": TaskStatus.NEEDS_INPUT}


def build_request(capability: AgentCapability, inp: AgentInput, policy: AgentPolicy, now: datetime) -> AgentTaskRequest:
    task = inp["task"]
    llm_left = capability.default_budget.max_llm_calls
    if policy.max_subagent_llm_calls_left is not None:
        llm_left = min(llm_left, max(0, policy.max_subagent_llm_calls_left))
    constraints = {k: v for k, v in inp["constraints"].values.items() if k in capability.constraint_keys}
    hints = {k: v for k, v in inp["hints"].items() if k in capability.hint_keys}
    return AgentTaskRequest(
        contract_version=CONTRACT_VERSION,
        request_id=inp["request_id"],
        thread_id=inp["thread_id"],
        task_id=task.id,
        plan_version=inp["plan_version"],
        attempt=inp["attempt"],
        agent=task.agent,
        inputs=dict(task.inputs),
        goal=public_data(inp.get("goal", ""))[:1500],
        user_request=public_data(inp.get("user_request", ""))[:2000],
        constraints=constraints,
        retrieval_only=bool(inp.get("retrieval_only", False)),
        hints=hints,
        upstream={
            tid: UpstreamResult(task_id=tid, agent=r.agent, data=r.data, source_refs=r.source_refs)
            for tid, r in inp["upstream"].items()
        },
        budget=AgentBudget(
            max_llm_calls=llm_left,
            max_provider_calls=capability.default_budget.max_provider_calls,
            deadline_at=now + timedelta(seconds=policy.timeout_s),
        ),
    )


def check_result(raw: Any, req: AgentTaskRequest) -> AgentTaskResult:
    """Parse và đối chiếu result với request; sai contract thì thành `failed` / `internal`."""
    try:
        result = raw if isinstance(raw, AgentTaskResult) else AgentTaskResult.model_validate(raw)
    except ValidationError:
        return failed_result(req, "internal", "subagent result does not match the contract", retryable=False)
    if result.task_id != req.task_id or result.plan_version != req.plan_version:
        return failed_result(req, "internal", "subagent result is for another task or plan version", retryable=False)
    if contract_major(result.contract_version) != contract_major(req.contract_version):
        return failed_result(req, "unsupported_contract", "contract major version mismatch", retryable=False)
    return result


def to_task_result(result: AgentTaskResult, req: AgentTaskRequest) -> TaskResult:
    return TaskResult(
        task_id=result.task_id,
        agent=req.agent,
        plan_version=result.plan_version,
        status=result.status,
        data=result.data,
        quotes=result.quotes,
        missing_fields=result.missing_fields,
        questions=result.questions,
        source=result.source,
        source_kind=result.source_kind,
        source_refs=result.source_refs,
        fetched_at=result.fetched_at,
        summary=result.summary,
        usage=result.usage,
        error=f"{result.error.code}: {result.error.message}" if result.error else None,
        error_code=result.error.code if result.error else None,
        retryable=bool(result.error and result.error.retryable),
    )


async def run_with_policy(
    agent: DomainAgent,
    inp: AgentInput,
    *,
    policy: AgentPolicy,
    clock: Callable[[], datetime],
    record: Callable[[AgentTaskRequest, AgentTaskResult, int], Any] | None = None,
) -> dict:
    """Dựng AgentTaskRequest, gọi subagent, kiểm result, trả update cho state."""
    req = build_request(agent.capability, inp, policy, clock())
    started = time.monotonic()
    raw: Any = None
    for attempt in range(policy.transport_retries + 1):
        try:
            with capture_invocation_usage() as consumed:
                raw = await asyncio.wait_for(agent.run(req), timeout=policy.timeout_s + policy.grace_s)
            break
        except AgentTransportError as exc:
            if attempt < policy.transport_retries:
                continue
            raw = failed_result(req, "provider_unavailable", f"subagent unreachable: {exc}", retryable=True)
        except TimeoutError:
            raw = failed_result(req, "timeout", "subagent exceeded its deadline", retryable=True)
            break
        except Exception as exc:
            if policy.raise_unexpected:
                # This path never reaches the normal record below. Keep real
                # counters (including work before a malformed provider response)
                # without converting or wrapping the original exception.
                if record is not None:
                    failure = failed_result(
                        req,
                        "internal",
                        f"subagent error: {type(exc).__name__}",
                        retryable=False,
                        usage=consumed.snapshot(),
                    )
                    try:
                        await record(req, failure, int((time.monotonic() - started) * 1000))
                    except Exception as recording_error:
                        # A ledger outage must not mask the actual agent cause.
                        logger.error(
                            "crashed subagent usage recording failed (%s)",
                            type(recording_error).__name__,
                            exc_info=True,
                        )
                raise
            logger.warning(
                "subagent %s failed (%s) task_id=%s", req.agent, type(exc).__name__, req.task_id, exc_info=True
            )
            raw = failed_result(req, "internal", f"subagent error: {type(exc).__name__}", retryable=False)
            break
    result = check_result(raw, req)
    elapsed_ms = int((time.monotonic() - started) * 1000)
    if record is not None:
        await record(req, result, elapsed_ms)
    task_result = to_task_result(result, req)
    return {
        "task_results": {req.task_id: task_result},
        "task_status": {req.task_id: STATUS_MAP[result.status]},
    }
