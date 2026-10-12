"""Tiến trình kế hoạch cho UI: các mục tiêu người dùng đã nêu, trạng thái và tổng tiền đã chốt.

`record_goal` (gọi ở `respond` cuối mỗi lượt) ghi lại các task trong cuộc trò chuyện, cả domain người dùng đã yêu
cầu nhưng chưa lập task vì còn thiếu thông tin. Planner chỉ giữ task cần cho lượt đang xử lý, nên plan hiện tại
không đủ làm lịch sử. `record_selections` giữ phương án đã chọn khi Intake bắt đầu mục tiêu thực thi mới.

`plan_progress` là hàm thuần đọc state: quan hệ trước/sau lấy từ `depends_on`, từ tham chiếu tới thực thể do task
khác trả (`selected_listing_id`) và từ marker `selected:<domain>` trong input, không từ thứ tự cố định nào.
"Đã chốt" là người dùng đã xác nhận một phương án (fact `selected:<domain>`), không phải đã đặt hay đã trả tiền.
"""

from __future__ import annotations

from typing import Any

from relohome_agent.agents.housing_operations import is_housing_comparison
from relohome_agent.agents.models import AgentName, Plan, RequestKind, TaskResult, TaskStatus
from relohome_agent.agents.selections import option_ids, option_is_expired, selected_option, selection_is_current
from relohome_agent.agents.subagents.capabilities import BASELINE_CAPABILITIES

# Lĩnh vực không hiện trên dải tiến trình. Thanh toán qua chat đang tắt; tổng tiền thay bằng tổng đã chốt.
HIDDEN_DOMAINS = frozenset({AgentName.PAYMENT})
# Field input không có ý nghĩa với người dùng (do backend gắn hoặc là tham chiếu nội bộ).
INTERNAL_INPUTS = frozenset(
    {
        "bounding_box",
        "near_coordinate",
        "pickup_coordinate",
        "destination_coordinate",
        "near_place_id",
        "route_from_place_id",
        "route_to_place_id",
        "selected_listing_id",
        "listing_ids",
        "soft_filters",
        "cursor",
        "limit",
    }
)
ENTITY_REFERENCE_INPUTS = ("selected_listing_id", "listing_ids")


PENDING_PREFIX = "pending:"


def record_goal(state: dict) -> dict[str, dict]:
    """Các bước của cuộc trò chuyện qua các lượt (task_id -> agent, inputs, depends_on)."""
    intake = state.get("intake")
    plan: Plan | None = state.get("plan")
    goal: dict[str, dict] = dict(state.get("goal_tasks") or {})
    if intake is None or intake.kind == RequestKind.NEW_GOAL:
        # Keep completed steps in this conversation; old pending prompts no longer apply.
        goal = {k: v for k, v in goal.items() if not k.startswith(PENDING_PREFIX)}
    planned = {t.agent for t in plan.tasks} if plan else set()
    for key in [k for k, v in goal.items() if k.startswith(PENDING_PREFIX) and AgentName(v["agent"]) in planned]:
        del goal[key]
    for task in plan.tasks if plan else []:
        goal[task.id] = {"agent": task.agent.value, "inputs": dict(task.inputs), "depends_on": list(task.depends_on)}
    values = intake.constraints.values if intake else {}
    for domain in intake.domains if intake else []:
        if domain in planned or (
            intake.kind != RequestKind.NEW_GOAL
            and any(v["agent"] == domain.value and not k.startswith(PENDING_PREFIX) for k, v in goal.items())
        ):
            continue
        # Requested but not runnable yet (missing information): keep what the user already said for it.
        capability = BASELINE_CAPABILITIES.get(domain)
        keys = set((capability.input_schema.get("properties") or {}) if capability else ()) | set(
            capability.constraint_keys if capability else ()
        )
        goal[PENDING_PREFIX + domain.value] = {
            "agent": domain.value,
            "inputs": {k: v for k, v in values.items() if k in keys},
            "depends_on": [],
        }
    return goal


def record_selections(state: dict) -> dict[str, str]:
    """Remember verified choices by task without carrying old constraints into a new execution goal."""
    saved = dict(state.get("goal_selections") or {})
    intake = state.get("intake")
    plan: Plan | None = state.get("plan")
    results: dict[str, TaskResult] = state.get("task_results") or {}
    facts = intake.user_confirmed_facts if intake else {}
    for task in plan.tasks if plan else []:
        fact = facts.get(f"selected:{task.agent.value}")
        result = results.get(task.id)
        if (
            not fact
            or not result
            or result.agent != task.agent
            or not selection_is_current(state, task.id, str(fact.value))
        ):
            continue
        # A newer verified selection for this service supersedes an older one.
        for old_id in list(saved):
            old_result = results.get(old_id)
            if old_id != task.id and old_result and old_result.agent == task.agent:
                del saved[old_id]
        saved[task.id] = str(fact.value)
    return saved


def select_plan_option(state: dict, task_id: str, option_id: str, invalidated: set[str]) -> dict[str, str]:
    """Record a validated UI selection and forget affected or superseded choices."""
    saved = record_selections(state)
    results: dict[str, TaskResult] = state.get("task_results") or {}
    chosen_result = results.get(task_id)
    for old_id in list(saved):
        old_result = results.get(old_id)
        if old_id in invalidated or (chosen_result and old_result and old_result.agent == chosen_result.agent):
            del saved[old_id]
    saved[task_id] = str(option_id)
    return saved


def _references(tasks: dict[str, dict], results: dict[str, TaskResult]) -> dict[str, set[str]]:
    """Task -> task nó dựa vào: depends_on, task đã cho ra thực thể nó tham chiếu, marker selected:<domain>."""
    edges = {tid: {d for d in t["depends_on"] if d in tasks} for tid, t in tasks.items()}
    for tid, task in tasks.items():
        inputs = task["inputs"]
        referenced = set()
        for key in ENTITY_REFERENCE_INPUTS:
            value = inputs.get(key)
            referenced |= {str(v) for v in (value if isinstance(value, list) else [value]) if v}
        domains = {v.split(":", 1)[1] for v in inputs.values() if isinstance(v, str) and v.startswith("selected:")}
        for other_id, other in tasks.items():
            if other_id == tid:
                continue
            if referenced & option_ids(results.get(other_id)) or other["agent"] in domains:
                edges[tid].add(other_id)
    return edges


def _levels(tasks: dict[str, dict], edges: dict[str, set[str]]) -> dict[str, int]:
    """Cột hiển thị: task không phụ thuộc nhau cùng cột (song song), task dựa vào task khác đứng sau."""
    level: dict[str, int] = {}

    def depth(task_id: str, seen: frozenset[str] = frozenset()) -> int:
        if task_id in level:
            return level[task_id]
        parents = [p for p in edges.get(task_id, ()) if p not in seen]
        level[task_id] = 1 + max((depth(p, seen | {task_id}) for p in parents), default=-1)
        return level[task_id]

    for task_id in tasks:
        depth(task_id)
    return level


def plan_progress(values: dict) -> dict[str, Any]:
    plan: Plan | None = values.get("plan")
    tasks: dict[str, dict] = dict(values.get("goal_tasks") or {})
    for task in plan.tasks if plan else []:  # the current plan is authoritative for its own tasks
        tasks[task.id] = {"agent": task.agent.value, "inputs": dict(task.inputs), "depends_on": list(task.depends_on)}
    empty = {"items": [], "totals": {"monthly_vnd": 0, "one_time_vnd": 0, "confirmed": 0, "unpriced": []}}
    if not tasks:
        return empty
    # Analysis stays in the chat, not a second search/choice step or a cost item.
    tasks = {tid: task for tid, task in tasks.items() if not is_housing_comparison(task["agent"], task["inputs"])}
    intake = values.get("intake")
    facts = intake.user_confirmed_facts if intake else {}
    selections: dict[str, str] = values.get("goal_selections") or {}
    current_task_ids = {task.id for task in plan.tasks} if plan else set()
    statuses = values.get("task_status") or {}
    results: dict[str, TaskResult] = values.get("task_results") or {}
    edges = _references(tasks, results)
    levels = _levels(tasks, edges)
    items, monthly, one_time, unpriced = [], 0, 0, []
    for task_id, task in tasks.items():
        agent = AgentName(task["agent"])
        if agent in HIDDEN_DOMAINS:
            continue
        result = results.get(task_id)
        if result is not None and result.agent != agent:
            result = None  # id reused by a task of another domain
        status = statuses.get(task_id, TaskStatus.PENDING) if not task_id.startswith(PENDING_PREFIX) else None
        fact = facts.get(f"selected:{agent.value}") if task_id in current_task_ids else None
        selected_id = selections.get(task_id) or (str(fact.value) if fact is not None else None)
        expired_quote = (
            result is not None
            and (selected_id is not None or (agent == AgentName.RELOCATION and bool(result.quotes)))
            and option_is_expired(result, selected_id)
        )
        if expired_quote and status == TaskStatus.DONE:
            status = TaskStatus.STALE
        current = selected_id is not None and selection_is_current(values, task_id, selected_id)
        chosen = None
        if selected_id is not None and result is not None and selected_id in option_ids(result):
            option = selected_option(result, selected_id)
            quote = next((q for q in result.quotes if q.option_id == selected_id), None)
            chosen = {
                "id": selected_id,
                "label": quote.label if quote else (option.get("title") or option.get("carrier") or selected_id),
                "amount_vnd": quote.amount_vnd if quote and current else None,
                "recurrence": quote.recurrence if quote else None,
            }
            if current and quote is None:
                unpriced.append(task_id)
            elif current and quote.recurrence == "monthly":
                monthly += quote.amount_vnd
            elif current:
                one_time += quote.amount_vnd
        state = (
            "confirmed"
            if chosen and current
            else "reviewed"
            if status == TaskStatus.DONE and result is not None and result.status == "done"
            else "waiting"
        )
        inputs = task["inputs"]
        items.append(
            {
                "task_id": task_id,
                "agent": agent.value,
                "mode": inputs.get("map_mode") or inputs.get("mode") or inputs.get("moving_mode"),
                "inputs": {k: v for k, v in inputs.items() if k not in INTERNAL_INPUTS},
                "state": state,
                "task_status": str(status) if status else "needs_input",
                "after": sorted(
                    p for p in edges.get(task_id, ()) if AgentName(tasks[p]["agent"]) not in HIDDEN_DOMAINS
                ),
                "level": levels.get(task_id, 0),
                "chosen": chosen,
            }
        )
        if agent == AgentName.ROOMMATE:
            items[-1]["roommate_availability"] = result.data.get("availability") if result else "criteria_required"
    confirmed = sum(1 for i in items if i["state"] == "confirmed")
    return {
        "plan_version": plan.version if plan else None,
        "items": items,
        "totals": {"monthly_vnd": monthly, "one_time_vnd": one_time, "confirmed": confirmed, "unpriced": unpriced},
    }
