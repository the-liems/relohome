"""Planner của Routing Orchestrator: contract, `validate_plan` và các implementation giai đoạn khung.

agent-graph.md §6.2, §7.5. Mỗi `Task` là **một mục tiêu cho một lĩnh vực**, không phải một lần gọi
tool. S1, S2, S8 và Q25 được ép bằng `validate_plan`, không phụ thuộc vào LLM.
Phần kiểm cấu trúc DAG lấy từ `orchestrator/registry.py::validate_plan` của nhánh `khoa` (§3.3).
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import TYPE_CHECKING, Any, Protocol
from uuid import uuid4

from jsonschema import Draft202012Validator, FormatChecker
from pydantic import BaseModel
from relohome_agent.agents.housing_constraints import HOUSING_INPUT_KEYS
from relohome_agent.agents.housing_operations import is_housing_comparison, same_housing_operation
from relohome_agent.agents.intake import LOOKUP_KEYS, selected_fact_key
from relohome_agent.agents.memory import SOFT_FILTER_KEYS
from relohome_agent.agents.models import (
    AgentName,
    ChangeContext,
    CommitAction,
    CommitActionKind,
    IntakeResult,
    Plan,
    Question,
    Receipt,
    RequestKind,
    SessionContext,
    Task,
    TaskResult,
    ValidationReport,
)

if TYPE_CHECKING:
    from relohome_agent.agents.deps import AgentRegistry


class PlannerInput(BaseModel):
    intake: IntakeResult
    session: SessionContext
    previous_plan: Plan | None = None
    previous_results: dict[str, TaskResult] = {}
    reserved_task_ids: list[str] = []  # Existing history identities, including when NEW_GOAL hides old context.
    validation: ValidationReport | None = None
    change_context: ChangeContext | None = None
    available_agents: list[AgentName] = []
    committed: dict[str, Receipt] = {}


class PlannerOutput(BaseModel):
    plan: Plan
    # Trusted code-only optimization; never part of the LLM PlanDraft schema.
    retrieval_only_task_ids: list[str] = []
    # Domain được yêu cầu nhưng Planner xác định input hiện có chưa dùng được (ví dụ địa chỉ chỉ tới
    # cấp quận): câu hỏi gắn đúng field "<domain>.<key>", graph hỏi lại thay vì báo lỗi kế hoạch.
    questions: list[Question] = []


class Planner(Protocol):
    async def plan(self, inp: PlannerInput) -> PlannerOutput: ...


def plan_confirmed_moving_quote(previous: Plan | None, inputs: dict) -> tuple[Plan, Task]:
    """Planner-owned typed intent path, not a natural-language template/classifier.

    A quote form does not authorize pending writes. Existing receipts/results are
    retained in state; the next explicit booking request must plan its own actions.
    """
    tasks = list(previous.tasks) if previous else []
    targets = [t for t in tasks if t.agent == AgentName.RELOCATION and t.inputs.get("mode") == "quote"]
    if len(targets) > 1:
        raise ValueError("Choose the moving task to change; multiple quote tasks are present")
    old = targets[0] if targets else None
    task = Task(id=old.id if old else "moving-form-" + uuid4().hex[:12], agent=AgentName.RELOCATION, inputs=inputs)
    tasks = [task if old and t.id == old.id else t for t in tasks]
    if not old:
        tasks.append(task)
    return Plan(version=(previous.version if previous else 0) + 1, tasks=tasks, commit_actions=[]), task


def _empty() -> PlannerOutput:
    return PlannerOutput(plan=Plan(version=0, tasks=[]))


class NotImplementedPlanner:
    """Mặc định trong app: trả plan rỗng → `respond` trả UNSUPPORTED."""

    async def plan(self, inp: PlannerInput) -> PlannerOutput:
        return _empty()


class FixedPlanner:
    def __init__(self, plan: Plan):
        self._plan = plan
        self.inputs: list[PlannerInput] = []

    async def plan(self, inp: PlannerInput) -> PlannerOutput:
        self.inputs.append(inp)
        return PlannerOutput(plan=self._plan)


# --- validate_plan (§6.2 bước 3) ---

COMMIT_DOMAIN: dict[CommitActionKind, tuple[AgentName, ...]] = {
    CommitActionKind.MOVING_BOOKING: (AgentName.RELOCATION,),
    CommitActionKind.FLIGHT_BOOKING: (AgentName.FLIGHT,),
    CommitActionKind.CANCEL_ORDER: (AgentName.RELOCATION, AgentName.FLIGHT),
    CommitActionKind.UPDATE_ORDER: (AgentName.RELOCATION,),
    CommitActionKind.DEPOSIT: (AgentName.PROPERTY,),
}


def _schema_errors(value: Any, schema: dict) -> list[str]:
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    return [e.message for e in validator.iter_errors(value)]


def validate_plan(
    plan: Plan,
    registry: AgentRegistry,
    intake: IntakeResult,
    committed: dict[str, Receipt],
    previous_plan: Plan | None = None,
) -> list[str]:
    """Trả danh sách lỗi; rỗng là plan hợp lệ."""
    errors: list[str] = []
    ids = [t.id for t in plan.tasks]
    id_set = set(ids)
    if len(id_set) != len(ids):
        errors.append("task id bị trùng")
    carried = {t.id: t for t in previous_plan.tasks} if previous_plan else {}
    remaining: dict[str, set[str]] = {}
    for task in plan.tasks:
        previous = carried.get(task.id)
        if (
            previous is not None
            and task.agent == previous.agent == AgentName.PROPERTY
            and not same_housing_operation(task.agent, previous.inputs, task.inputs)
        ):
            errors.append(f"{task.id}: comparison and search must use separate task IDs")
        deps = set(task.depends_on)
        if len(deps) != len(task.depends_on) or not deps <= id_set or task.id in deps:
            errors.append(f"{task.id}: depends_on trùng, trỏ tới task không có hoặc trỏ tới chính nó")
        capability = registry.capability(task.agent)
        if task.agent == AgentName.ROOMMATE and task.depends_on:
            errors.append(f"{task.id}: Roommate discovery must be independent")
        if task.agent in {AgentName.MAP, AgentName.RELOCATION}:
            selected = intake.user_confirmed_facts.get(selected_fact_key(AgentName.PROPERTY))
            selected_id = task.inputs.get("selected_listing_id")
            if selected_id is not None and (selected is None or selected_id != selected.value):
                errors.append(f"{task.id}: selected_listing_id must match the confirmed housing selection")
            endpoint_keys = (
                ("route_from", "route_to") if task.agent == AgentName.MAP else ("from_address", "to_address")
            )
            if any(task.inputs.get(k) == "selected:property" for k in endpoint_keys) and not selected_id:
                errors.append(f"{task.id}: selected housing route requires selected_listing_id")
        if capability is None:
            errors.append(f"{task.id}: lĩnh vực {task.agent.value} không có trong registry")
        else:
            for message in _schema_errors(task.inputs, capability.input_schema)[:3]:
                errors.append(f"{task.id}: inputs sai schema: {message}")
            is_carried = carried.get(task.id) == task
            if capability.cost_tier == "paid" and task.agent not in intake.domains and not is_carried:
                errors.append(f"{task.id}: task paid cho lĩnh vực người dùng không yêu cầu (S1)")
        remaining[task.id] = deps & id_set
    resolved: set[str] = set()
    while remaining:
        ready = {k for k, deps in remaining.items() if deps <= resolved}
        if not ready:
            errors.append("DAG có chu trình")
            break
        resolved |= ready
        remaining = {k: v for k, v in remaining.items() if k not in ready}
    by_id = {t.id: t for t in plan.tasks}
    action_ids = [a.id for a in plan.commit_actions]
    if len(set(action_ids)) != len(action_ids):
        errors.append("commit action id bị trùng")
    for action in plan.commit_actions:
        if action.kind == CommitActionKind.DEPOSIT:
            errors.append(f"{action.id}: đặt cọc ngoài phạm vi MVP (Q25)")
            continue
        source = by_id.get(action.source_task_id)
        if source is None:
            errors.append(f"{action.id}: source_task_id không có trong plan")
            continue
        if is_housing_comparison(source.agent, source.inputs):
            errors.append(f"{action.id}: comparison is read-only and cannot be a transaction source")
        if action.kind not in registry.commit_kinds(source.agent):
            errors.append(f"{action.id}: service {source.agent.value} không hỗ trợ {action.kind.value}")
        if action.kind not in intake.commit_requested:
            errors.append(f"{action.id}: người dùng chưa yêu cầu {action.kind.value} (S2)")
        if action.id in committed:
            errors.append(f"{action.id}: đã đặt ở lượt trước (S8)")
        if (
            action.kind in (CommitActionKind.CANCEL_ORDER, CommitActionKind.UPDATE_ORDER)
            and not action.target_receipt_id
        ):
            errors.append(f"{action.id}: thiếu target_receipt_id")
    return errors


# --- TemplatePlanner (§6.2, §7.5 nguyên tắc 2) ---

DOMAIN_ORDER = (
    AgentName.PROPERTY,
    AgentName.MAP,
    AgentName.FLIGHT,
    AgentName.RELOCATION,
    AgentName.PAYMENT,
    AgentName.ROOMMATE,
)
DEFAULT_MAP_CATEGORIES = ["hospital", "marketplace", "pharmacy"]
PII_REQUIRED: dict[CommitActionKind, list[str]] = {
    CommitActionKind.FLIGHT_BOOKING: ["passengers", "contact"],
    CommitActionKind.MOVING_BOOKING: ["pickup_contact", "destination_contact"],
    CommitActionKind.UPDATE_ORDER: ["order_update"],
}


def _put(target: dict[str, Any], key: str, value: Any) -> None:
    if value not in (None, "", [], {}):
        target[key] = value


class TemplatePlanner:
    """Planner tất định theo mẫu, không gọi LLM.

    Mỗi lĩnh vực trong yêu cầu thành một task với input lấy từ `IntakeResult.constraints`; phụ thuộc
    theo bảng "suy ra từ task khác" (§6.1). Task còn thiếu input thì không tạo (validator hỏi sau).
    Giữ id và task của plan trước khi `REFINE` / `CHANGE` để orchestrator tái dùng kết quả `DONE`.
    Yêu cầu có lĩnh vực ngoài mẫu (hoặc `intent.name` trong `llm_intents`) chuyển cho `fallback`
    (LLM Planner, issue Routing Orchestrator).
    """

    def __init__(self, fallback: Planner | None = None, llm_intents: Iterable[str] = ()):
        self.fallback = fallback
        self.llm_intents = set(llm_intents)

    async def plan(self, inp: PlannerInput) -> PlannerOutput:
        intake = inp.intake
        domains = intake.domains
        if not domains:
            return _empty()
        if self.fallback and (
            any(d not in DOMAIN_ORDER for d in domains) or (intake.intent and intake.intent.name in self.llm_intents)
        ):
            return await self.fallback.plan(inp)
        values = self._with_cancel_target(dict(intake.constraints.values), intake, inp.committed)
        blocked = {m.split(".", 1)[0] for m in intake.constraints.missing}
        previous = inp.previous_plan if intake.kind != RequestKind.NEW_GOAL else None
        prev_by_agent = {t.agent: t for t in previous.tasks} if previous else {}
        wanted = [d for d in DOMAIN_ORDER if d in domains or d in prev_by_agent]
        used_ids = {t.id for t in previous.tasks} if previous else set()
        next_index = 1 + max((int(i[1:]) for i in used_ids if i[1:].isdigit()), default=0)

        tasks: dict[AgentName, Task] = {}
        for domain in wanted:
            if domain not in domains:
                tasks[domain] = prev_by_agent[domain]  # lĩnh vực của lượt trước: giữ nguyên (S5)
                continue
            if domain.value in blocked:
                continue
            inputs, needs_property = self._inputs(domain, values, intake)
            if inputs is None:
                continue
            depends = []
            if needs_property:
                if AgentName.PROPERTY not in tasks:
                    continue
                depends = [tasks[AgentName.PROPERTY].id]
            if domain in prev_by_agent:
                task_id = prev_by_agent[domain].id
            else:
                task_id = f"t{next_index}"
                next_index += 1
            tasks[domain] = Task(id=task_id, agent=domain, inputs=inputs, depends_on=depends)

        actions = []
        for kind in intake.commit_requested:
            action = self._commit_action(kind, tasks, values, inp.committed)
            if action is not None:
                actions.append(action)
        return PlannerOutput(plan=Plan(version=0, tasks=list(tasks.values()), commit_actions=actions))

    @staticmethod
    def _with_cancel_target(values: dict[str, Any], intake: IntakeResult, committed: dict[str, Receipt]) -> dict:
        """Huỷ đơn mà người dùng không nói mã ("có, huỷ đơn chuyển nhà đi"): lấy đơn đã đặt trong thread nếu
        chỉ có đúng một đơn khớp lĩnh vực; nhiều đơn thì để Intake hỏi lại, không đoán."""
        if CommitActionKind.CANCEL_ORDER not in intake.commit_requested:
            return values
        if any(values.get(k) for k in ("order_id", "tracking_number", "booking_ref")):
            return values
        for domain, kind, key in (
            (AgentName.RELOCATION, CommitActionKind.MOVING_BOOKING, "order_id"),
            (AgentName.FLIGHT, CommitActionKind.FLIGHT_BOOKING, "booking_ref"),
        ):
            receipts = [r for r in committed.values() if r.kind == kind]
            if domain in intake.domains and len(receipts) == 1:
                values[key] = receipts[0].receipt_id
                break
        return values

    @staticmethod
    def _inputs(domain: AgentName, values: dict[str, Any], intake: IntakeResult) -> tuple[dict | None, bool]:
        inputs: dict[str, Any] = {}
        if domain == AgentName.PROPERTY:
            soft = {}
            for key in HOUSING_INPUT_KEYS:
                if key in intake.prefilled and key in SOFT_FILTER_KEYS:
                    _put(soft, key, values.get(key))
                elif key == "must_have" and values.get(key) == []:
                    inputs[key] = []  # Explicitly clearing the last amenity is a valid, grounded filter.
                else:
                    _put(inputs, key, values.get(key))
            _put(inputs, "soft_filters", soft)
            return inputs, False
        if domain == AgentName.MAP:
            selected = intake.user_confirmed_facts.get(selected_fact_key(AgentName.PROPERTY))
            if values.get("map_mode") == "route":
                inputs = {
                    k: values[k] for k in ("map_mode", "route_from", "route_to", "city", "route_profile") if k in values
                }
                if values.get("map_city"):
                    inputs["city"] = values["map_city"]
                if selected and any(inputs.get(k) == "selected:property" for k in ("route_from", "route_to")):
                    inputs["selected_listing_id"] = str(selected.value)
                return inputs, False
            _put(
                inputs,
                "categories",
                values.get("map_categories") or values.get("nearby_categories") or DEFAULT_MAP_CATEGORIES,
            )
            inputs["radius_m"] = int(values.get("map_radius_m") or values.get("nearby_radius_m") or 1500)
            standalone = values.get("map_near") or (values.get("near") and AgentName.PROPERTY not in intake.domains)
            if standalone:
                inputs["near"] = values.get("map_near") or values["near"]
            elif selected:
                inputs["selected_listing_id"] = str(selected.value)
            return inputs, not standalone and selected is None
        if domain == AgentName.FLIGHT:
            if values.get("booking_ref"):
                return {"booking_ref": values["booking_ref"]}, False
            _put(inputs, "origin", values.get("origin"))
            _put(inputs, "destination", values.get("destination"))
            _put(inputs, "date", values.get("flight_date"))
            if values.get("trip_type") == "round_trip":
                inputs["trip_type"] = "round_trip"
                _put(inputs, "return_date", values.get("return_date"))
            adults = values.get("passengers") or values.get("household_size") or 1
            inputs["passengers"] = {"adults": int(adults)}
            return inputs, "destination" not in inputs
        if domain == AgentName.ROOMMATE:
            return {"roommate_criteria": values["roommate_criteria"]} if values.get("roommate_criteria") else {}, False
        if domain == AgentName.PAYMENT:
            return {"payment_id": values["payment_id"]}, False
        if domain == AgentName.RELOCATION:
            if values.get("moving_mode") == "catalog":
                return {"mode": "catalog"}, False
            lookup = [k for k in LOOKUP_KEYS[AgentName.RELOCATION] if values.get(k)]
            if lookup:
                return {"mode": "order_status", **{k: values[k] for k in lookup}}, False
            inputs["mode"] = "quote"
            for key in ("from_address", "to_address", "move_date", "move_time", "volume"):
                _put(inputs, key, values.get(key))
            selected = intake.user_confirmed_facts.get(selected_fact_key(AgentName.PROPERTY))
            if selected is not None and (
                "to_address" not in inputs
                or any(inputs.get(k) == "selected:property" for k in ("from_address", "to_address"))
            ):
                inputs["selected_listing_id"] = str(selected.value)
                return inputs, False
            return inputs, False
        return None, False

    @staticmethod
    def _commit_action(
        kind: CommitActionKind, tasks: dict[AgentName, Task], values: dict[str, Any], committed: dict[str, Receipt]
    ) -> CommitAction | None:
        for domain in COMMIT_DOMAIN.get(kind, ()):
            task = tasks.get(domain)
            if task is None:
                continue
            target = None
            if kind in (CommitActionKind.CANCEL_ORDER, CommitActionKind.UPDATE_ORDER):
                target = values.get("order_id") or values.get("tracking_number") or values.get("booking_ref")
                if not target:
                    continue
            action_id = f"{kind.value}:{task.id}"
            if action_id in committed:
                return None
            return CommitAction(
                id=action_id,
                kind=kind,
                source_task_id=task.id,
                target_receipt_id=str(target) if target else None,
                requires_payment=kind == CommitActionKind.FLIGHT_BOOKING,
                pii_required=PII_REQUIRED.get(kind, []),
            )
        return None
