"""Tiến trình kế hoạch cho UI: các mục tiêu người dùng đã nêu, trạng thái và tổng tiền đã chốt.

`record_goal` (gọi ở `respond` cuối mỗi lượt) ghi lại mọi task của mục tiêu hiện tại qua các lượt, cả domain người
dùng đã yêu cầu nhưng chưa lập task vì còn thiếu thông tin; mục tiêu mới (`new_goal`) bắt đầu lại. Planner chỉ giữ
task cần cho lượt đang xử lý, nên plan hiện tại không đủ làm lịch sử.

`plan_progress` là hàm thuần đọc state: quan hệ trước/sau lấy từ `depends_on`, từ tham chiếu tới thực thể do task
khác trả (`selected_listing_id`) và từ marker `selected:<domain>` trong input, không từ thứ tự cố định nào.
"Đã chốt" là người dùng đã xác nhận một phương án (fact `selected:<domain>`), không phải đã đặt hay đã trả tiền.
"""

from __future__ import annotations

from typing import Any

from src.agents.models import AgentName, Plan, RequestKind, TaskResult, TaskStatus
from src.agents.subagents.capabilities import BASELINE_CAPABILITIES

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


def _option_ids(result: TaskResult | None) -> set[str]:
    if result is None:
        return set()
    ids = {q.option_id for q in result.quotes}
    for items in result.data.values():
        if isinstance(items, list):
            ids |= {str(i.get("id") or i.get("option_id")) for i in items if isinstance(i, dict)}
    ids.discard("None")
    return ids


def _option(result: TaskResult, option_id: str) -> dict[str, Any]:
    for items in result.data.values():
        if isinstance(items, list):
            for item in items:
                if isinstance(item, dict) and option_id in (item.get("id"), item.get("option_id")):
                    return item
    return {}


PENDING_PREFIX = "pending:"


def record_goal(state: dict) -> dict[str, dict]:
    """Các task của mục tiêu hiện tại qua các lượt (task_id -> agent, inputs, depends_on)."""
    intake = state.get("intake")
    plan: Plan | None = state.get("plan")
    fresh = intake is None or intake.kind == RequestKind.NEW_GOAL
    goal: dict[str, dict] = {} if fresh else dict(state.get("goal_tasks") or {})
    planned = {t.agent for t in plan.tasks} if plan else set()
    for key in [k for k, v in goal.items() if k.startswith(PENDING_PREFIX) and AgentName(v["agent"]) in planned]:
        del goal[key]
    for task in plan.tasks if plan else []:
        goal[task.id] = {"agent": task.agent.value, "inputs": dict(task.inputs), "depends_on": list(task.depends_on)}
    values = intake.constraints.values if intake else {}
    for domain in intake.domains if intake else []:
        if domain in planned or any(
            v["agent"] == domain.value and not k.startswith(PENDING_PREFIX) for k, v in goal.items()
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
            if referenced & _option_ids(results.get(other_id)) or other["agent"] in domains:
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
    intake = values.get("intake")
    facts = intake.user_confirmed_facts if intake else {}
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
        fact = facts.get(f"selected:{agent.value}")
        chosen = None
        if fact is not None and result is not None and str(fact.value) in _option_ids(result):
            option = _option(result, str(fact.value))
            quote = next((q for q in result.quotes if q.option_id == str(fact.value)), None)
            chosen = {
                "id": str(fact.value),
                "label": quote.label if quote else (option.get("title") or option.get("carrier") or str(fact.value)),
                "amount_vnd": quote.amount_vnd if quote else None,
                "recurrence": quote.recurrence if quote else None,
            }
            if quote is None:
                unpriced.append(task_id)
            elif quote.recurrence == "monthly":
                monthly += quote.amount_vnd
            else:
                one_time += quote.amount_vnd
        state = (
            "confirmed"
            if chosen and status != TaskStatus.STALE
            else "reviewed"
            if status == TaskStatus.DONE and result is not None
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
    confirmed = sum(1 for i in items if i["state"] == "confirmed")
    return {
        "plan_version": plan.version if plan else None,
        "items": items,
        "totals": {"monthly_vnd": monthly, "one_time_vnd": one_time, "confirmed": confirmed, "unpriced": unpriced},
    }
