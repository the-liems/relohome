from __future__ import annotations

import asyncio
from datetime import timedelta
from uuid import UUID, uuid4

from src.agent_services.common import ServiceError, ServiceSettings, fingerprint, now
from src.agent_services.intake.models import IntakeResult
from src.agent_services.orchestrator.models import (
    ApprovalRequest,
    PlanDraft,
    PlanRequest,
    TaskApproval,
    TaskState,
    ToolResult,
    Workflow,
)
from src.agent_services.orchestrator.planner import Planner
from src.agent_services.orchestrator.registry import Registry, arguments, planning_schema, validate_json, validate_plan
from src.agent_services.orchestrator.runtime import DisconnectedGateway, ToolGateway
from src.agent_services.orchestrator.store import WorkflowStore


def resolve_pointer(value, pointer: str):
    try:
        if not pointer:
            return value
        for token in pointer[1:].split("/"):
            token = token.replace("~1", "/").replace("~0", "~")
            if isinstance(value, list):
                if not token.isascii() or not token.isdecimal() or (len(token) > 1 and token[0] == "0"):
                    raise ValueError()
                value = value[int(token)]
            else:
                value = value[token]
        return value
    except (ValueError, KeyError, TypeError, IndexError) as exc:
        raise ServiceError("MISSING_RESULT_FIELD", "A dependency did not provide the required result field.") from exc


def task_signature(task: TaskState):
    # Purpose text can change without causing a repeated provider call.
    return fingerprint(
        {
            "service": task.task.service,
            "tool": task.task.tool,
            "arguments": arguments(task.task.arguments_json),
            "refs": [r.model_dump() for r in task.task.input_refs],
            "depends_on": sorted(task.task.depends_on),
        }
    )


class Orchestrator:
    def __init__(
        self,
        settings: ServiceSettings,
        registry: Registry,
        store: WorkflowStore,
        planner: Planner,
        gateway: ToolGateway | None = None,
    ):
        self.settings, self.registry, self.store, self.planner = settings, registry, store, planner
        self.gateway = gateway or DisconnectedGateway()

    def load(self, workflow_id: UUID, owner: str, revision: int | None = None) -> Workflow:
        workflow = self.store.get(workflow_id, owner)
        if revision is not None and workflow.revision != revision:
            raise ServiceError("REVISION_CONFLICT", "Workflow changed; reload before retrying.")
        if workflow.registry_hash != self.registry.digest:
            raise ServiceError(
                "REGISTRY_CHANGED", "Workflow uses another registry version; review/migrate before execution."
            )
        return workflow

    def new_tasks(self, plan: PlanDraft) -> list[TaskState]:
        return [
            TaskState(task=t, mode=self.registry.get(t.service, t.tool).mode, idempotency_key=str(uuid4()))
            for t in plan.tasks
        ]

    async def create(self, request: PlanRequest) -> Workflow:
        digest = fingerprint(request.model_dump(mode="json"))
        old = self.store.find(request.owner_id, request.intake.session_id, request.intake.request_id)
        if old:
            if old.request_hash != digest:
                raise ServiceError("REQUEST_CONFLICT", "Request ID was already used for another payload.")
            return old
        plan = await self.planner.plan(request.intake)
        workflow = Workflow(
            workflow_id=uuid4(),
            owner_id=request.owner_id,
            session_id=request.intake.session_id,
            request_id=request.intake.request_id,
            request_hash=digest,
            registry_hash=self.registry.digest,
            intake=request.intake,
            plan=plan,
            tasks=self.new_tasks(plan),
        )
        self.refresh(workflow)
        return self.store.create(workflow)

    def refresh(self, workflow: Workflow):
        if workflow.status == "cancelled":
            return
        clock = now()
        by_id = {s.task.task_id: s for s in workflow.tasks}
        for state in workflow.tasks:
            if state.status == "running" and state.lease_expires_at and state.lease_expires_at <= clock:
                state.status = "needs_reconciliation" if state.mode == "write" else "retry_wait"
                state.error_code = "EXECUTION_LEASE_EXPIRED"
                state.retry_at = clock + timedelta(seconds=2**state.attempts)
                state.lease_id = None
            if state.status in {"running", "succeeded", "failed", "needs_reconciliation", "cancelled"}:
                continue
            state.resolved_arguments = None
            state.payload_hash = None
            if state.status == "retry_wait" and state.retry_at and state.retry_at > clock:
                continue
            if state.attempts >= self.settings.agent_max_attempts:
                state.status, state.error_code = "failed", "ATTEMPTS_EXHAUSTED"
                continue
            dependencies = [by_id[d] for d in state.task.depends_on]
            if any(d.status in {"failed", "cancelled"} for d in dependencies):
                state.status, state.error_code = "blocked_input", "DEPENDENCY_FAILED"
                continue
            if any(d.status != "succeeded" for d in dependencies):
                state.status = "pending"
                continue
            if any(d.result_expires_at and d.result_expires_at <= clock for d in dependencies):
                state.status, state.error_code, state.approval = "blocked_input", "DEPENDENCY_EXPIRED", None
                continue
            try:
                values = arguments(state.task.arguments_json)
                for ref in state.task.input_refs:
                    values[ref.argument] = resolve_pointer(by_id[ref.task_id].result, ref.pointer)
                tool = self.registry.get(state.task.service, state.task.tool)
                validate_json(values, planning_schema(tool))
                for name, source in tool.trusted_arguments.items():
                    if source == "workflow_id":
                        values[name] = str(workflow.workflow_id)
                    elif source == "action_id":
                        values[name] = state.idempotency_key
            except ServiceError as exc:
                state.status, state.error_code = "blocked_input", exc.code
                continue
            state.resolved_arguments = values
            state.payload_hash = fingerprint(
                {
                    "workflow_id": str(workflow.workflow_id),
                    "owner_id": workflow.owner_id,
                    "task_id": state.task.task_id,
                    "plan_version": workflow.plan_version,
                    "registry_hash": workflow.registry_hash,
                    "service": tool.service,
                    "tool": tool.name,
                    "arguments": values,
                    "idempotency_key": state.idempotency_key,
                    "dependencies": {d.task.task_id: fingerprint(d.result) for d in dependencies},
                }
            )
            if state.mode == "write" and not (
                state.approval
                and state.approval.plan_version == workflow.plan_version
                and state.approval.payload_hash == state.payload_hash
                and state.approval.expires_at > clock
            ):
                state.approval = None
                state.status, state.error_code = "waiting_approval", None
            elif not self.gateway.available(state.task.service):
                state.status, state.error_code = "blocked_integration", "INTEGRATION_NOT_CONNECTED"
            else:
                state.status, state.error_code = "ready", None
            if state.mode == "write" and state.approval:
                for name, source in tool.trusted_arguments.items():
                    if source == "approval_id":
                        values[name] = str(state.approval.approval_id)
                validate_json(values, tool.input_schema)
        states = [t.status for t in workflow.tasks]
        if "running" in states:
            workflow.status = "running"
        elif (
            states
            and all(s == "succeeded" for s in states)
            and not (workflow.plan.clarification_questions or workflow.plan.unsupported_requests)
        ):
            workflow.status = "completed"
        elif "needs_reconciliation" in states or "failed" in states:
            workflow.status = "failed"
        elif (
            any(
                s in {"waiting_approval", "blocked_input", "blocked_integration", "retry_wait", "cancelled"}
                for s in states
            )
            or not states
            or (
                all(s == "succeeded" for s in states)
                and (workflow.plan.clarification_questions or workflow.plan.unsupported_requests)
            )
        ):
            workflow.status = "waiting"
        else:
            workflow.status = "planned"

    def inspect(self, workflow_id: UUID, owner: str) -> Workflow:
        workflow = self.load(workflow_id, owner)
        before = workflow.model_dump_json()
        self.refresh(workflow)
        if workflow.model_dump_json() != before:
            return self.store.save(workflow, workflow.revision, "state_refreshed")
        return workflow

    def task(self, workflow: Workflow, task_id: str) -> TaskState:
        for state in workflow.tasks:
            if state.task.task_id == task_id:
                return state
        raise ServiceError("TASK_NOT_FOUND", "Task does not exist in this workflow.", 404)

    def approve(self, workflow_id: UUID, owner: str, task_id: str, request: ApprovalRequest) -> Workflow:
        workflow = self.load(workflow_id, owner, request.expected_revision)
        self.refresh(workflow)
        state = self.task(workflow, task_id)
        if workflow.status == "cancelled" or state.mode != "write" or state.status != "waiting_approval":
            raise ServiceError("NOT_APPROVABLE", "Task is not waiting for approval.")
        if request.actor_id != owner or request.payload_hash != state.payload_hash:
            raise ServiceError("APPROVAL_MISMATCH", "Approval does not match owner and current action payload.", 403)
        if not now() < request.expires_at <= now() + timedelta(minutes=30):
            raise ServiceError("APPROVAL_EXPIRY", "Approval lifetime cannot exceed 30 minutes.", 422)
        if any(t.approval and t.approval.approval_id == request.approval_id for t in workflow.tasks):
            raise ServiceError("APPROVAL_REUSED", "Approval ID was already bound to a task.")
        state.approval = TaskApproval(
            approval_id=request.approval_id,
            actor_id=request.actor_id,
            payload_hash=request.payload_hash,
            plan_version=workflow.plan_version,
            expires_at=request.expires_at,
        )
        self.refresh(workflow)
        return self.store.save(workflow, request.expected_revision, "approved")

    def reject(self, workflow_id: UUID, owner: str, task_id: str, revision: int) -> Workflow:
        workflow = self.load(workflow_id, owner, revision)
        state = self.task(workflow, task_id)
        if state.status in {"running", "succeeded", "needs_reconciliation"}:
            raise ServiceError("ACTION_ALREADY_STARTED", "Reject cannot undo a started provider action.")
        affected = {task_id}
        for _ in workflow.tasks:
            affected.update(t.task.task_id for t in workflow.tasks if affected.intersection(t.task.depends_on))
        for task in workflow.tasks:
            if task.task.task_id in affected:
                task.status, task.approval = "cancelled", None
        self.refresh(workflow)
        return self.store.save(workflow, revision, "rejected")

    def cancel(self, workflow_id: UUID, owner: str, revision: int) -> Workflow:
        workflow = self.load(workflow_id, owner, revision)
        if any(
            t.status in {"running", "needs_reconciliation"} or (t.mode == "write" and t.status == "succeeded")
            for t in workflow.tasks
        ):
            raise ServiceError(
                "EXTERNAL_ACTION_EXISTS", "Resolve started provider actions before stopping this workflow."
            )
        for task in workflow.tasks:
            if task.status != "succeeded":
                task.status, task.approval = "cancelled", None
        workflow.status = "cancelled"
        return self.store.save(workflow, revision, "cancelled")

    async def replan(self, workflow_id: UUID, owner: str, revision: int, intake: IntakeResult) -> Workflow:
        workflow = self.load(workflow_id, owner, revision)
        if intake.session_id != workflow.session_id:
            raise ServiceError("SESSION_MISMATCH", "Replan must belong to the same session.", 422)
        if workflow.status == "cancelled" or any(
            t.status in {"running", "needs_reconciliation"} for t in workflow.tasks
        ):
            raise ServiceError("REPLAN_BLOCKED", "Resolve in-flight/uncertain actions before replanning.")
        if workflow.plan_version >= self.settings.agent_max_plan_versions:
            raise ServiceError("REPLAN_LIMIT", "Workflow reached its plan revision limit.")
        plan = await self.planner.plan(intake, workflow.plan)
        return self.apply_plan(workflow, plan, intake, revision)

    def apply_plan(self, workflow: Workflow, plan: PlanDraft, intake: IntakeResult, revision: int) -> Workflow:
        validate_plan(plan, self.registry, intake.understanding.intents)
        old = {t.task.task_id: t for t in workflow.tasks}
        tasks = self.new_tasks(plan)
        unchanged = {
            t.task.task_id
            for t in tasks
            if t.task.task_id in old
            and task_signature(t) == task_signature(old[t.task.task_id])
            and old[t.task.task_id].status == "succeeded"
            and (
                old[t.task.task_id].mode == "write"
                or not old[t.task.task_id].result_expires_at
                or old[t.task.task_id].result_expires_at > now()
            )
        }
        for _ in tasks:
            unchanged = {tid for tid in unchanged if set(old[tid].task.depends_on) <= unchanged}
        if any(t.mode == "write" and t.status == "succeeded" and tid not in unchanged for tid, t in old.items()):
            raise ServiceError(
                "COMPENSATION_REQUIRED", "Changing a completed external action needs an explicit compensation workflow."
            )
        for i, task in enumerate(tasks):
            if task.task.task_id in unchanged:
                tasks[i] = old[task.task.task_id]
            # Every replan revokes approvals, even if a pending action looks unchanged.
            tasks[i].approval = None
        workflow.tasks, workflow.plan, workflow.intake = tasks, plan, intake
        workflow.plan_version += 1
        self.refresh(workflow)
        return self.store.save(workflow, revision, "replanned")

    async def advance(self, workflow_id: UUID, owner: str, revision: int) -> Workflow:
        """One bounded scheduling wave, fully owned by this orchestrator.

        No detached/background work. Persist leases before any possible side effect.
        A future MCP adapter implements the internal port; standalone mode waits.
        """
        workflow = self.load(workflow_id, owner, revision)
        self.refresh(workflow)
        if workflow.status == "cancelled":
            return workflow
        running = [t for t in workflow.tasks if t.status == "running"]
        ready = [t for t in workflow.tasks if t.status == "ready"]
        capacity = max(0, self.settings.agent_max_parallel_tasks - len(running))
        # Reads can fan out; writes run one at a time without other in-flight tasks.
        selected = (
            [t for t in ready if t.mode == "read"][:capacity] if not any(t.mode == "write" for t in running) else []
        )
        if not selected and not running:
            selected = [t for t in ready if t.mode == "write"][:1]
        for task in selected:
            task.status, task.attempts = "running", task.attempts + 1
            task.lease_id = uuid4()
            tool = self.registry.get(task.task.service, task.task.tool)
            task.lease_expires_at = now() + timedelta(
                seconds=max(self.settings.agent_task_lease_seconds, tool.timeout_seconds + 10)
            )
        self.refresh(workflow)
        workflow = self.store.save(workflow, revision, "advanced")
        if selected:
            await asyncio.gather(*(self.execute(workflow, task) for task in selected))
        return self.inspect(workflow_id, owner)

    async def execute(self, workflow: Workflow, task: TaskState):
        tool = self.registry.get(task.task.service, task.task.tool)
        result: ToolResult | None = None
        error: ServiceError | None = None
        try:
            async with asyncio.timeout(tool.timeout_seconds):
                result = await self.gateway.call(tool, task.resolved_arguments or {}, task.idempotency_key)
            validate_json(result.data, tool.output_schema, "INVALID_TOOL_RESULT")
            if (
                result.observed_at > now() + timedelta(seconds=30)
                or result.observed_at + timedelta(seconds=tool.result_ttl_seconds) <= now()
                or (result.expires_at and result.expires_at <= now())
            ):
                raise ServiceError("STALE_TOOL_RESULT", "Provider result is stale or timestamp is invalid.")
        except ServiceError as exc:
            error = exc
        except Exception:
            error = ServiceError("TOOL_UNAVAILABLE", "Domain operation failed or timed out.", 503, True)
        for _ in range(8):
            current = self.load(workflow.workflow_id, workflow.owner_id)
            target = self.task(current, task.task.task_id)
            if target.lease_id != task.lease_id or target.status != "running":
                return  # An expired/superseded attempt must never overwrite the current state.
            target.lease_id, target.lease_expires_at = None, None
            if error:
                target.error_code = error.code
                if task.mode == "write":
                    # Once a write was dispatched, failure is ambiguous until reconciled.
                    target.status = "needs_reconciliation"
                elif error.retryable and target.attempts < self.settings.agent_max_attempts:
                    target.status = "retry_wait"
                    target.retry_at = now() + timedelta(seconds=2**target.attempts)
                else:
                    target.status = "failed"
            else:
                target.status, target.result = "succeeded", result.data
                target.result_source, target.result_observed_at = result.source, result.observed_at
                target.result_expires_at = min(
                    result.expires_at or now() + timedelta(seconds=tool.result_ttl_seconds),
                    result.observed_at + timedelta(seconds=tool.result_ttl_seconds),
                )
                target.error_code = None
            self.refresh(current)
            try:
                self.store.save(current, current.revision, "task_observed")
                return
            except ServiceError as exc:
                if exc.code != "REVISION_CONFLICT":
                    raise
        raise ServiceError(
            "REVISION_CONFLICT", "Concurrent state updates prevented result persistence; reconcile the lease."
        )
