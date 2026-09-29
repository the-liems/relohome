"""Ráp graph với các service thật hoặc fake theo cấu hình (agent-graph.md §8 "Ráp phần thật").

`AGENT_SUBAGENTS=fake` (mặc định): FakeAgent + FakeTransaction, không cần mạng.
`AGENT_SUBAGENTS=live`: nối subagent nền của các service đã cấu hình trong `.env`:

| Lĩnh vực | Service (nhánh) | Biến môi trường |
|---|---|---|
| property, map | Location (QuangDung) | LOCATION_MCP_URL, LOCATION_MCP_AUTH_TOKEN |
| relocation | Moving / AhaMove (khoa) | MOVING_MCP_URL, MOVING_MCP_AUTH_TOKEN, MOVING_QUOTE_CONTACT_* |
| flight | Flight (Doan/api) | FLIGHT_MCP_URL hoặc FLIGHT_MCP_STDIO=true |
| (thanh toán) | Payment ZaloPay sandbox (Doan/api) | PAYMENT_MCP_URL hoặc PAYMENT_MCP_STDIO=true |

Service chưa cấu hình thì lĩnh vực đó không được đăng ký. Khi chủ service có subagent riêng
(`run_task`), thay subagent nền bằng `RemoteAgent` ở đây; graph không đổi.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field

from src.agents.deps import AgentRegistry, GraphDeps, GraphSettings, default_deps
from src.agents.graph import build_graph, default_checkpointer
from src.agents.intake import Intake, PassThroughIntake
from src.agents.models import AgentName
from src.agents.planning import Planner, TemplatePlanner
from src.agents.subagents.base import DomainAgent
from src.agents.subagents.services.flight import FlightSubagent
from src.agents.subagents.services.location import LocationSubagent
from src.agents.subagents.services.moving import MovingSubagent, QuoteContact
from src.services.adapters.commit import McpTransaction
from src.services.adapters.fakes import InMemoryApprovalStore, InMemoryPiiStore, InMemorySessionPort, InMemoryUsageMeter
from src.services.adapters.moving_approval import HttpMovingApprovalBridge
from src.services.adapters.registry import ServiceRegistry, ServiceSettings


def live_agents(registry: ServiceRegistry) -> dict[AgentName, DomainAgent]:
    agents: dict[AgentName, DomainAgent] = {}
    location = registry.location.read_client()
    if location is not None:
        agents[AgentName.PROPERTY] = LocationSubagent(location, AgentName.PROPERTY)
        agents[AgentName.MAP] = LocationSubagent(location, AgentName.MAP)
    moving = registry.moving.read_client()
    if moving is not None:
        s = registry.settings
        contact = (
            QuoteContact(s.moving_quote_contact_name, s.moving_quote_contact_mobile)
            if s.moving_quote_contact_name and s.moving_quote_contact_mobile
            else None
        )
        agents[AgentName.RELOCATION] = MovingSubagent(moving, location, contact, registry.moving.source_kind)
    flight = registry.flight.read_client()
    if flight is not None:
        agents[AgentName.FLIGHT] = FlightSubagent(flight)
    return agents


def live_deps(
    intake: Intake, planner: Planner, services: ServiceSettings | None = None, settings: GraphSettings | None = None
) -> tuple[GraphDeps, InMemoryApprovalStore, InMemoryPiiStore]:
    registry = ServiceRegistry.from_settings(services)
    s = registry.settings
    approvals, pii = InMemoryApprovalStore(), InMemoryPiiStore()
    bridge = (
        HttpMovingApprovalBridge(s.moving_approval_url, s.moving_approval_token.get_secret_value() or None)
        if s.moving_approval_url
        else None
    )
    transaction = McpTransaction(
        flight=registry.flight.write_client(),
        payment=registry.payment.write_client(),
        moving=registry.moving.write_client(),
        moving_approvals=bridge,
        moving_source_kind=registry.moving.source_kind,
        payment_source_kind=registry.payment.source_kind,
    )
    deps = GraphDeps(
        intake=intake,
        planner=planner,
        agents=AgentRegistry(live_agents(registry)),
        session=InMemorySessionPort(),
        transaction=transaction,
        approvals=approvals,
        pii=pii,
        settings=settings or GraphSettings(),
        usage=InMemoryUsageMeter(),
    )
    return deps, approvals, pii


@dataclass
class AgentService:
    """Graph đã compile cùng deps; API giữ một instance cho cả app."""

    deps: GraphDeps
    graph: object
    approval_store: InMemoryApprovalStore
    pii_store: InMemoryPiiStore
    mode: str
    locks: dict[str, asyncio.Lock] = field(default_factory=dict)

    @classmethod
    def create(
        cls, intake: Intake | None = None, planner: Planner | None = None, services: ServiceSettings | None = None
    ) -> AgentService:
        services = services or ServiceSettings()
        intake = intake or PassThroughIntake()
        planner = planner or TemplatePlanner()  # tất định; LLM Planner (#13) cắm vào làm fallback
        if services.agent_subagents == "live":
            deps, approvals, pii = live_deps(intake, planner, services)
        else:
            base = default_deps()
            approvals, pii = base.approvals, base.pii
            deps = GraphDeps(**{**base.__dict__, "intake": intake, "planner": planner})
        return cls(
            deps=deps,
            graph=build_graph(deps, default_checkpointer()),
            approval_store=approvals,
            pii_store=pii,
            mode=services.agent_subagents,
        )
