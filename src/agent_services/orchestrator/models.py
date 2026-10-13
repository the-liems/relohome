from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from pydantic import AwareDatetime, Field, model_validator
from relohome_agent_services.common import Model, now
from relohome_agent_services.intake_models import IntakeResult


class InputReference(Model):
    argument: str = Field(pattern=r"^[a-zA-Z_][a-zA-Z0-9_]*$")
    task_id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,64}$")
    pointer: str = Field(max_length=500, description="RFC 6901 JSON pointer into the validated result")


class PlanTask(Model):
    task_id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,64}$")
    service: str = Field(min_length=1, max_length=100)
    tool: str = Field(min_length=1, max_length=100)
    purpose: str = Field(min_length=1, max_length=1000)
    # JSON encoded object keeps model structured output strict even for heterogeneous tools.
    arguments_json: str = Field(max_length=32000)
    input_refs: list[InputReference] = Field(max_length=32)
    depends_on: list[str] = Field(max_length=32)


class PlanDraft(Model):
    summary: str = Field(min_length=1, max_length=2000)
    tasks: list[PlanTask] = Field(max_length=32)
    clarification_questions: list[str] = Field(max_length=8)
    unsupported_requests: list[str] = Field(max_length=16)


class PlanRequest(Model):
    intake: IntakeResult
    # Caller supplies verified identity; this API is internal, never directly exposed to browsers.
    owner_id: str = Field(min_length=1, max_length=128)


class Revision(Model):
    expected_revision: int = Field(ge=1)


class ReplanRequest(Revision):
    intake: IntakeResult


class ApprovalRequest(Revision):
    approval_id: UUID
    actor_id: str = Field(min_length=1, max_length=128)
    payload_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    expires_at: AwareDatetime

    @model_validator(mode="after")
    def future_expiry(self):
        if self.expires_at <= now():
            raise ValueError("Approval already expired")
        return self


class TaskApproval(Model):
    approval_id: UUID
    actor_id: str
    payload_hash: str
    plan_version: int
    expires_at: AwareDatetime


TaskStatus = Literal[
    "pending",
    "ready",
    "waiting_approval",
    "blocked_input",
    "blocked_integration",
    "running",
    "succeeded",
    "failed",
    "retry_wait",
    "needs_reconciliation",
    "cancelled",
]


class TaskState(Model):
    task: PlanTask
    mode: Literal["read", "write"]
    status: TaskStatus = "pending"
    attempts: int = 0
    idempotency_key: str
    approval: TaskApproval | None = None
    resolved_arguments: dict[str, Any] | None = None
    payload_hash: str | None = None
    result: dict[str, Any] | None = None
    result_source: str | None = None
    result_observed_at: AwareDatetime | None = None
    result_expires_at: AwareDatetime | None = None
    error_code: str | None = None
    lease_id: UUID | None = None
    lease_expires_at: AwareDatetime | None = None
    retry_at: AwareDatetime | None = None


class Workflow(Model):
    contract_version: Literal["1.0.0"] = "1.0.0"
    workflow_id: UUID
    owner_id: str
    session_id: str
    request_id: UUID
    request_hash: str
    revision: int = 1
    plan_version: int = 1
    registry_hash: str
    intake: IntakeResult
    plan: PlanDraft
    tasks: list[TaskState]
    status: Literal["planned", "waiting", "running", "completed", "failed", "cancelled"] = "planned"
    created_at: AwareDatetime = Field(default_factory=now)
    updated_at: AwareDatetime = Field(default_factory=now)


class ToolResult(Model):
    """Produced by a real domain adapter, never by the planning model."""

    data: dict[str, Any]
    observed_at: AwareDatetime
    expires_at: AwareDatetime | None = None
    source: str = Field(min_length=1)
