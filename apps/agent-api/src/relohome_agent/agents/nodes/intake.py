"""Node `intake` (agent-graph.md §6.1): vỏ quanh `deps.intake`, kiểm kết quả bằng code.

Node không chọn agent/tool, không tạo DAG, không tạo approval.
"""

from __future__ import annotations

import logging
import re

from langchain_core.messages import HumanMessage
from relohome_agent.agents.cost import call_graph_component, llm_calls_left
from relohome_agent.agents.deps import GraphDeps
from relohome_agent.agents.housing_constraints import HOUSING_INPUT_KEYS
from relohome_agent.agents.housing_filter_edits import patched_amenities, valid_filter_patch
from relohome_agent.agents.housing_operations import is_housing_comparison
from relohome_agent.agents.intake import (
    MAP_ENTITY_ANCHORS,
    MAP_VIEW_REF,
    PLACE_CHOICE_FIELDS,
    SCOPE_DEPENDENTS,
    SEARCH_SCOPE_KEYS,
    IntakeInput,
    commit_fact_key,
    entity_reference,
    ground_facts,
    redact_pii,
    resolve_missing,
)
from relohome_agent.agents.llm import LLMError
from relohome_agent.agents.models import (
    AgentName,
    CommitActionKind,
    ConfirmedFact,
    IntakeResult,
    Outcome,
    OutcomeCode,
    RequestKind,
    TaskOutline,
    active_commits,
    error_record,
)
from relohome_agent.agents.selections import selection_is_current
from relohome_agent.agents.state import WorkflowState
from relohome_agent.agents.subagents.capabilities import operation_selector_keys

logger = logging.getLogger(__name__)

EXPLICIT_HOUSING_CITIES = (
    (re.compile(r"(?<!\w)(Hà Nội|Ha Noi)(?!\w)", re.IGNORECASE), "Hà Nội"),
    (
        re.compile(r"(?<!\w)(TP\.?\s*HCM|TP\.?\s*Hồ Chí Minh|Thành phố Hồ Chí Minh)(?!\w)", re.IGNORECASE),
        "Thành phố Hồ Chí Minh",
    ),
    (re.compile(r"(?<!\w)(Đà Nẵng|Da Nang)(?!\w)", re.IGNORECASE), "Đà Nẵng"),
)


def stated_housing_city(text: str) -> tuple[str, str] | None:
    """Use only a city actually named in this turn; never derive it from a district."""
    matches = [(match.group(0), city) for pattern, city in EXPLICIT_HOUSING_CITIES if (match := pattern.search(text))]
    return matches[0] if len(matches) == 1 else None


def explicitly_changed_fact(key: str, text: str) -> bool:
    """A user correction can coexist with a newly requested domain."""
    if key == "move_time":
        return bool(re.search(r"\b(?:đổi|sửa|chuyển)\s+giờ\b", text, re.IGNORECASE))
    if key in {"from_address", "to_address"}:
        return bool(re.search(r"\b(?:đổi chiều|đảo chiều|ngược lại)\b", text, re.IGNORECASE))
    if key in {"nearby_categories", "nearby_radius_m", "map_categories", "map_radius_m"}:
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
                comparison_options=[
                    {"option_id": c["id"], "label": c.get("title") or "Tin nhà"}
                    for c in (result.data.get("candidates", []) if result and task.agent == AgentName.PROPERTY else [])
                ][:20],
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


def chat_housing_selection(
    deps: GraphDeps, state: WorkflowState, facts: dict, values: dict, result: IntakeResult
) -> list | None:
    """Chọn, bỏ hoặc đổi căn qua chat khi bật hẹn xem: chỉ đổi tập căn đang xem, không chốt
    (housing-viewing-design V3). Trả danh sách căn mới cho checkpoint, hoặc None nếu lượt này không đụng tới."""
    if not deps.settings.housing_viewing or deps.housing_selector is None:
        return None
    user_id, thread_id = state.get("user_id", ""), state.get("thread_id", "")
    drop = facts.pop("housing_unselect_ids", None)
    add = facts.pop("housing_select_ids", None)
    values.pop("housing_unselect_ids", None)
    values.pop("housing_select_ids", None)
    wanted = [str(v) for v in (add.value if add else [])]
    chosen = facts.get("selected:property")
    before = (state.get("intake") or None) and state["intake"].user_confirmed_facts.get("selected:property")
    if chosen is not None and (before is None or before.value != chosen.value):
        facts.pop("selected:property")  # chọn để hẹn xem, chưa phải căn của kế hoạch
        values.pop("selected:property", None)
        wanted.append(str(chosen.value))
    if not drop and not wanted:
        return None
    selection = None
    try:
        for listing_id in drop.value if drop else []:  # bỏ trước để "đổi căn" không vượt giới hạn
            selection = deps.housing_unselector(user_id, thread_id, str(listing_id))
        for listing_id in dict.fromkeys(wanted):
            found = _housing_row(state, listing_id)
            if found is None:
                result.conflicts.append("Mình chưa thấy căn này trong kết quả hiện tại; hãy mở bản đồ nhà ở để chọn.")
                continue
            selection = deps.housing_selector(user_id, thread_id, found[0], found[1])
    except ValueError as exc:  # đủ số căn, đã chốt căn khác, căn không còn trong tập
        result.conflicts.append(str(exc))
    return selection


def selection_only_turn(previous: IntakeResult | None, result: IntakeResult) -> bool:
    """Lượt không có dữ kiện mới nào ngoài việc thêm/bỏ căn đang xem (các khóa đó đã được gỡ khỏi facts)."""
    if previous is None or result.kind == RequestKind.NEW_GOAL or result.needs_clarification:
        return False
    if set(result.domains) - set(previous.domains):
        return False
    before = previous.user_confirmed_facts
    return all(key in before and before[key].value == fact.value for key, fact in result.user_confirmed_facts.items())


def _housing_row(state: WorkflowState, listing_id: str) -> tuple[str, dict] | None:
    for task_id, task_result in (state.get("task_results") or {}).items():
        if task_result.agent != AgentName.PROPERTY or task_result.data.get("comparison"):
            continue
        row = next((c for c in task_result.data.get("candidates") or [] if c.get("id") == listing_id), None)
        if row is not None:
            return task_id, row
    return None


def remembered_home(previous: IntakeResult | None, state: WorkflowState) -> IntakeResult | None:
    """Expose a previously verified home to Intake without restoring unrelated old constraints."""
    if previous is None or "selected:property" in previous.user_confirmed_facts:
        return previous
    results = state.get("task_results") or {}
    for task_id, option_id in reversed(list((state.get("goal_selections") or {}).items())):
        result = results.get(task_id)
        if (
            result is None
            or result.agent != AgentName.PROPERTY
            or not selection_is_current(state, task_id, option_id)
            or not any(c.get("id") == option_id for c in result.data.get("candidates", []))
        ):
            continue
        fact = ConfirmedFact(
            value=option_id,
            evidence="Lựa chọn đã xác nhận trong hội thoại",
            stated_at=result.fetched_at,
        )
        return previous.model_copy(
            deep=True,
            update={"user_confirmed_facts": {**previous.user_confirmed_facts, "selected:property": fact}},
        )
    return previous


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
        previous: IntakeResult | None = remembered_home(state.get("intake"), state)
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
                    last_housing_search_options=state.get("last_housing_search_options") or [],
                    housing_selection=state.get("housing_selection") or [],
                    decision=state.get("user_decision"),
                    pending_questions=last_response.questions if last_response else [],
                    last_suggestions=last_response.suggestions if last_response else [],
                    supported_domains=deps.agents.names(),
                    map_view_available=bool(state.get("map_view")),
                    verified_place_choice=state.get("place_choice"),
                    verified_moving_locations=state.get("moving_locations"),
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
            logger.warning("intake failed: %s", code, exc_info=True)
            return {
                "outcome": Outcome(node="intake", code=OutcomeCode.ERROR, detail=f"[{code}] {detail}"),
                "errors": [error_record("intake", code, now)],
            }

        result = continue_referenced_goal(result, previous)
        if previous is not None and result.kind != RequestKind.NEW_GOAL:
            # A filter-only follow-up cannot erase unrepresented requirements or
            # choices from a previous analytical/multi-service goal. Legacy
            # checkpoints (no semantic hint) deliberately keep the full path.
            result.retrieval_only = bool(
                result.retrieval_only
                and previous.retrieval_only
                and previous.domains == [AgentName.PROPERTY]
                and not state.get("housing_selection")
                and not state.get("goal_selections")
                and not state.get("pending_payment")
            )
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
        fresh_housing_scope = AgentName.PROPERTY in result.domains and any(
            key in result.user_confirmed_facts for key in SEARCH_SCOPE_KEYS
        )
        fresh_comparison_search = (
            fresh_housing_scope
            and result.constraints.values.get("housing_mode") == "compare"
            and not result.user_confirmed_facts.get("listing_ids")
            and re.search(r"so sánh", latest_text, re.IGNORECASE)
            and re.search(r"rẻ nhất|thấp nhất", latest_text, re.IGNORECASE)
        )
        if fresh_comparison_search:
            # A new area plus a superlative requests fresh results. Previously
            # viewed IDs cannot stand in for homes in that new area.
            amount = re.search(r"\b([2-4])\s*[-–]\s*([2-4])\b|\b([2-4])\s*căn\b", latest_text)
            count = int(amount.group(2) or amount.group(3)) if amount else 4
            result.constraints.values.update(housing_mode="search_compare", limit=count)
            result.user_confirmed_facts["housing_mode"] = ConfirmedFact(
                value="search_compare", evidence="so sánh", stated_at=now
            )
            result.user_confirmed_facts["limit"] = ConfirmedFact(
                value=count, evidence=amount.group(0) if amount else "so sánh", stated_at=now
            )
            result.conflicts = [c for c in result.conflicts if "so sánh" not in c.casefold()]
        explicit_city = stated_housing_city(latest_text) if fresh_housing_scope else None
        if explicit_city and "city" not in result.user_confirmed_facts:
            evidence, city = explicit_city
            result.user_confirmed_facts["city"] = ConfirmedFact(value=city, evidence=evidence, stated_at=now)
            result.constraints.values["city"] = city
        if (
            previous is not None
            and result.domains == [AgentName.PROPERTY]
            and is_housing_comparison(AgentName.PROPERTY, result.constraints.values)
        ):
            # Analysing observed homes is not changing the active home/search.
            # Normalize before grounding, so NEW_GOAL cannot erase its choices.
            result = result.model_copy(
                update={"kind": RequestKind.REFINE, "target_task_ids": [], "change_request": None}
            )
        stopped_route = re.search(r"không cần (?:tính )?đường nữa", latest_text, re.IGNORECASE)
        if (
            stopped_route
            and previous
            and previous.constraints.values.get("map_mode") == "route"
            and AgentName.MAP in result.domains
            and any(k in result.user_confirmed_facts for k in ("map_categories", "nearby_categories"))
        ):
            result.user_confirmed_facts["map_mode"] = ConfirmedFact(
                value="nearby", evidence=stopped_route.group(0), stated_at=now
            )
            result.constraints.values["map_mode"] = "nearby"
        if (
            previous
            and result.kind == RequestKind.REFINE
            and any(
                not (is_housing_comparison(AgentName.PROPERTY, result.constraints.values) and key in HOUSING_INPUT_KEYS)
                and (key in pending_fields or explicitly_changed_fact(key, latest_text))
                and key in previous.user_confirmed_facts
                and previous.user_confirmed_facts[key].value != fact.value
                for key, fact in result.user_confirmed_facts.items()
            )
        ):
            result = result.model_copy(update={"kind": RequestKind.CHANGE})
        user_texts = [str(m.content) for m in messages if isinstance(m, HumanMessage)]
        suggestion_keys = [s.key for s in last_response.suggestions] if last_response else []
        previous_facts = dict(previous.user_confirmed_facts) if previous else {}
        cleared_filters: set[str] = set()
        patch = result.housing_filter_patch
        if patch is not None:
            if (
                previous is not None
                and result.kind in {RequestKind.REFINE, RequestKind.CHANGE}
                and AgentName.PROPERTY in result.domains
                and result.constraints.values.get(
                    "housing_mode", previous.constraints.values.get("housing_mode", "search")
                )
                == "search"
                and valid_filter_patch(patch, latest_text, result.constraints.values)
            ):
                cleared_filters.update(patch.clear_fields)
                for key in patch.clear_fields:
                    cleared_filters.update(SCOPE_DEPENDENTS.get(key, ()))
                if patch.add_amenities or patch.remove_amenities:
                    updated = patched_amenities(previous.constraints.values.get("must_have", []), patch)
                    result.constraints.values["must_have"] = updated
                    result.user_confirmed_facts["must_have"] = ConfirmedFact(
                        value=updated, evidence=patch.evidence, stated_at=now
                    )
                for key in cleared_filters:
                    previous_facts.pop(key, None)
                result = result.model_copy(update={"kind": RequestKind.CHANGE})
            else:
                result.conflicts.append(
                    "Bạn muốn bỏ hoặc thêm điều kiện tìm nhà nào? Mình chưa xác minh được thay đổi."
                )
                result.retrieval_only = False
        # The patch is turn-local; only its grounded, merged effects survive.
        result.housing_filter_patch = None
        for endpoint, address_key in (("pickup", "from_address"), ("destination", "to_address")):
            pin = (state.get("moving_locations") or {}).get(endpoint)
            if pin and pin.get("confirmed") is True:
                old = previous_facts.get(address_key)
                if old and old.value != pin["address"]:
                    # A newly selected precise pin can differ from the old query
                    # label. Its canonical address will be applied below, not
                    # compared as a conflicting model-authored paraphrase.
                    previous_facts.pop(address_key, None)
        choice = state.get("place_choice")
        choice_field = None
        if choice:
            current_values = {**(previous.constraints.values if previous else {}), **result.constraints.values}
            choice_field = (
                "map_near" if choice["field"] == "near" and current_values.get("map_near") else choice["field"]
            )
            # This field is explicitly selected through the verified API. Its
            # canonical label need not equal the old free-text query, and must
            # not be re-grounded as a conflicting model paraphrase.
            previous_facts.pop(choice_field, None)
            result.user_confirmed_facts.pop(choice_field, None)
        # Ý muốn đặt đã được thực hiện thì không mang sang lượt sau (tránh đặt lại ngoài ý muốn).
        for receipt in active_commits(state.get("committed")).values():
            key = commit_fact_key(receipt.kind)
            fact = previous_facts.get(key)
            if fact is not None and receipt.created_at >= fact.stated_at:
                previous_facts.pop(key)
        selectors = operation_selector_keys(
            c for c in (deps.agents.capability(n) for n in deps.agents.names()) if c is not None
        ) | {"moving_mode"}
        if fresh_housing_scope:
            # A new named scope replaces the old city's authority. An explicitly
            # named city may overwrite it; otherwise Location resolves the scope.
            for key in ("city", *SEARCH_SCOPE_KEYS):
                previous_facts.pop(key, None)
        if AgentName.PROPERTY in result.domains and result.constraints.values.get("housing_mode") == "compare":
            # The read-only comparison set can change without changing the chosen
            # home or authorizing a transaction. LlmIntake already validates each
            # ID against observed options and requires current user evidence.
            selectors |= set(HOUSING_INPUT_KEYS)
        # Strip a model-authored Housing reference before conflict detection, not just before geocoding:
        # Housing `near` is a place; an entity reference there would be geocoded as text.
        if entity_reference(result.constraints.values.get("near")):
            result.constraints.values.pop("near", None)
            result.user_confirmed_facts.pop("near", None)
        map_anchor = entity_reference(result.constraints.values.get("map_near"))
        if map_anchor:
            result.constraints.values["map_near"] = map_anchor
        # An entity anchor replaces any earlier named Map anchor; the graph binds the entity itself.
        selected_map_anchor = result.constraints.values.get("map_near") in MAP_ENTITY_ANCHORS.values()
        if selected_map_anchor:
            previous_facts.pop("map_near", None)
            result.user_confirmed_facts.pop("map_near", None)
            result.constraints.values.pop("map_near", None)
        grounded = ground_facts(
            result.user_confirmed_facts, previous_facts, result.kind, user_texts, suggestion_keys, selectors
        )
        if entity_reference(result.constraints.values.get("near")) or (
            "near" in grounded.facts and entity_reference(grounded.facts["near"].value)
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
        comparison_only = result.domains == [AgentName.PROPERTY] and is_housing_comparison(
            AgentName.PROPERTY, result.constraints.values
        )
        if comparison_only:
            # A read-only comparison cannot renew a booking intent from a past
            # turn. A fresh, grounded transaction request is still disclosed.
            commit_requested = [
                kind
                for kind in commit_requested
                if (fact := grounded.facts.get(commit_fact_key(kind)))
                and fact.evidence.strip()
                and fact.evidence.casefold() in latest_text.casefold()
            ]
            if previous is not None and not commit_requested:
                result = result.model_copy(
                    update={"kind": RequestKind.REFINE, "target_task_ids": [], "change_request": None}
                )
        unsupported = [kind for kind in commit_requested if kind not in supported_actions]
        # A disabled transaction is not a conflict in otherwise valid read
        # tasks. Retain its intent separately and explain it to the user;
        # only enabled actions may reach planning/approval.
        commit_requested = [kind for kind in commit_requested if kind in supported_actions]
        # Preserve the user's spelling. Location/Flight resolve it against real catalogs;
        # an unresolved abbreviation must not block unrelated requested domains.
        facts = dict(grounded.facts)
        values = dict(result.constraints.values)
        # This structured form is supplied by the user, never authored by Intake/Planner.
        values.pop("moving_options", None)
        facts.pop("moving_options", None)
        if previous is not None and result.kind != RequestKind.NEW_GOAL:
            # Gộp dần qua các lượt: ràng buộc đã nói ở lượt trước vẫn giữ, giá trị mới thắng.
            carried = {k: v for k, v in previous.constraints.values.items() if k not in previous.prefilled}
            for key in cleared_filters:
                carried.pop(key, None)
            values = {**carried, **values}
        if fresh_housing_scope and "city" not in result.user_confirmed_facts:
            values.pop("city", None)
            facts.pop("city", None)
        if (
            AgentName.PROPERTY in result.domains
            and is_housing_comparison(AgentName.PROPERTY, values)
            and "listing_ids" not in result.user_confirmed_facts
        ):
            # Old IDs are context, not authorization to choose which homes the
            # new comparison means. Intake must ground that set for this turn.
            values.pop("listing_ids", None)
            facts.pop("listing_ids", None)
        if state.get("moving_options") is not None and AgentName.RELOCATION in result.domains:
            values["moving_options"] = state["moving_options"]
        if entity_reference(values.get("near")):
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
            for key in ("district", "near", "near_coordinate", "near_place_id", "bounding_box"):
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
        selected_home = facts.get("selected:property") or (
            previous.user_confirmed_facts.get("selected:property") if previous else None
        )
        for key in ("origin", "destination"):
            if entity_reference(values.get(key)) == "selected:property":
                # "bay vào đó" after choosing a home: the city is the chosen home's city as the provider
                # recorded it. Without that record the reference is dropped and Flight asks for the city.
                home = next(
                    (
                        c
                        for r in (state.get("task_results") or {}).values()
                        if r.agent == AgentName.PROPERTY
                        for c in r.data.get("candidates", [])
                        if selected_home and c.get("id") == str(selected_home.value)
                    ),
                    None,
                )
                if home and home.get("city"):
                    values[key] = home["city"]
                    if key in facts:
                        facts[key] = facts[key].model_copy(update={"value": home["city"]})
                else:
                    values.pop(key, None)
                    facts.pop(key, None)
        housing_pin = state.get("housing_location")
        if "near" in cleared_filters:
            housing_pin = None
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
                    facts[address_key] = ConfirmedFact(value=pin["address"], evidence=pin["address"], stated_at=now)
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
        # Vé khứ hồi: ngày về trước ngày đi là mâu thuẫn; hỏi lại, không tự sửa (payment-design D12).
        if values.get("return_date") and values.get("flight_date") and values["return_date"] < values["flight_date"]:
            result.conflicts.append(
                f"Ngày về ({values['return_date']}) đang trước ngày đi ({values['flight_date']}). Bạn muốn bay về ngày nào?"
            )
            values.pop("return_date", None)
            facts.pop("return_date", None)
        # Ứng viên địa điểm người dùng bấm chọn trên bản đồ: API đã đối chiếu với Location.
        for key in PLACE_CHOICE_FIELDS:
            if key in result.user_confirmed_facts and not (choice and choice["field"] == key):
                values.pop(key + "_place_id", None)
        if choice:
            values[choice_field] = choice["name"]
            values[choice_field + "_place_id"] = choice["place_id"]
            facts[choice_field] = ConfirmedFact(value=choice["name"], evidence=choice["name"], stated_at=now)
            if choice["field"] == "near":
                values.pop("near_coordinate", None)
                values.pop("bounding_box", None)
        viewing_selection = chat_housing_selection(deps, state, facts, values, result)
        prefill_exclusions = (
            set(previous.housing_prefill_exclusions)
            if previous is not None and result.kind != RequestKind.NEW_GOAL
            else set()
        )
        prefill_exclusions.update(cleared_filters)
        if fresh_housing_scope and "city" not in result.user_confirmed_facts:
            # A fresh named area must resolve its own parent city. Removing the
            # old city above is pointless if account memory immediately restores it.
            prefill_exclusions.add("city")
        # Only newly grounded facts or API-verified scope choices can reopen a
        # field. Carrying old facts/memory cannot undo an explicit removal.
        prefill_exclusions.difference_update(
            key
            for key, fact in result.user_confirmed_facts.items()
            if key not in grounded.dropped and facts.get(key) == fact
        )
        if choice:
            prefill_exclusions.discard(choice_field)
        if housing_pin and housing_pin.get("confirmed") is True:
            prefill_exclusions.discard("near")
        if cleared_filters.intersection({"near", "district"}) and not any(
            values.get(key) for key in ("city", "district", "near", "bounding_box")
        ):
            # Removing the final scope asks for a new area, not an unrelated
            # remembered city/district as a substitute for the removed landmark.
            prefill_exclusions.update({"city", "district", "near"})
        result = result.model_copy(
            update={
                "constraints": result.constraints.model_copy(update={"values": values}),
                "user_confirmed_facts": facts,
                "commit_requested": commit_requested,
                "unavailable_commit_requested": unsupported,
                "conflicts": list(dict.fromkeys([*result.conflicts, *grounded.conflicts])),
                "declined_suggestions": [k for k in result.declined_suggestions if k in suggestion_keys],
                "retrieval_only": result.retrieval_only and not grounded.dropped,
                "housing_prefill_exclusions": sorted(prefill_exclusions),
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
        if viewing_selection is not None:
            update["housing_selection"] = viewing_selection
            update["housing_selection_changed"] = True
            if selection_only_turn(state.get("intake"), result):
                # Chỉ thêm/bỏ căn đang xem: không lập kế hoạch lại hay tìm lại (nhanh, không đổi kết quả).
                update["outcome"] = Outcome(node="intake", code=OutcomeCode.ANSWER)
                return update
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
