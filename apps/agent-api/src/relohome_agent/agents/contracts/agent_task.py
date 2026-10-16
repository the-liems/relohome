"""Contract giữa graph và subagent của từng service (agent-graph.md §6.3).

Đây là nguồn schema chính. `export_schema.py` xuất JSON Schema ra `docs/api/agent-contract/` cho
service viết bằng ngôn ngữ khác. Người viết subagent làm theo quy tắc R1–R12 (§6.3.4).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, model_validator
from relohome_agent.agents.common import utcnow
from relohome_agent.agents.models import (
    AgentBudget,
    AgentError,
    AgentName,
    AgentUsage,
    CommitActionKind,
    CostTier,
    Question,
    Quote,
    SourceKind,
)

CONTRACT_VERSION = "1.1"


def contract_major(version: str) -> str:
    return version.split(".", 1)[0]


class AgentCapability(BaseModel):
    agent: AgentName
    input_schema: dict[str, Any]  # JSON Schema của task.inputs
    output_schema: dict[str, Any]  # JSON Schema của data (validator V4)
    required_fields: list[str]  # validator V2; "candidates[].price_vnd" = mọi phần tử phải có
    stale_ttl_s: int  # validator V3
    cost_tier: CostTier
    uses_llm: bool = False
    default_budget: AgentBudget
    constraint_keys: list[str] = []  # constraint nào của người dùng subagent được nhận
    hint_keys: list[str] = []  # gợi ý xếp hạng nào subagent được nhận
    commit_kinds: list[CommitActionKind] = []  # thao tác ghi service hỗ trợ qua commit endpoint (§6.9)


class AgentManifest(BaseModel):
    name: str
    owner: str
    contract_version: str = CONTRACT_VERSION
    capabilities: list[AgentCapability]


class UpstreamResult(BaseModel):
    task_id: str
    agent: AgentName
    data: dict[str, Any]
    source_refs: list[str] = []


class AgentTaskRequest(BaseModel):
    contract_version: str = CONTRACT_VERSION
    request_id: str
    thread_id: str  # chỉ để log / trace; subagent không giữ state theo thread (R8)
    task_id: str
    plan_version: int
    attempt: int
    agent: AgentName
    inputs: dict[str, Any]
    goal: str = ""  # semantic mission; not permission to change validated inputs
    user_request: str = ""  # latest user turn, bounded/redacted before delivery
    constraints: dict[str, Any] = {}
    retrieval_only: bool = False  # trusted graph hint; only unchanged read filters, never a write
    hints: dict[str, Any] = {}
    upstream: dict[str, UpstreamResult] = {}
    budget: AgentBudget
    locale: str = "vi-VN"


class AgentTaskResult(BaseModel):
    contract_version: str = CONTRACT_VERSION
    task_id: str
    plan_version: int
    status: Literal["done", "failed", "needs_input"]
    data: dict[str, Any] = {}
    quotes: list[Quote] = []
    missing_fields: list[str] = []
    questions: list[Question] = []
    source: str
    source_kind: SourceKind
    source_refs: list[str] = []
    fetched_at: datetime
    summary: str | None = None
    usage: AgentUsage = AgentUsage()
    error: AgentError | None = None

    @model_validator(mode="after")
    def _status_rules(self):
        if self.status == "failed" and self.error is None:
            raise ValueError("error is required when status == failed")
        if self.status == "needs_input" and not self.questions:
            raise ValueError("questions are required when status == needs_input")
        return self


def failed_result(
    req: AgentTaskRequest,
    code: str,
    message: str,
    retryable: bool,
    source: str = "",
    source_kind: SourceKind = "fake",
    usage: AgentUsage | None = None,
) -> AgentTaskResult:
    """Kết quả `failed` hợp lệ theo contract (dùng khi subagent hoặc wrapper gặp lỗi)."""
    return AgentTaskResult(
        task_id=req.task_id,
        plan_version=req.plan_version,
        status="failed",
        source=source or "graph",
        source_kind=source_kind,
        fetched_at=utcnow(),
        usage=usage or AgentUsage(),
        error=AgentError(code=code, message=message, retryable=retryable),
    )


def reject_unsupported(req: AgentTaskRequest, source: str, source_kind: SourceKind) -> AgentTaskResult | None:
    """R12: request khác major `contract_version` thì trả `failed` / `unsupported_contract`."""
    if contract_major(req.contract_version) == contract_major(CONTRACT_VERSION):
        return None
    return failed_result(
        req, "unsupported_contract", f"contract {req.contract_version} is not supported", False, source, source_kind
    )
