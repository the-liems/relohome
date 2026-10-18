"""Ráp graph với các service thật hoặc fake theo cấu hình (agent-graph.md §8 "Ráp phần thật").

`AGENT_SUBAGENTS=fake` (mặc định): FakeAgent + FakeTransaction, không cần mạng.
`AGENT_SUBAGENTS=live`: nối subagent nền của các service đã cấu hình trong `.env`:

| Lĩnh vực | Service (nhánh) | Biến môi trường |
|---|---|---|
| property, map | Location (QuangDung) | LOCATION_MCP_URL, LOCATION_MCP_AUTH_TOKEN |
| relocation | Moving / AhaMove (khoa) | MOVING_MCP_URL, MOVING_MCP_AUTH_TOKEN, MOVING_QUOTE_CONTACT_* |
| flight | Flight (Doan/api) | FLIGHT_MCP_URL |
| (thanh toán) | Payment ZaloPay sandbox (Doan/api) | PAYMENT_MCP_URL |

Service chưa cấu hình thì lĩnh vực đó không được đăng ký.
"""

from __future__ import annotations

import asyncio
from contextlib import AsyncExitStack
from dataclasses import dataclass, field, replace
from datetime import timedelta
from typing import Any

from relohome_agent.agents.deps import AgentRegistry, GraphDeps, GraphSettings, default_deps
from relohome_agent.agents.graph import build_graph, checkpoint_serde, default_checkpointer
from relohome_agent.agents.intake import Intake, PassThroughIntake
from relohome_agent.agents.models import AgentName, PendingPayment, Receipt
from relohome_agent.agents.planning import Planner, TemplatePlanner
from relohome_agent.agents.subagents.base import DomainAgent
from relohome_agent.agents.subagents.services.flight import FlightSubagent
from relohome_agent.agents.subagents.services.location import LocationSubagent
from relohome_agent.agents.subagents.services.moving import MovingSubagent, QuoteContact
from relohome_agent.config import Settings
from relohome_agent.runtime_paths import runtime_path
from relohome_agent.services.adapters.commit import McpTransaction
from relohome_agent.services.adapters.fakes import (
    InMemoryApprovalStore,
    InMemoryPiiStore,
    InMemorySessionPort,
    InMemoryUsageMeter,
)
from relohome_agent.services.adapters.moving_approval import HttpMovingApprovalBridge
from relohome_agent.services.adapters.registry import ServiceRegistry


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
        agents[AgentName.FLIGHT] = FlightSubagent(
            flight, allow_simulation=registry.settings.agent_allow_simulated_transactions
        )
    return agents


def live_deps(
    intake: Intake, planner: Planner, registry: ServiceRegistry, settings: GraphSettings | None = None
) -> tuple[GraphDeps, InMemoryApprovalStore, InMemoryPiiStore]:
    """The caller owns `registry` and closes its pooled MCP clients."""
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
    payment_simulation: bool = False  # có nút "giả lập đã thanh toán" (fake mode, hoặc Payment mock đã bật)
    locks: dict[str, asyncio.Lock] = field(default_factory=dict)
    resources: Any = None
    settings: Settings | None = None
    # LLM domain fanout shares this local lock so budgets cannot be oversubscribed.
    writes_enabled: bool = False
    sandbox_payment_client: Any = None
    checkout: Any = None  # relohome_agent.checkout.service.CheckoutService khi bật thanh toán của app
    viewing: Any = None  # relohome_agent.checkout.viewing.ViewingService khi bật chọn nhiều căn để hẹn xem

    @classmethod
    async def open(cls, services: Settings | None = None, *, roommate_runtime=None):
        """Application entrypoint: real LLMs + configured services + durable local stores."""
        from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
        from relohome_agent.agents.llm_components import build_llm_components
        from relohome_agent.agents.planner_llm import CapabilityRegistry
        from relohome_agent.agents.subagents.services.moving_llm import FormQuoteAgent
        from relohome_agent.services.adapters.sqlite_runtime import (
            DurableModels,
            RuntimeDatabase,
            SqliteApprovalStore,
            SqlitePiiStore,
            SqliteSessionPort,
            SqliteUsageMeter,
        )

        services = services or Settings()
        if services.agent_subagents != "live":
            raise ValueError("Application runtime requires AGENT_SUBAGENTS=live; no simulated services")
        if services.payment_simulation_enabled or services.agent_allow_simulated_transactions:
            raise ValueError("Simulated transactions are disabled for this integration")
        if services.agent_writes_enabled and services.moving_environment != "staging":
            raise ValueError("MVP transactions are restricted to AhaMove staging")
        if services.agent_sandbox_payments_enabled or services.app_payment_demo_enabled:
            await verify_sandbox_payment_service(services)
        async with AsyncExitStack() as stack:
            registry = ServiceRegistry.from_settings(services)
            stack.push_async_callback(registry.aclose)
            components = build_llm_components(services, registry)
            stack.push_async_callback(components.close)
            agents = live_agents(registry)
            if roommate_runtime is not None:
                from relohome_agent.agents.subagents.services.roommate import RoommateSubagent

                agents[AgentName.ROOMMATE] = RoommateSubagent(roommate_runtime)
            if components.moving:
                agents[AgentName.RELOCATION] = components.moving
            # Flight teammate only supplies simulated booking; never advertise it as real.
            if AgentName.FLIGHT in agents:
                agents[AgentName.FLIGHT].capability = agents[AgentName.FLIGHT].capability.model_copy(deep=True)
                agents[AgentName.FLIGHT].capability.commit_kinds = []
            if not services.agent_writes_enabled:
                for agent in agents.values():
                    agent.capability.commit_kinds = []
            components.planner.registry = CapabilityRegistry({n: a.capability for n, a in agents.items()})
            db = RuntimeDatabase(services.agent_state_dir)
            stack.callback(db.close)
            from relohome_agent.agents.subagents.services.payment import PaymentSubagent
            from relohome_agent.agents.subagents.services.read_llm import ReadLlmAgent

            payment_read = registry.payment.read_client()
            if payment_read and services.payment_source_kind == "sandbox":
                agents[AgentName.PAYMENT] = PaymentSubagent(payment_read, db)
            for name, model in {
                AgentName.PROPERTY: services.agent_housing_model,
                AgentName.MAP: services.agent_map_model,
                AgentName.FLIGHT: services.agent_flight_model,
                AgentName.PAYMENT: services.agent_payment_model,
            }.items():
                if name in agents:
                    agent = ReadLlmAgent(services.openai_api_key.get_secret_value(), model, agents[name])
                    agents[name] = agent
                    components.domain_agents.append(agent)
            components.planner.registry = CapabilityRegistry({n: a.capability for n, a in agents.items()})
            approvals, pii = SqliteApprovalStore(db), SqlitePiiStore(db)
            bridge = (
                HttpMovingApprovalBridge(
                    services.moving_approval_url, services.moving_approval_token.get_secret_value()
                )
                if services.moving_approval_url
                else None
            )
            tx = McpTransaction(
                flight=None,
                payment=None,
                moving=registry.moving.write_client() if services.agent_writes_enabled else None,
                moving_approvals=bridge,
                moving_source_kind=registry.moving.source_kind,
                receipts=DurableModels(db, "receipts", Receipt),
                holds=DurableModels(db, "holds", PendingPayment),
                intent_store=db,
            )
            checkout = build_checkout(services, registry, db, pii) if services.app_payment_demo_enabled else None
            viewing = build_viewing(services, registry, db, checkout) if services.housing_viewing_enabled else None
            from relohome_agent.agents.guardrails.shadow import build_guardrail

            guardrail = build_guardrail(services)
            if guardrail:
                stack.push_async_callback(guardrail.close)
            deps = GraphDeps(
                guardrail=guardrail,
                moving_quote_agent=FormQuoteAgent(components.moving) if components.moving is not None else None,
                housing_selector=viewing.selector if viewing else None,
                housing_unselector=viewing.unselector if viewing else None,
                intake=components.intake,
                planner=components.planner,
                agents=AgentRegistry(agents),
                session=SqliteSessionPort(db),
                transaction=tx,
                approvals=approvals,
                pii=pii,
                settings=GraphSettings(
                    max_task_attempts=services.agent_max_attempts,
                    max_replans=services.agent_max_attempts,
                    agent_transport_retries=services.agent_max_attempts - 1,
                    app_payment=services.app_payment_demo_enabled,
                    housing_viewing=services.housing_viewing_enabled,
                ),
                usage=SqliteUsageMeter(db),
            )
            path = str(runtime_path(services.agent_state_dir) / "checkpoints.sqlite3")
            saver = await stack.enter_async_context(AsyncSqliteSaver.from_conn_string(path))
            saver.serde = checkpoint_serde()
            await saver.setup()
            return cls(
                deps,
                build_graph(deps, saver),
                approvals,
                pii,
                "live",
                settings=services,
                writes_enabled=services.agent_writes_enabled,
                sandbox_payment_client=registry.payment.write_client()
                if services.agent_sandbox_payments_enabled
                else None,
                checkout=checkout,
                viewing=viewing,
                # Last, so the stack still closes everything if an argument above raises.
                resources=stack.pop_all(),
            )

    async def close(self):
        if self.resources:
            await self.resources.aclose()

    @classmethod
    def create(
        cls,
        intake: Intake | None = None,
        planner: Planner | None = None,
        services: Settings | None = None,
        *,
        roommate_runtime=None,
    ) -> AgentService:
        services = services or Settings()
        intake = intake or PassThroughIntake()
        planner = planner or TemplatePlanner()  # tất định; LLM Planner (#13) cắm vào làm fallback
        registry = None
        if services.agent_subagents == "live":
            registry = ServiceRegistry.from_settings(services)
            deps, approvals, pii = live_deps(intake, planner, registry)
        else:
            base = default_deps()
            approvals, pii = base.approvals, base.pii
            deps = GraphDeps(**{**base.__dict__, "intake": intake, "planner": planner})
        if roommate_runtime is not None:
            from relohome_agent.agents.subagents.services.roommate import RoommateSubagent

            agents = {name: deps.agents.get(name) for name in deps.agents.names()}
            agents[AgentName.ROOMMATE] = RoommateSubagent(roommate_runtime)
            deps = replace(deps, agents=AgentRegistry(agents))
        return cls(
            deps=deps,
            graph=build_graph(deps, default_checkpointer()),
            approval_store=approvals,
            pii_store=pii,
            mode=services.agent_subagents,
            payment_simulation=services.agent_subagents == "fake" or services.payment_simulation_enabled,
            resources=registry,
        )


async def verify_sandbox_payment_service(services: Settings):
    """Verify service-owned provider configuration without reading merchant secrets."""
    from urllib.parse import urlsplit, urlunsplit

    import httpx

    if not services.payment_mcp_url or services.payment_source_kind != "sandbox":
        raise ValueError("Sandbox payments require PAYMENT_MCP_URL and sandbox source kind")
    endpoint = urlsplit(services.payment_mcp_url)
    health_url = urlunsplit((endpoint.scheme, endpoint.netloc, "/health", "", ""))
    token = services.payment_mcp_auth_token.get_secret_value()
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    try:
        async with httpx.AsyncClient(headers=headers, timeout=5, follow_redirects=False) as http:
            response = await http.get(health_url)
            response.raise_for_status()
            health = response.json()
        if health.get("provider") != "zalopay" or health.get("environment") != "sandbox":
            raise ValueError("Unexpected payment service configuration")
    except (httpx.HTTPError, ValueError, AttributeError) as exc:
        raise ValueError("Payment service must be healthy and use the official ZaloPay sandbox") from exc


def build_viewing(services: Settings, registry: ServiceRegistry, db, checkout=None):
    """Chọn nhiều căn để hẹn xem; dùng chung kho giao dịch với thanh toán của app nếu có."""
    from relohome_agent.checkout.store import CheckoutStore
    from relohome_agent.checkout.viewing import ViewingService, ViewingSettings

    return ViewingService(
        store=checkout.store if checkout is not None else CheckoutStore(db.connection),
        settings=ViewingSettings.from_services(services),
        location=registry.location.read_client(),
    )


def build_checkout(services: Settings, registry: ServiceRegistry, db, pii):
    """Thanh toán của app: chỉ ZaloPay sandbox chính thức và đặt vé mô phỏng; production không có nút tester."""
    from relohome_agent.checkout.service import CheckoutService, CheckoutSettings
    from relohome_agent.checkout.store import CheckoutStore
    from relohome_agent.config import get_settings
    if not services.payment_mcp_url or services.payment_source_kind != "sandbox":
        raise ValueError("App payment demo requires a dedicated sandbox Payment HTTP service")
    production = get_settings().app_env == "production"
    if production and services.payment_tester_confirm_enabled:
        raise ValueError("The tester payment control is never enabled in production")
    contact = (
        QuoteContact(services.moving_quote_contact_name, services.moving_quote_contact_mobile)
        if services.moving_quote_contact_name and services.moving_quote_contact_mobile
        else None
    )
    key = (runtime_path(services.agent_state_dir) / "pii.key").read_bytes()
    return CheckoutService(
        store=CheckoutStore(db.connection),
        pii=pii,
        secret=key,
        flight=registry.flight.write_client(),
        payment=registry.payment.write_client(),
        moving=registry.moving.read_client(),
        moving_contact=contact,
        settings=CheckoutSettings(
            tester_confirm_enabled=services.payment_tester_confirm_enabled,
            tester_user_ids=frozenset(x.strip() for x in services.payment_tester_user_ids.split(",") if x.strip()),
            production=production,
            reconcile_grace=timedelta(seconds=services.payment_reconcile_grace_seconds),
            reconcile_active=timedelta(seconds=services.payment_reconcile_active_seconds),
            reconcile_min=timedelta(seconds=services.payment_reconcile_min_seconds),
            reconcile_max=timedelta(
                seconds=max(services.payment_reconcile_max_seconds, services.payment_reconcile_min_seconds)
            ),
        ),
    )
