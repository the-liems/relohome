"""LLM-first planning/replanning at domain level; no tool execution or graph wiring."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field
from relohome_agent.agents.contracts import AgentCapability
from relohome_agent.agents.housing_constraints import HOUSING_INPUT_KEYS
from relohome_agent.agents.housing_fast_path import filter_followup_task, is_filter_search
from relohome_agent.agents.housing_operations import is_housing_comparison, same_housing_operation
from relohome_agent.agents.intake import missing_for, selected_fact_key
from relohome_agent.agents.llm import LLMError, StructuredLLM
from relohome_agent.agents.llm_context import result_context
from relohome_agent.agents.llm_runtime import MAX_REPAIR_CALLS, Invocation, UsageOwner, json_object, public_data
from relohome_agent.agents.models import AgentName, CommitAction, CommitActionKind, Plan, Question, RequestKind, Task
from relohome_agent.agents.planning import (
    COMMIT_DOMAIN,
    PII_REQUIRED,
    PlannerInput,
    PlannerOutput,
    TemplatePlanner,
    validate_plan,
)
from relohome_agent.agents.task_prompts import planner_prompt


class TaskDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    agent: AgentName
    inputs_json: str
    depends_on: list[str]
    required: bool


class ActionDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: CommitActionKind
    source_task_id: str
    target_receipt_id: str | None


class NeedsInputDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")
    domain: AgentName
    field: str = Field(description="Input key of that domain's capability, e.g. to_address or route_to.")
    question: str = Field(description="One short Vietnamese question asking the user for a usable value.")


class PlanDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tasks: list[TaskDraft]
    actions: list[ActionDraft]
    needs_input: list[NeedsInputDraft] = Field(
        default_factory=list,
        description="Requested domains you deliberately do not plan because a present input is not usable yet.",
    )


class CapabilityRegistry:
    """Only manifests. Constructing a planner never instantiates providers or fake agents."""

    def __init__(self, capabilities: Mapping[AgentName, AgentCapability]):
        self.capabilities = dict(capabilities)

    def capability(self, name):
        return self.capabilities.get(name)

    def commit_kinds(self, name):
        cap = self.capability(name)
        return cap.commit_kinds if cap else []


class LlmPlanner(UsageOwner):
    supports_zero_call_plans = True  # Invocation.reserve still enforces the budget before any generation.

    def __init__(self, llm: StructuredLLM, capabilities: Mapping[AgentName, AgentCapability], *, max_calls: int = 5):
        super().__init__()
        if max_calls < 1:
            raise ValueError("max_calls must be positive")
        self.llm, self.registry, self.max_calls = (
            llm,
            CapabilityRegistry(capabilities),
            min(MAX_REPAIR_CALLS, max_calls),
        )

    async def plan(self, inp: PlannerInput) -> PlannerOutput:
        run = Invocation(max_calls=self.max_calls)
        self._usage.set(run.usage)
        if inp.intake.kind == RequestKind.UNSUPPORTED or inp.intake.needs_clarification:
            return PlannerOutput(plan=Plan(version=0, tasks=[]))
        available = {n: cap for n, cap in self.registry.capabilities.items() if n in inp.available_agents}
        registry = CapabilityRegistry(available)
        followup = filter_followup_task(inp)
        new_search = (
            is_filter_search(inp.intake)
            and not inp.previous_plan
            and not inp.previous_results
            and not inp.committed
            and inp.validation is None
            and inp.change_context is None
        )
        if new_search or followup is not None:
            inputs, _ = TemplatePlanner._inputs(AgentName.PROPERTY, inp.intake.constraints.values, inp.intake)
            candidate = Plan(
                version=0,
                tasks=[
                    Task(
                        id=followup.id if followup else "housing-search-" + uuid4().hex,
                        agent=AgentName.PROPERTY,
                        inputs=inputs,
                    )
                ],
            )
            # Exactly the same contract/grounding gates as a model-authored plan.
            if not validate_plan(
                candidate, registry, inp.intake, inp.committed, inp.previous_plan
            ) and not self._grounding_errors(candidate, inp):
                return PlannerOutput(plan=candidate, retrieval_only_task_ids=[candidate.tasks[0].id])
        if run.max_calls <= 0:
            raise LLMError("LLM_BUDGET", "Đã hết lượt gọi LLM cho yêu cầu.")
        data = inp.model_dump(mode="json", exclude={"session"})
        blocked = set(inp.intake.blocking_missing + inp.intake.constraints.missing)
        data["ready_requested_domains"] = [
            domain.value
            for domain in inp.intake.domains
            if domain in available
            and not missing_for(
                domain, inp.intake.constraints.values, set(inp.intake.domains), inp.intake.user_confirmed_facts
            )
            and not any(field.startswith(domain.value + ".") for field in blocked)
        ]
        # Only requested and carried domains can appear in a valid plan. Keep the
        # full registry for validation, not unrelated service schemas in the prompt.
        relevant = set(inp.intake.domains)
        if inp.previous_plan:
            relevant.update(t.agent for t in inp.previous_plan.tasks)
        data["available_agents"] = [name for name in data["available_agents"] if name in relevant]
        data["available_capabilities"] = {
            n.value: cap.model_dump(mode="json", exclude={"output_schema"})
            for n, cap in available.items()
            if n in relevant
        }
        values = inp.intake.constraints.values
        data["confirmed_location_bindings"] = {
            address: {"address": values[address], "coordinate": values[coordinate]}
            for address, coordinate in (("from_address", "pickup_coordinate"), ("to_address", "destination_coordinate"))
            if values.get(address) and values.get(coordinate)
        }
        selected = inp.intake.user_confirmed_facts.get(selected_fact_key(AgentName.PROPERTY))
        if AgentName.MAP in inp.intake.domains and inp.intake.constraints.values.get("map_mode") != "route":
            data["map_origin_binding"] = {
                "kind": "explicit_near"
                if inp.intake.constraints.values.get("map_near")
                else "selected_property"
                if selected
                else (
                    "explicit_near"
                    if inp.intake.constraints.values.get("map_near") or inp.intake.constraints.values.get("near")
                    else "upstream_property"
                ),
                "selected_listing_id": selected.value if selected else None,
                "near": inp.intake.constraints.values.get("map_near") or inp.intake.constraints.values.get("near"),
            }
        data["previous_results"] = {k: result_context(r) for k, r in inp.previous_results.items()}
        errors = ["LLM budget exhausted"]
        for attempt in range(run.max_calls):
            try:
                draft = await run.parse(self.llm, planner_prompt(relevant), data, PlanDraft)
            except LLMError as exc:
                if (
                    exc.code not in {"LLM_NO_RESULT", "LLM_INVALID_OUTPUT", "LLM_TIMEOUT", "LLM_CONNECTION_ERROR"}
                    or attempt + 1 >= run.max_calls
                ):
                    raise
                data["validation_feedback"] = [
                    "Previous call did not produce a valid structured plan; return the required schema."
                ]
                continue
            try:
                plan = self._convert(draft, inp)
                questions, deferral_errors = self._deferrals(draft, plan, inp, registry)
                deferred = {AgentName(q.field.split(".", 1)[0]) for q in questions}
                errors = validate_plan(plan, registry, inp.intake, inp.committed, inp.previous_plan)
                errors += deferral_errors + self._grounding_errors(plan, inp, deferred)
            except (ValueError, TypeError) as exc:
                errors = [f"Plan conversion invalid ({type(exc).__name__})."]
            if not errors:
                return PlannerOutput(plan=plan, questions=questions)
            if attempt + 1 < run.max_calls:
                data["validation_feedback"] = errors[:10]
                data["rejected_plan"] = draft.model_dump(mode="json")
        raise LLMError("PLAN_INVALID", "Kế hoạch LLM không đạt contract sau khi sửa: " + "; ".join(errors[:5]))

    def _convert(self, draft: PlanDraft, inp: PlannerInput) -> Plan:
        if len(draft.tasks) > 12 or len(draft.actions) > 12:
            raise ValueError("Plan too large")
        tasks = [
            Task(
                id=t.id, agent=t.agent, inputs=json_object(t.inputs_json), depends_on=t.depends_on, required=t.required
            )
            for t in draft.tasks
        ]
        values = inp.intake.constraints.values
        selected = inp.intake.user_confirmed_facts.get(selected_fact_key(AgentName.PROPERTY))
        if inp.previous_plan and inp.intake.kind != RequestKind.NEW_GOAL:
            # A requested domain the model left out keeps its completed task (e.g. the flight found last
            # turn while this turn adds moving), but only while its inputs still equal what the current
            # constraints imply; otherwise the model must plan it again.
            for domain in inp.intake.domains:
                if any(t.agent == domain for t in tasks):
                    continue
                expected, _ = TemplatePlanner._inputs(domain, values, inp.intake)
                for old_task in inp.previous_plan.tasks:
                    old_result = inp.previous_results.get(old_task.id)
                    if (
                        old_task.agent == domain
                        and expected is not None
                        and old_task.inputs == expected
                        and not old_task.depends_on
                        and old_result is not None
                        and old_result.status == "done"
                        and all(t.id != old_task.id for t in tasks)
                    ):
                        tasks.insert(0, old_task.model_copy(deep=True))
                        break
        agents_by_id = {t.id: t.agent for t in tasks}
        for task in tasks:
            if (
                task.agent == AgentName.PROPERTY
                and inp.previous_plan
                and task == inp.previous_plan.task(task.id)
                and not same_housing_operation(task.agent, task.inputs, values)
            ):
                continue  # Do not inject the comparison's scope into a carried search (or vice versa).
            if (
                task.agent == AgentName.MAP
                and task.inputs.get("map_mode", "nearby") != "route"
                and any(agents_by_id.get(d) == AgentName.PROPERTY for d in task.depends_on)
            ):
                # A dependency on Housing means "around the homes found": origins come from upstream
                # results, so a named anchor written next to it would contradict the edge.
                for key in ("near", "near_place_id", "near_coordinate"):
                    task.inputs.pop(key, None)
            if task.agent in inp.intake.domains and task.agent in {AgentName.PROPERTY, AgentName.MAP}:
                # Map view and chosen place IDs come from API-validated state only; a model can
                # neither invent them nor carry one to an endpoint the user has since renamed.
                if task.agent == AgentName.PROPERTY:
                    if values.get("bounding_box"):
                        task.inputs["bounding_box"] = dict(values["bounding_box"])
                    else:
                        task.inputs.pop("bounding_box", None)
                fields = (
                    ("near",)
                    if task.agent == AgentName.PROPERTY or task.inputs.get("map_mode", "nearby") != "route"
                    else ("route_from", "route_to")
                )
                for field in fields:
                    source_field = "map_near" if task.agent == AgentName.MAP and field == "near" else field
                    place_id = values.get(source_field + "_place_id")
                    if place_id:
                        # Typed API choice binds its canonical name and ID together; a model-written
                        # label cannot rename it (ADR-021, SPEC-014/AC-32). When the user changes the
                        # endpoint, Intake drops the old ID, so a new text never inherits it.
                        task.inputs[field] = values[source_field]
                        task.inputs[field + "_place_id"] = place_id
                    else:
                        task.inputs.pop(field + "_place_id", None)
            if task.agent == AgentName.MAP and task.agent in inp.intake.domains:
                # The chosen listing is trusted state: a model-written ID is replaced, never trusted.
                nearby = task.inputs.get("map_mode", "nearby") != "route"
                uses_home = any(task.inputs.get(k) == "selected:property" for k in ("route_from", "route_to")) or (
                    nearby
                    and not values.get("map_near")
                    and not any(agents_by_id.get(d) == AgentName.PROPERTY for d in task.depends_on)
                )
                if selected and uses_home:
                    if nearby:
                        # A Housing search anchor is NOT the chosen house. Intake's
                        # separate map_near is the only explicit named Map anchor.
                        task.inputs.pop("near", None)
                        task.inputs.pop("near_place_id", None)
                    task.inputs["selected_listing_id"] = str(selected.value)
                elif not uses_home:
                    task.inputs.pop("selected_listing_id", None)
            if task.agent != AgentName.RELOCATION or task.agent not in inp.intake.domains:
                continue
            task.inputs.pop("moving_options", None)
            if task.inputs.get("mode") == "quote" and values.get("moving_options") is not None:
                task.inputs["moving_options"] = dict(values["moving_options"])
            # Coordinates belong to trusted state. A model cannot override them
            # or accidentally retain the old direction's coordinates.
            for address_key, coordinate_key in (
                ("from_address", "pickup_coordinate"),
                ("to_address", "destination_coordinate"),
            ):
                if not values.get(coordinate_key):
                    continue
                # A point the user confirmed on the map fixes this endpoint's address too, also
                # when the model kept the "selected:property" marker (the gate of the chosen home).
                if task.inputs.get(address_key) in (values.get(address_key), "selected:property"):
                    task.inputs[address_key] = values[address_key]
                    task.inputs[coordinate_key] = dict(values[coordinate_key])
            if selected and any(task.inputs.get(k) == "selected:property" for k in ("from_address", "to_address")):
                task.inputs["selected_listing_id"] = str(selected.value)  # trusted state wins over the draft
            elif not any(task.inputs.get(k) == "selected:property" for k in ("from_address", "to_address")):
                task.inputs.pop("selected_listing_id", None)
        actions = [
            CommitAction(
                id=f"{a.kind.value}:{a.source_task_id}",
                kind=a.kind,
                source_task_id=a.source_task_id,
                target_receipt_id=a.target_receipt_id,
                requires_payment=a.kind == CommitActionKind.FLIGHT_BOOKING,
                pii_required=PII_REQUIRED.get(a.kind, []),
            )
            for a in draft.actions
        ]
        return Plan(version=0, tasks=tasks, commit_actions=actions)

    @staticmethod
    def _deferrals(
        draft: PlanDraft, plan: Plan, inp: PlannerInput, registry: CapabilityRegistry
    ) -> tuple[list[Question], list[str]]:
        """Code-checked deferrals: only a requested domain, only a real input key of its manifest,
        and never together with a new task of that domain."""
        old = {t.id: t for t in inp.previous_plan.tasks} if inp.previous_plan else {}
        questions, errors = [], []
        for item in draft.needs_input[:5]:
            capability = registry.capability(item.domain)
            key = item.field.split(".", 1)[-1]
            text = public_data(item.question.strip())[:300]
            if item.domain not in inp.intake.domains or capability is None:
                errors.append(f"needs_input {item.domain.value}: domain not requested or unavailable")
            elif key not in (capability.input_schema.get("properties") or {}):
                errors.append(f"needs_input {item.domain.value}.{key}: not an input of this domain")
            elif not text:
                errors.append(f"needs_input {item.domain.value}.{key}: empty question")
            elif item.domain == AgentName.RELOCATION and inp.intake.constraints.values.get(
                {"from_address": "pickup_coordinate", "to_address": "destination_coordinate"}.get(key, "")
            ):
                errors.append(
                    f"needs_input {item.domain.value}.{key}: endpoint already has a confirmed map coordinate; plan the task"
                )
            elif any(t.agent == item.domain and t != old.get(t.id) for t in plan.tasks):
                errors.append(f"needs_input {item.domain.value}: domain also has a new task")
            else:
                questions.append(Question(field=f"{item.domain.value}.{key}", text=text))
        return questions, errors

    @staticmethod
    def _grounding_errors(plan: Plan, inp: PlannerInput, deferred: set[AgentName] = frozenset()) -> list[str]:
        errors = []
        values = inp.intake.constraints.values
        old = (
            {t.id: t for t in inp.previous_plan.tasks}
            if inp.previous_plan and inp.intake.kind != RequestKind.NEW_GOAL
            else {}
        )
        category_key = "map_categories" if "map_categories" in values else "nearby_categories"
        radius_key = "map_radius_m" if "map_radius_m" in values else "nearby_radius_m"
        aliases = {"date": "flight_date", "categories": category_key, "radius_m": radius_key}
        defaults: dict[str, Any] = {
            "map_mode": "nearby",
            "categories": ["hospital", "marketplace", "pharmacy"],
            "radius_m": 1500,
            "passengers": {"adults": 1},
        }
        blocked = set(inp.intake.blocking_missing + inp.intake.constraints.missing)
        planned = {t.agent for t in plan.tasks}
        plan_agents = {t.id: t.agent for t in plan.tasks}
        plan_ids = set(plan_agents)
        requested_map_mode = values.get("map_mode", "nearby")
        if (
            AgentName.PROPERTY in inp.intake.domains
            and AgentName.PROPERTY not in deferred
            and is_housing_comparison(AgentName.PROPERTY, values)
            and not any(is_housing_comparison(t.agent, t.inputs) for t in plan.tasks)
        ):
            errors.append("Missing requested Housing comparison task")
        if (
            AgentName.MAP in inp.intake.domains
            and AgentName.MAP not in deferred
            and not any(
                t.agent == AgentName.MAP and t.inputs.get("map_mode", "nearby") == requested_map_mode
                for t in plan.tasks
            )
        ):
            errors.append(f"Missing requested Map task mode: {requested_map_mode}")
        for domain in inp.intake.domains:
            if (
                domain in inp.available_agents
                and not missing_for(domain, values, set(inp.intake.domains), inp.intake.user_confirmed_facts)
                and not any(m.startswith(domain.value + ".") for m in blocked)
                and domain not in planned
                and domain not in deferred
            ):
                errors.append(f"Missing runnable requested domain: {domain.value}")
        for task in plan.tasks:
            if inp.intake.kind == RequestKind.NEW_GOAL and task.id in inp.reserved_task_ids:
                errors.append(f"{task.id}: new goal must use a fresh task ID, not overwrite history")
            carried_unrequested = task.agent not in inp.intake.domains and task == old.get(task.id)
            carried_other_map_mode = (
                task.agent == AgentName.MAP
                and task == old.get(task.id)
                and task.inputs.get("map_mode", "nearby") != requested_map_mode
            )
            carried_other_housing_mode = (
                task.agent == AgentName.PROPERTY
                and task == old.get(task.id)
                and not same_housing_operation(task.agent, task.inputs, values)
            )
            carried_context = carried_unrequested or carried_other_map_mode or carried_other_housing_mode
            if task.agent not in inp.intake.domains and task != old.get(task.id):
                errors.append(f"{task.id}: domain not requested")
            mappings = {
                AgentName.ROOMMATE: {"roommate_criteria": "roommate_criteria"},
                AgentName.PAYMENT: {"payment_id": "payment_id"},
                AgentName.PROPERTY: {k: k for k in HOUSING_INPUT_KEYS},
                AgentName.FLIGHT: {
                    "origin": "origin",
                    "destination": "destination",
                    "flight_date": "date",
                    "trip_type": "trip_type",
                    "return_date": "return_date",
                    "passengers": "passengers",
                },
                AgentName.MAP: (
                    {k: k for k in ("map_mode", "route_from", "route_to", "city", "route_profile")}
                    if task.inputs.get("map_mode") == "route"
                    else {category_key: "categories", radius_key: "radius_m"}
                ),
                AgentName.RELOCATION: {
                    k: k
                    for k in (
                        "from_address",
                        "to_address",
                        "move_date",
                        "move_time",
                        "order_id",
                        "tracking_number",
                        "volume",
                        "pickup_coordinate",
                        "destination_coordinate",
                    )
                },
            }
            if task.agent == AgentName.RELOCATION and task.inputs.get("mode") == "catalog":
                mappings[AgentName.RELOCATION] = {}
            # A Map task bound to Housing results by depends_on takes its origins from upstream.
            binds_upstream = task.agent == AgentName.MAP and any(
                d in plan_ids and plan_agents[d] == AgentName.PROPERTY for d in task.depends_on
            )
            if task.agent == AgentName.MAP:
                if task.inputs.get("map_mode") == "route" and values.get("map_city"):
                    mappings[AgentName.MAP]["map_city"] = mappings[AgentName.MAP].pop("city")
                elif values.get("map_near") and task.inputs.get("map_mode", "nearby") != "route" and not binds_upstream:
                    # map_near is the anchor of a nearby search only; a route task never carries it.
                    mappings[AgentName.MAP]["map_near"] = "near"
            if not carried_context:
                if task.agent == AgentName.MAP:
                    selected = inp.intake.user_confirmed_facts.get(selected_fact_key(AgentName.PROPERTY))
                    selected_route = any(values.get(k) == "selected:property" for k in ("route_from", "route_to"))
                    if selected and (
                        selected_route if values.get("map_mode") == "route" else not task.inputs.get("near")
                    ):
                        if task.inputs.get("selected_listing_id") != selected.value:
                            errors.append(f"{task.id}: preserve the selected housing ID")
                for source_key, target_key in mappings[task.agent].items():
                    if (
                        source_key in values
                        and source_key not in inp.intake.prefilled
                        and target_key not in task.inputs
                    ):
                        errors.append(f"{task.id}: omitted user constraint {source_key}")
            for key, value in task.inputs.items():
                source_key = aliases.get(key, key)
                expected = values.get(source_key)
                if task.agent == AgentName.MAP and key == "near_place_id" and values.get("map_near"):
                    expected = values.get("map_near_place_id")
                if task.agent == AgentName.MAP and key == "near" and values.get("map_near"):
                    expected = values["map_near"]
                if task.agent == AgentName.MAP and key == "city" and values.get("map_city"):
                    expected = values["map_city"]
                if key == "mode":
                    expected = values.get("moving_mode") or (
                        "order_status" if values.get("order_id") or values.get("tracking_number") else "quote"
                    )
                elif key == "passengers":
                    expected = {"adults": values.get("passengers", values.get("household_size", 1))}
                elif key == "selected_listing_id":
                    fact = inp.intake.user_confirmed_facts.get(selected_fact_key(AgentName.PROPERTY))
                    expected = fact.value if fact else None
                elif key == "soft_filters":
                    expected = (
                        {k: p.value for k, p in inp.intake.prefilled.items() if k in value}
                        if isinstance(value, dict)
                        else None
                    )
                elif expected is None and key in defaults:
                    expected = defaults[key]
                elif expected is None and task.agent == AgentName.PROPERTY and key == "housing_mode":
                    # Omitting the operation and explicitly saying "search" are
                    # equivalent. Never default compare/search_compare or filters.
                    expected = "search"
                if value != expected and not carried_context:
                    errors.append(f"{task.id}.{key}: not grounded in user constraints")
            if task.agent in {AgentName.MAP, AgentName.FLIGHT, AgentName.RELOCATION}:
                derived = (
                    task.agent == AgentName.MAP
                    and not task.inputs.get("near")
                    and not task.inputs.get("selected_listing_id")
                    and task.inputs.get("map_mode") != "route"
                ) or (
                    task.agent == AgentName.FLIGHT
                    and not task.inputs.get("destination")
                    and not task.inputs.get("booking_ref")
                )
                if derived and not any(
                    plan.task(d) and plan.task(d).agent == AgentName.PROPERTY for d in task.depends_on
                ):
                    errors.append(f"{task.id}: missing property dependency")
            same = next((t for t in old.values() if t.agent == task.agent and t.inputs == task.inputs), None)
            siblings = [
                t
                for t in old.values()
                if t.agent == task.agent and same_housing_operation(task.agent, t.inputs, task.inputs)
            ]
            matching_operations = sum(
                t.agent == task.agent and same_housing_operation(task.agent, t.inputs, task.inputs) for t in plan.tasks
            )
            if same is None and len(siblings) == 1 and matching_operations == 1:
                same = siblings[0]
            if same and same.id != task.id:
                errors.append(f"{task.id}: preserve previous task id {same.id}")
            prior_result = inp.previous_results.get(task.id)
            if (
                task.agent == AgentName.PROPERTY
                and prior_result is not None
                and bool(prior_result.data.get("comparison")) != is_housing_comparison(task.agent, task.inputs)
            ):
                errors.append(f"{task.id}: comparison and search must use separate task IDs")
        allowed_targets = {str(values[k]) for k in ("order_id", "booking_ref") if values.get(k)}
        allowed_targets |= {r.receipt_id for r in inp.committed.values()}
        for kind in inp.intake.commit_requested:
            if (
                kind in {CommitActionKind.MOVING_BOOKING, CommitActionKind.FLIGHT_BOOKING}
                and any(t.agent in COMMIT_DOMAIN[kind] for t in plan.tasks)
                and not any(r.kind == kind for r in inp.committed.values())
                and not any(a.kind == kind for a in plan.commit_actions)
            ):
                errors.append(f"Missing requested action intent: {kind.value}; adding it is not approval or execution")
        for action in plan.commit_actions:
            source = plan.task(action.source_task_id)
            if source and source.agent not in COMMIT_DOMAIN.get(action.kind, ()):
                errors.append(f"{action.id}: wrong domain for action")
            if action.target_receipt_id and action.target_receipt_id not in allowed_targets:
                errors.append(f"{action.id}: unknown target; resolve tracking reference first")
        return errors
