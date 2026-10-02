"""Node `intake` (agent-graph.md §6.1): vỏ quanh `deps.intake`, kiểm kết quả bằng code.

Node không chọn agent/tool, không tạo DAG, không tạo approval.
"""

from __future__ import annotations

import logging
import re

from langchain_core.messages import HumanMessage

from src.agents.cost import call_graph_component, llm_calls_left
from src.agents.deps import GraphDeps
from src.agents.intake import (
    MAP_VIEW_REF,
    PLACE_CHOICE_FIELDS,
    SCOPE_DEPENDENTS,
    SEARCH_SCOPE_KEYS,
    IntakeInput,
    commit_fact_key,
    ground_facts,
    redact_pii,
    resolve_missing,
)
from src.agents.llm import LLMError
from src.agents.models import (
    AgentName,
    CommitActionKind,
    ConfirmedFact,
    IntakeResult,
    Outcome,
    OutcomeCode,
    RequestKind,
    TaskOutline,
    TaskStatus,
    active_commits,
    error_record,
)
from src.agents.state import WorkflowState
from src.agents.subagents.capabilities import operation_selector_keys

logger = logging.getLogger(__name__)


def explicitly_changed_fact(key: str, text: str) -> bool:
    """A user correction can coexist with a newly requested domain."""
    if key == "move_time":
        return bool(re.search(r"\b(?:đổi|sửa|chuyển)\s+giờ\b", text, re.IGNORECASE))
    if key in {"from_address", "to_address"}:
        return bool(re.search(r"\b(?:đổi chiều|đảo chiều|ngược lại)\b", text, re.IGNORECASE))
    if key in {"nearby_categories", "nearby_radius_m"}:
        return bool(re.search(r"\b(?:không cần .+ nữa|chỉ tìm|đổi|thay)\b", text, re.IGNORECASE))
    return False


def resolve_moving_references(result: IntakeResult, previous: IntakeResult | None) -> dict:
    """Resolve endpoint references against confirmed state, including its coordinates."""
    if AgentName.RELOCATION not in result.domains:
        return {}
    old = previous.constraints.values if previous else {}
    endpoints = {
        "previous:pickup": ("from_address", "pickup_coordinate"),
        "previous:destination": ("to_address", "destination_coordinate"),
    }
    carried_coordinates = {}
    for address_key, coordinate_key in endpoints.values():
        fact = result.user_confirmed_facts.get(address_key)
        if fact is None:
            continue
        source = endpoints.get(fact.value) if isinstance(fact.value, str) else None
        if source:
            address = old.get(source[0])
            if not address:
                result.conflicts.append("Chưa có điểm lấy/giao trước đó để dùng lại; bạn cho biết địa chỉ nhé.")
                result.user_confirmed_facts.pop(address_key, None)
                result.constraints.values.pop(address_key, None)
                continue
            fact = fact.model_copy(update={"value": address})
            result.user_confirmed_facts[address_key] = fact
            result.constraints.values[address_key] = address
        # Matching a previously confirmed point reuses its actual coordinates.
        # A new address never inherits coordinates merely because it is nearby.
        for old_address, old_coordinate in [source] if source else endpoints.values():
            if fact.value == old.get(old_address) and old.get(old_coordinate):
                carried_coordinates[coordinate_key] = dict(old[old_coordinate])
                break
    return carried_coordinates


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
        response = state.get("response")
        displayed = response.data.get("results", {}).get(task.id, {}).get("displayed_option_ids") if response else None
        if displayed:
            options = [o for o in options if o["option_id"] in displayed]
        outline.append(
            TaskOutline(
                id=task.id,
                agent=task.agent,
                options=options,
                selected=summary.selected.get(task.id) if summary else None,
            )
        )
    return outline


def continue_referenced_goal(result: IntakeResult, previous: IntakeResult | None) -> IntakeResult:
    """A domain switch that consumes a confirmed selection is a continuation.

    The reference comes from typed Intake fields and must already exist in
    confirmed state. A genuine fresh goal without such a binding still resets.
    """
    if result.kind != RequestKind.NEW_GOAL or previous is None:
        return result
    references = [
        value
        for value in result.constraints.values.values()
        if isinstance(value, str) and value.startswith("selected:")
    ]
    if any(reference in previous.user_confirmed_facts for reference in references):
        return result.model_copy(update={"kind": RequestKind.REFINE})
    return result


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
                    map_view_available=bool(state.get("map_view")),
                ),
                deps,
                state,
                "intake",
            )
            result = IntakeResult.model_validate(raw.model_dump() if isinstance(raw, IntakeResult) else raw)
        except Exception as exc:
            code = exc.code if isinstance(exc, LLMError) else "INTAKE_INTERNAL_ERROR"
            detail = (
                exc.message
                if isinstance(exc, LLMError)
                else "Bộ xử lý yêu cầu gặp lỗi nội bộ; không phải do câu hỏi của bạn."
            )
            logger.warning("intake failed: %s", code)
            return {
                "outcome": Outcome(node="intake", code=OutcomeCode.ERROR, detail=f"[{code}] {detail}"),
                "errors": [error_record("intake", code, now)],
            }

        result = continue_referenced_goal(result, previous)
        contextual_coordinates = resolve_moving_references(result, previous)
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
        # A precise reply to an outstanding field replaces that field's coarse
        # value; it is not a contradiction or a new workflow.
        pending_fields = {q.field.rsplit(".", 1)[-1] for q in last_response.questions} if last_response else set()
        latest_text = str(next((m.content for m in reversed(messages) if isinstance(m, HumanMessage)), ""))
        stopped_route = re.search(r"không cần (?:tính )?đường nữa", latest_text, re.IGNORECASE)
        if (
            stopped_route
            and previous
            and previous.constraints.values.get("map_mode") == "route"
            and AgentName.MAP in result.domains
            and "nearby_categories" in result.user_confirmed_facts
        ):
            result.user_confirmed_facts["map_mode"] = ConfirmedFact(
                value="nearby", evidence=stopped_route.group(0), stated_at=now
            )
            result.constraints.values["map_mode"] = "nearby"
        if (
            previous
            and result.kind == RequestKind.REFINE
            and any(
                (key in pending_fields or explicitly_changed_fact(key, latest_text))
                and key in previous.user_confirmed_facts
                and previous.user_confirmed_facts[key].value != fact.value
                for key, fact in result.user_confirmed_facts.items()
            )
        ):
            result = result.model_copy(update={"kind": RequestKind.CHANGE})
        user_texts = [str(m.content) for m in messages if isinstance(m, HumanMessage)]
        suggestion_keys = [s.key for s in last_response.suggestions] if last_response else []
        previous_facts = dict(previous.user_confirmed_facts) if previous else {}
        # Ý muốn đặt đã được thực hiện thì không mang sang lượt sau (tránh đặt lại ngoài ý muốn).
        for receipt in active_commits(state.get("committed")).values():
            key = commit_fact_key(receipt.kind)
            fact = previous_facts.get(key)
            if fact is not None and receipt.created_at >= fact.stated_at:
                previous_facts.pop(key)
        selectors = operation_selector_keys(
            c for c in (deps.agents.capability(n) for n in deps.agents.names()) if c is not None
        ) | {"moving_mode"}
        # Strip a model-authored Housing marker before conflict detection, not just before geocoding.
        if str(result.constraints.values.get("near", "")).startswith("selected:"):
            result.constraints.values.pop("near", None)
            result.user_confirmed_facts.pop("near", None)
        selected_map_anchor = result.constraints.values.get("map_near") == "selected:property"
        if selected_map_anchor:
            previous_facts.pop("map_near", None)
            result.user_confirmed_facts.pop("map_near", None)
            result.constraints.values.pop("map_near", None)
        grounded = ground_facts(
            result.user_confirmed_facts, previous_facts, result.kind, user_texts, suggestion_keys, selectors
        )
        if str(result.constraints.values.get("near", "")).startswith("selected:") or (
            "near" in grounded.facts and str(grounded.facts["near"].value).startswith("selected:")
        ):
            # A selected listing is an entity reference, not a place name for
            # Housing/Map geocoding. Map binds the selected listing ID itself.
            grounded.facts.pop("near", None)
            result.user_confirmed_facts.pop("near", None)
            result.constraints.values.pop("near", None)
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
        # A disabled transaction is not a conflict in otherwise valid read
        # tasks. Retain its intent separately and explain it to the user;
        # only enabled actions may reach planning/approval.
        commit_requested = [kind for kind in commit_requested if kind in supported_actions]
        # Preserve the user's spelling. Location/Flight resolve it against real catalogs;
        # an unresolved abbreviation must not block unrelated requested domains.
        facts = dict(grounded.facts)
        values = dict(result.constraints.values)
        if previous is not None and result.kind != RequestKind.NEW_GOAL:
            # Gộp dần qua các lượt: ràng buộc đã nói ở lượt trước vẫn giữ, giá trị mới thắng.
            carried = {k: v for k, v in previous.constraints.values.items() if k not in previous.prefilled}
            values = {**carried, **values}
        if str(values.get("near", "")).startswith("selected:"):
            values.pop("near", None)
            facts.pop("near", None)
        if selected_map_anchor:
            values.pop("map_near", None)
            values.pop("map_near_place_id", None)
        # A point confirmed for an old address cannot silently survive an address edit.
        if (
            previous
            and previous.constraints.values.get("city")
            and values.get("city") != previous.constraints.values.get("city")
        ):
            for key in ("district", "near", "near_coordinate"):
                if key not in result.user_confirmed_facts:
                    values.pop(key, None)
                    facts.pop(key, None)
        # The latest message defines where to search: naming a district or a place replaces the
        # scope carried from earlier turns (e.g. an old "gần Bách Khoa" must not narrow a new
        # "ở Cầu Giấy" request). Scopes stated together in this message are kept together.
        if previous and any(
            key in result.user_confirmed_facts and result.user_confirmed_facts[key].value != MAP_VIEW_REF
            for key in SEARCH_SCOPE_KEYS
        ):
            for key in SEARCH_SCOPE_KEYS:
                if key not in result.user_confirmed_facts:
                    values.pop(key, None)
                    facts.pop(key, None)
                    for dependent in SCOPE_DEPENDENTS.get(key, ()):
                        values.pop(dependent, None)
        if previous and previous.constraints.values.get("near") != values.get("near"):
            values.pop("near_coordinate", None)
        if previous and "district" in result.user_confirmed_facts and not values.get("city"):
            # Retain a city's real administrative identity when switching away from a landmark.
            # Never infer it from the district spelling or invent a geographic alias.
            prior_property = [
                r
                for tid, r in (state.get("task_results") or {}).items()
                if r.agent == AgentName.PROPERTY and (state.get("task_status") or {}).get(tid) == TaskStatus.DONE
            ]
            cities = {c["city"] for r in prior_property for c in r.data.get("candidates", []) if c.get("city")}
            if len(cities) == 1:
                values["city"] = next(iter(cities))
        housing_pin = state.get("housing_location")
        if (
            housing_pin
            and previous
            and any(
                key in result.user_confirmed_facts
                and result.user_confirmed_facts[key].value != previous.constraints.values.get(key)
                for key in ("city", "district")
            )
        ):
            housing_pin = None  # A previous near-pin cannot override a newly named administrative scope.
        if housing_pin and previous and (new_near := result.user_confirmed_facts.get("near")):
            old_near = previous.constraints.values.get("near")
            if new_near.value != old_near and housing_pin["address"] == old_near:
                housing_pin = None
        if AgentName.PROPERTY in result.domains and housing_pin and housing_pin.get("confirmed") is True:
            values["near"] = housing_pin["address"]
            values["near_coordinate"] = {"lat": housing_pin["lat"], "lng": housing_pin["lng"]}
        for key, address_key in (("pickup_coordinate", "from_address"), ("destination_coordinate", "to_address")):
            if previous and previous.constraints.values.get(address_key) != values.get(address_key):
                values.pop(key, None)
        values.update(contextual_coordinates)
        if AgentName.RELOCATION in result.domains:
            for endpoint, address_key, coord_key in (
                ("pickup", "from_address", "pickup_coordinate"),
                ("destination", "to_address", "destination_coordinate"),
            ):
                pin = (state.get("moving_locations") or {}).get(endpoint)
                if pin and pin.get("confirmed") is True:
                    current_fact = result.user_confirmed_facts.get(address_key)
                    old_address = previous.constraints.values.get(address_key) if previous else None
                    if (
                        current_fact
                        and old_address
                        and current_fact.value != old_address
                        and pin["address"] == old_address
                    ):
                        # Sidebar may still submit the previous confirmed pin.
                        # An explicit new address invalidates it, not vice versa.
                        continue
                    # Only the validated API input can supply this point, never a model draft.
                    values[address_key] = pin["address"]
                    values[coord_key] = {"lat": pin["lat"], "lng": pin["lng"]}
        # Bản đồ: "khu này" là khung đang xem mà API đã kiểm; nêu khu vực mới thì bỏ khung cũ.
        map_bbox = (state.get("map_view") or {}).get("bounding_box")
        named_area = any(
            key in result.user_confirmed_facts and result.user_confirmed_facts[key].value != MAP_VIEW_REF
            for key in ("city", "district", "near")
        )
        if values.get("near") == MAP_VIEW_REF:
            for key in ("near", "district", "near_coordinate", "near_place_id"):
                values.pop(key, None)
            facts.pop("near", None)
            if map_bbox:
                values["bounding_box"] = dict(map_bbox)
            else:
                result.conflicts.append("Bạn muốn tìm ở khu vực nào? Mình chưa nhận được vùng bản đồ đang xem.")
        elif named_area:
            values.pop("bounding_box", None)
        # Ứng viên địa điểm người dùng bấm chọn trên bản đồ: API đã đối chiếu với Location.
        choice = state.get("place_choice")
        for key in PLACE_CHOICE_FIELDS:
            if key in result.user_confirmed_facts and not (choice and choice["field"] == key):
                values.pop(key + "_place_id", None)
        if choice:
            choice_field = "map_near" if choice["field"] == "near" and values.get("map_near") else choice["field"]
            values[choice_field] = choice["name"]
            values[choice_field + "_place_id"] = choice["place_id"]
            if choice["field"] == "near":
                values.pop("near_coordinate", None)
                values.pop("bounding_box", None)
        result = result.model_copy(
            update={
                "constraints": result.constraints.model_copy(update={"values": values}),
                "user_confirmed_facts": facts,
                "commit_requested": commit_requested,
                "unavailable_commit_requested": unsupported,
                "conflicts": list(dict.fromkeys([*result.conflicts, *grounded.conflicts])),
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
        update: dict = {
            "intake": result,
            "declined_suggestions": result.declined_suggestions,
            "planner_questions": [],
            "housing_location": housing_pin,
        }
        if result.kind == RequestKind.NEW_GOAL:
            # Do not display a previous goal's results when a new goal needs input.
            update.update(plan=None, cost_summary=None)
        if errors:
            update["errors"] = errors
        if result.kind == RequestKind.UNSUPPORTED:
            update["outcome"] = Outcome(node="intake", code=OutcomeCode.UNSUPPORTED)
        elif result.needs_clarification:
            update["outcome"] = Outcome(node="intake", code=OutcomeCode.CLARIFY)
        return update

    return intake
