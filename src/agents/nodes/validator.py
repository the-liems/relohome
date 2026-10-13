"""Node `validator` — Result Validator (agent-graph.md §6.5). Code thuần, không LLM.

Validator quyết định **có** replan hay không; Planner quyết định replan **thế nào**.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from jsonschema import Draft202012Validator
from relohome_agent.agents.contracts import AgentCapability
from relohome_agent.agents.deps import GraphDeps
from relohome_agent.agents.models import (
    IntakeResult,
    Outcome,
    OutcomeCode,
    Plan,
    Question,
    TaskResult,
    TaskStatus,
    ValidationIssue,
    ValidationReport,
)
from relohome_agent.agents.state import WorkflowState

S = TaskStatus


@dataclass
class Finding:
    issue: ValidationIssue
    retry: bool = False  # chạy lại task có thể sửa được (lỗi tạm thời, kết quả cũ)
    ask_user: bool = False  # chỉ người dùng mới giải quyết được


def _is_empty(value: Any) -> bool:
    return value in (None, "", [], {})


def required_field_problems(data: dict[str, Any], missing_fields: list[str], required: list[str]) -> list[str]:
    """V2: `a|b` = có ít nhất một; `list[].field` = mọi phần tử của list (nếu có) phải có field."""
    problems = []
    for spec in required:
        if "[]." in spec:
            list_key, field = spec.split("[].", 1)
            items = data.get(list_key)
            if isinstance(items, list):
                for i, item in enumerate(items):
                    if not isinstance(item, dict) or item.get(field) is None:
                        problems.append(f"{list_key}[{i}].{field}")
            continue
        options = spec.split("|")
        if all(_is_empty(data.get(o)) for o in options):
            problems.append(spec)
    pattern = re.compile(r"\[\d+\]")
    required_plain = {pattern.sub("[]", r) for r in required}
    for field in missing_fields:
        if pattern.sub("[]", field) in required_plain or field in required_plain:
            problems.append(field)
    return list(dict.fromkeys(problems))


def unreferenced_items(data: dict[str, Any], source_refs: list[str]) -> list[str]:
    """R2: mỗi item có `id` trong `data` phải có id nguồn nằm trong `source_refs`."""
    refs = set(source_refs)
    out = []
    for key, value in data.items():
        if isinstance(value, list):
            for item in value:
                if isinstance(item, dict) and "id" in item and str(item["id"]) not in refs:
                    out.append(f"{key}:{item['id']}")
    return out


# --- V5: luật xung đột giữa các kết quả (pluggable, Q9) ---

ConflictRule = Callable[[Plan, dict[str, TaskResult], IntakeResult], list[str]]


def rule_total_budget(plan: Plan, results: dict[str, TaskResult], intake: IntakeResult) -> list[str]:
    """Tổng chi phí một lần của phương án đầu tiên vượt `budget_vnd` người dùng nói."""
    budget = intake.constraints.values.get("budget_vnd")
    if not isinstance(budget, int) or "budget_vnd" in intake.prefilled:
        return []
    total = sum(
        next((q.amount_vnd for q in r.quotes if q.recurrence == "one_time"), 0)
        for t in plan.tasks
        if (r := results.get(t.id)) is not None
    )
    return [f"tổng chi phí {total:,}đ vượt ngân sách {budget:,}đ"] if total > budget else []


DEFAULT_RULES: tuple[ConflictRule, ...] = (rule_total_budget,)


def check_task(
    task_id: str,
    result: TaskResult | None,
    capability: AgentCapability | None,
    ttl_s: float,
    upstream: list[TaskResult],
    now: datetime,
) -> list[Finding]:
    findings: list[Finding] = []
    if result is None or capability is None:
        return [Finding(ValidationIssue(code="V1", task_id=task_id, message="không có kết quả"))]
    errors = list(Draft202012Validator(capability.output_schema).iter_errors(result.data))
    if errors:
        findings.append(
            Finding(ValidationIssue(code="V4", task_id=task_id, message=f"sai output_schema: {errors[0].message}"))
        )
    problems = required_field_problems(result.data, result.missing_fields, capability.required_fields)
    if problems:
        empty = all("[" not in p for p in problems)
        findings.append(
            Finding(
                ValidationIssue(
                    code="V2",
                    task_id=task_id,
                    message=(
                        "không có kết quả phù hợp" if empty else "thiếu field bắt buộc: " + ", ".join(problems[:5])
                    ),
                )
            )
        )
    orphans = unreferenced_items(result.data, result.source_refs)
    if orphans:
        findings.append(
            Finding(
                ValidationIssue(code="V2", task_id=task_id, message="item không có nguồn: " + ", ".join(orphans[:5]))
            )
        )
    age = (now - result.fetched_at).total_seconds()
    if age > ttl_s or any(u.fetched_at > result.fetched_at for u in upstream):
        findings.append(Finding(ValidationIssue(code="V3", task_id=task_id, message="kết quả đã cũ"), retry=True))
    return findings


def decide(
    plan: Plan,
    statuses: dict[str, TaskStatus],
    results: dict[str, TaskResult],
    attempts: dict[str, int],
    intake: IntakeResult,
    capabilities: dict[str, AgentCapability | None],
    ttl_s: dict[str, float],
    now: datetime,
    *,
    max_attempts: int,
    replans_left: bool,
    rules: tuple[ConflictRule, ...] = DEFAULT_RULES,
) -> ValidationReport:
    """Kiểm V1–V5 rồi áp bảng quyết định (dừng ở dòng đầu tiên khớp)."""
    findings: list[Finding] = []
    questions: list[Question] = []
    budget_exceeded = False
    for task in plan.tasks:
        status = statuses.get(task.id, S.PENDING)
        result = results.get(task.id)
        if status == S.NEEDS_INPUT:
            questions.extend(result.questions if result else [])
            continue
        if status != S.DONE:
            if result is not None and result.error_code == "budget_exceeded":
                budget_exceeded = True
            if task.required and status != S.PENDING:
                retry = bool(result and result.retryable and status == S.FAILED)
                findings.append(
                    Finding(ValidationIssue(code="V1", task_id=task.id, message=f"task {status.value}"), retry=retry)
                )
            continue
        if not task.required:
            continue
        upstream = [results[d] for d in task.depends_on if d in results]
        findings.extend(check_task(task.id, result, capabilities.get(task.id), ttl_s.get(task.id, 0), upstream, now))
        # Domain semantic feedback is a request, not authority to alter the plan.
        # A retained result from an older plan must not trigger the same replan
        # repeatedly. Planner still validates every domain, hard input and edge.
        if result and result.plan_version == plan.version and result.data.get("agent_replan"):
            findings.append(
                Finding(
                    ValidationIssue(
                        code="V5",
                        task_id=task.id,
                        message="Subagent yêu cầu xem lại kế hoạch: "
                        + str(result.data["agent_replan"].get("reason", ""))[:400],
                    )
                )
            )
    for message in (m for rule in rules for m in rule(plan, results, intake)):
        findings.append(Finding(ValidationIssue(code="V5", task_id=None, message=message), ask_user=True))

    issues = [f.issue for f in findings]
    missing = list(intake.constraints.missing)
    ask_fields = list(dict.fromkeys([*missing, *(q.field for q in questions)]))
    if not issues and not ask_fields:
        return ValidationReport(verdict="PASS", action="NONE")
    if budget_exceeded:
        return ValidationReport(verdict="NEED_MORE", action="GIVE_UP", issues=issues)
    if ask_fields or any(f.ask_user for f in findings):
        return ValidationReport(
            verdict="NEED_MORE", action="ASK_USER", issues=issues, ask_user_fields=ask_fields, questions=questions
        )
    retry_ids = [
        f.issue.task_id
        for f in findings
        if f.retry and f.issue.task_id and attempts.get(f.issue.task_id, 0) < max_attempts
    ]
    if retry_ids:
        return ValidationReport(
            verdict="NEED_MORE", action="RETRY_TASKS", issues=issues, retry_task_ids=list(dict.fromkeys(retry_ids))
        )
    if replans_left:
        return ValidationReport(verdict="NEED_MORE", action="REPLAN", issues=issues)
    return ValidationReport(verdict="NEED_MORE", action="GIVE_UP", issues=issues)


def make_validator(deps: GraphDeps):
    async def validator(state: WorkflowState) -> dict:
        """Chọn PASS / RETRY_TASKS / REPLAN / ASK_USER / GIVE_UP."""
        plan = state["plan"]
        capabilities = {t.id: deps.agents.capability(t.agent) for t in plan.tasks}
        ttl = {tid: deps.settings.stale_ttl(c).total_seconds() for tid, c in capabilities.items() if c is not None}
        report = decide(
            plan,
            state.get("task_status") or {},
            state.get("task_results") or {},
            state.get("task_attempts") or {},
            state["intake"],
            capabilities,
            ttl,
            deps.clock(),
            max_attempts=deps.settings.max_task_attempts,
            replans_left=(state.get("replan_count") or 0) < deps.settings.max_replans,
        )
        update: dict = {"validation": report}
        if report.action == "RETRY_TASKS":
            update["task_status"] = {tid: S.PENDING for tid in report.retry_task_ids}
        elif report.action == "ASK_USER":
            update["outcome"] = Outcome(node="validator", code=OutcomeCode.ASK_USER)
        elif report.action == "GIVE_UP":
            update["outcome"] = Outcome(node="validator", code=OutcomeCode.GIVE_UP)
        return update

    return validator
