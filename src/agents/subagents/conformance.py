"""Bộ kiểm tuân thủ contract subagent (agent-graph.md §6.3.4, quy tắc R1–R12).

Chủ service chạy với subagent của mình trước khi đăng ký vào registry, ví dụ:

    problems = await check_conformance(my_agent, [sample_request(AgentName.FLIGHT, {...})])
    assert problems == []

Chỉ kiểm được phần quan sát từ bên ngoài (R1, R2, R4, R6, R10, R11, R12). R3 (chỉ đọc), R5, R8, R9 cần
review code và credential chỉ-đọc.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from jsonschema import Draft202012Validator
from relohome_agent.agents.common import utcnow
from relohome_agent.agents.contracts import AgentTaskRequest, AgentTaskResult
from relohome_agent.agents.models import AgentBudget, AgentName
from relohome_agent.agents.subagents.base import DomainAgent


def sample_request(agent: AgentName, inputs: dict[str, Any], upstream: dict | None = None, **kw) -> AgentTaskRequest:
    return AgentTaskRequest(
        request_id="conformance",
        thread_id="conformance",
        task_id="t1",
        plan_version=1,
        attempt=1,
        agent=agent,
        inputs=inputs,
        upstream=upstream or {},
        budget=AgentBudget(max_llm_calls=2, max_provider_calls=10, deadline_at=utcnow() + timedelta(seconds=30)),
        **kw,
    )


def _result_problems(agent: DomainAgent, req: AgentTaskRequest, result: AgentTaskResult) -> list[str]:
    cap = agent.capability
    out = []
    if result.task_id != req.task_id or result.plan_version != req.plan_version:
        out.append("R1: task_id / plan_version không khớp request")
    if not result.source:
        out.append("R2: thiếu source")
    if result.status == "done":
        errors = list(Draft202012Validator(cap.output_schema).iter_errors(result.data))
        if errors:
            out.append(f"R1: data sai output_schema: {errors[0].message}")
        refs = set(result.source_refs)
        for key, value in result.data.items():
            if isinstance(value, list):
                for item in value:
                    if isinstance(item, dict) and "id" in item and str(item["id"]) not in refs:
                        out.append(f"R2: {key}:{item['id']} không có trong source_refs")
    if result.status == "needs_input" and not result.questions:
        out.append("R4: needs_input phải có questions")
    if result.usage.provider_calls > req.budget.max_provider_calls:
        out.append("R6: vượt max_provider_calls")
    if result.usage.llm_calls > req.budget.max_llm_calls:
        out.append("R6: vượt max_llm_calls")
    return out


async def check_conformance(agent: DomainAgent, requests: list[AgentTaskRequest]) -> list[str]:
    problems: list[str] = []
    for req in requests:
        if req.agent != agent.capability.agent:
            problems.append(f"request cho {req.agent} nhưng subagent phục vụ {agent.capability.agent}")
            continue
        first = await agent.run(req)
        problems += _result_problems(agent, req, first)
        again = await agent.run(req)  # R10: gọi lại cùng request không gây side-effect, kết quả tương đương
        if again.status != first.status:
            problems.append("R10: gọi lại cùng request cho trạng thái khác")
        unsupported = await agent.run(req.model_copy(update={"contract_version": "99.0"}))
        if unsupported.status != "failed" or not unsupported.error or unsupported.error.code != "unsupported_contract":
            problems.append("R12: không từ chối contract khác major")
    return problems
