"""Dependency injection của graph (agent-graph.md §7.4, §8)."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from typing import Any, Literal

from pydantic import BaseModel, Field
from relohome_agent.agents.common import utcnow
from relohome_agent.agents.contracts import AgentCapability
from relohome_agent.agents.guardrails.shadow import ShadowGuardrail
from relohome_agent.agents.intake import Intake, PassThroughIntake
from relohome_agent.agents.models import AgentName, CommitActionKind, CostTier
from relohome_agent.agents.planning import NotImplementedPlanner, Planner
from relohome_agent.agents.subagents.base import DomainAgent
from relohome_agent.agents.subagents.fake import FakeAgent
from relohome_agent.services.adapters.fakes import (
    FakeTransaction,
    InMemoryApprovalStore,
    InMemoryPiiStore,
    InMemorySessionPort,
    InMemoryUsageMeter,
)
from relohome_agent.services.adapters.ports import ApprovalPort, PiiPort, SessionPort, TransactionPort, UsageMeter


def _default_prefill_ttl() -> dict[str, timedelta]:
    return {
        "city": timedelta(days=90),
        "near": timedelta(days=90),
        "max_price_vnd": timedelta(days=60),
        "district": timedelta(days=60),
        "room_type": timedelta(days=180),
        "must_have": timedelta(days=180),
        "household_size": timedelta(days=365),
        "has_pet": timedelta(days=365),
        "has_motorbike": timedelta(days=365),
    }


class GraphSettings(BaseModel):
    # Attempts per turn (AGENT_MAX_ATTEMPTS in live wiring): subagent task, replans, Planner/Intake repair calls.
    max_task_attempts: int = 5
    max_replans: int = 5
    max_parallel_tasks: int = 4
    recursion_limit: int = 100
    default_agent_timeout_s: float = 20.0
    # Subagent gọi 2–5 tool nối tiếp; mỗi tool Location có deadline 15 s, OSRM 10 s (phản hồi Location).
    agent_timeout_s: dict[AgentName, float] = {
        AgentName.PROPERTY: 100.0,
        AgentName.MAP: 100.0,
        AgentName.RELOCATION: 120.0,
        AgentName.FLIGHT: 100.0,
        AgentName.PAYMENT: 100.0,
    }
    agent_transport_retries: int = 4  # 5 attempts in total
    stale_ttl_override: dict[AgentName, timedelta] = {}
    approval_ttl: timedelta = timedelta(minutes=10)
    approval_max_lifetime: timedelta = timedelta(minutes=30)
    max_suggestions: int = 2
    # Giá thực tế được lệch bao nhiêu so với báo giá mà không hỏi lại (người dùng đồng ý khoảng này ở bước
    # xác nhận). Chỉ cho thao tác mà provider báo giá lại lúc đặt; loại không có ở đây phải đúng giá.
    price_tolerance: dict[CommitActionKind, float] = {}
    # Thanh toán của app đang bật (payment-design): đặt/trả tiền đi qua nút trên giao diện, không qua chat.
    app_payment: bool = False
    # Chọn nhiều căn để hẹn xem; căn của kế hoạch chỉ có sau khi chốt (housing-viewing-design).
    housing_viewing: bool = False

    # --- Kiểm soát chi phí (§7.5) ---
    llm_models: dict[Literal["light", "heavy"], str] = {"light": "gpt-6-luna", "heavy": "gpt-6-luna"}
    # Room for Intake + Planner repair calls on each replan; still a hard ceiling per turn.
    max_llm_calls_per_turn: int = 30
    max_subagent_llm_calls_per_turn: int = 40
    max_paid_calls_per_turn: int = 6
    max_paid_calls_per_thread: int = 30

    # --- Bộ nhớ người dùng (§6.0, §6.1) ---
    prefill_ttl: dict[str, timedelta] = Field(default_factory=_default_prefill_ttl)

    def timeout_for(self, agent: AgentName) -> float:
        return self.agent_timeout_s.get(agent, self.default_agent_timeout_s)

    def stale_ttl(self, capability: AgentCapability) -> timedelta:
        return self.stale_ttl_override.get(capability.agent, timedelta(seconds=capability.stale_ttl_s))


class AgentRegistry:
    """AgentName -> DomainAgent. Đây là allowlist: lĩnh vực không có ở đây thì không có node và
    `validate_plan` từ chối task của nó."""

    def __init__(self, agents: dict[AgentName, DomainAgent]):
        for name, agent in agents.items():
            if agent.capability.agent != name:
                raise ValueError(f"agent registered as {name} serves {agent.capability.agent}")
        self._agents = dict(agents)

    def names(self) -> list[AgentName]:
        return list(self._agents)

    def get(self, name: AgentName) -> DomainAgent | None:
        return self._agents.get(name)

    def capability(self, name: AgentName) -> AgentCapability | None:
        agent = self._agents.get(name)
        return agent.capability if agent else None

    def cost_tiers(self) -> dict[AgentName, CostTier]:
        return {name: a.capability.cost_tier for name, a in self._agents.items()}

    def commit_kinds(self, name: AgentName) -> list[CommitActionKind]:
        cap = self.capability(name)
        return list(cap.commit_kinds) if cap else []


@dataclass(frozen=True)
class GraphDeps:
    intake: Intake
    planner: Planner
    agents: AgentRegistry
    session: SessionPort
    transaction: TransactionPort
    approvals: ApprovalPort
    pii: PiiPort
    settings: GraphSettings
    usage: UsageMeter
    clock: Callable[[], datetime] = utcnow
    # (user_id, thread_id, task_id, listing row) -> danh sách căn đang chọn; lỗi nghiệp vụ là ValueError.
    housing_selector: Callable[[str, str, str, dict], list[dict]] | None = None
    # (user_id, thread_id, listing_id) -> danh sách căn đang chọn sau khi bỏ; lỗi nghiệp vụ là ValueError.
    housing_unselector: Callable[[str, str, str], list[dict]] | None = None
    moving_quote_agent: DomainAgent | None = None  # Explicit form implementation; absent means unavailable.
    guardrail: ShadowGuardrail | None = None  # shadow only; never grants workflow permissions


def fake_registry(clock: Callable[[], datetime] = utcnow) -> AgentRegistry:
    return AgentRegistry({name: FakeAgent(name, clock=clock) for name in AgentName})


def default_deps(settings: GraphSettings | None = None) -> GraphDeps:
    """Deps mặc định của app cho tới khi có Intake / Planner thật: PassThroughIntake +
    NotImplementedPlanner + FakeAgent cho mọi lĩnh vực + các fake port."""
    return GraphDeps(
        intake=PassThroughIntake(),
        planner=NotImplementedPlanner(),
        agents=fake_registry(),
        session=InMemorySessionPort(),
        transaction=FakeTransaction(),
        approvals=InMemoryApprovalStore(),
        pii=InMemoryPiiStore(),
        settings=settings or GraphSettings(),
        usage=InMemoryUsageMeter(),
    )


def test_deps(intake: Intake, planner: Planner, **overrides: Any) -> GraphDeps:
    """Deps cho test: fake ở mọi port, cùng một `clock` nếu truyền vào."""
    clock = overrides.pop("clock", utcnow)
    base = GraphDeps(
        intake=intake,
        planner=planner,
        agents=fake_registry(clock),
        session=InMemorySessionPort(clock),
        transaction=FakeTransaction(clock),
        approvals=InMemoryApprovalStore(clock),
        pii=InMemoryPiiStore(clock=clock),
        settings=GraphSettings(),
        usage=InMemoryUsageMeter(),
        clock=clock,
    )
    return replace(base, **overrides)


test_deps.__test__ = False  # pytest không coi đây là test
