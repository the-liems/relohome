"""ServiceRegistry: URL, credential (read / write), allowlist tool và `source_kind` của từng service.

agent-graph.md §6.3.5, §6.3.7. Cấu hình đọc từ biến môi trường (`.env`); không service nào bắt buộc:
service chưa cấu hình thì lĩnh vực đó không được đăng ký (validate_plan từ chối task của nó).
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import cached_property

from pydantic import SecretStr
from relohome_agent.agents.models import SourceKind
from relohome_agent.config import Settings
from relohome_agent.services.adapters.mcp import McpEndpoint, McpToolClient

LOCATION_READ_TOOLS = frozenset(
    {
        "search_housing",
        "get_housing",
        "search_places",
        "get_place",
        "find_nearby_places",
        "search_areas",
        "resolve_location",
        "calculate_route",
        "calculate_route_between_entities",
    }
)
MOVING_READ_TOOLS = frozenset(
    {
        "list_service_areas",
        "list_moving_services",
        "get_moving_service",
        "estimate_move",
        "get_move_order",
        "get_move_orders",
        "find_move_orders_by_tracking_number",
        "get_move_tracking_link",
        "get_move_order_events",
    }
)
# `transaction` cần một số tool đọc để kiểm giá / đối soát trước và sau khi ghi.
MOVING_WRITE_TOOLS = frozenset(
    {
        "estimate_move",
        "get_move_order",
        "find_move_orders_by_tracking_number",
        "create_move_order",
        "update_move_order",
        "cancel_move_order",
    }
)
FLIGHT_READ_TOOLS = frozenset(
    {"search_airports", "search_flights", "search_return_flights", "get_offer", "get_booking"}
)
FLIGHT_WRITE_TOOLS = frozenset({"get_offer", "get_booking", "hold_booking", "confirm_booking", "cancel_booking"})
PAYMENT_WRITE_TOOLS = frozenset({"create_payment", "get_payment", "cancel_payment", "refund_payment"})
PAYMENT_SIMULATION_TOOLS = frozenset({"simulate_payment_result"})  # chỉ có ở Payment mock


def _secret(value: SecretStr) -> str | None:
    return value.get_secret_value() or None


@dataclass(frozen=True)
class ServiceEntry:
    name: str
    read: McpEndpoint | None
    write: McpEndpoint | None
    source_kind: SourceKind

    def read_client(self) -> McpToolClient | None:
        return self._read_client

    def write_client(self) -> McpToolClient | None:
        return self._write_client

    # Cached: callers share one client, and so one connection pool, per endpoint.
    @cached_property
    def _read_client(self) -> McpToolClient | None:
        return McpToolClient(self.read) if self.read and self.read.configured else None

    @cached_property
    def _write_client(self) -> McpToolClient | None:
        return McpToolClient(self.write) if self.write and self.write.configured else None

    async def aclose(self) -> None:
        # Close only the clients that were created; reading the property would create one.
        for name in ("_read_client", "_write_client"):
            if (client := self.__dict__.get(name)) is not None:
                await client.aclose()


@dataclass(frozen=True)
class ServiceRegistry:
    location: ServiceEntry
    moving: ServiceEntry
    flight: ServiceEntry
    payment: ServiceEntry
    settings: Settings

    async def aclose(self) -> None:
        for entry in (self.location, self.moving, self.flight, self.payment):
            await entry.aclose()

    @classmethod
    def from_settings(cls, s: Settings | None = None) -> ServiceRegistry:
        s = s or Settings()
        location_read = McpEndpoint(
            "location",
            LOCATION_READ_TOOLS,
            url=s.location_mcp_url or None,
            token=_secret(s.location_mcp_auth_token),
            # Administrative geometry exceeds the SDK's default 1 MiB SSE limit.
            # Keep a finite bound, scoped to our trusted Location service.
            max_sse_event_size=16 * 1024 * 1024,
        )
        moving_token = _secret(s.moving_mcp_auth_token)
        moving_read = McpEndpoint("moving", MOVING_READ_TOOLS, url=s.moving_mcp_url or None, token=moving_token)
        # Token ghi riêng, server Moving kiểm quyền theo token; thiếu thì không có endpoint ghi.
        moving_write_token = _secret(s.moving_mcp_write_token)
        moving_write = McpEndpoint(
            "moving",
            MOVING_WRITE_TOOLS,
            url=(s.moving_mcp_url or None) if moving_write_token else None,
            token=moving_write_token,
        )
        flight_read = McpEndpoint(
            "flight",
            FLIGHT_READ_TOOLS,
            url=s.flight_mcp_url or None,
            token=_secret(s.flight_mcp_auth_token),
        )
        flight_write = McpEndpoint(
            "flight",
            FLIGHT_WRITE_TOOLS,
            url=s.flight_mcp_url or None,
            token=_secret(s.flight_mcp_auth_token),
        )
        payment_tools = PAYMENT_WRITE_TOOLS | (
            PAYMENT_SIMULATION_TOOLS if s.payment_simulation_enabled else frozenset()
        )
        payment_write = McpEndpoint(
            "payment",
            payment_tools,
            url=s.payment_mcp_url or None,
            token=_secret(s.payment_mcp_auth_token),
        )
        return cls(
            location=ServiceEntry("location", location_read, None, "live"),
            moving=ServiceEntry(
                "moving", moving_read, moving_write, "sandbox" if s.moving_environment == "staging" else "live"
            ),
            # Tìm chuyến có thể là dữ liệu thật (SerpApi) hoặc mock; phần đặt vé luôn là giả lập (ADR-012).
            flight=ServiceEntry("flight", flight_read, flight_write, "demo"),
            payment=ServiceEntry(
                "payment",
                McpEndpoint(
                    "payment",
                    frozenset({"get_payment"}),
                    url=s.payment_mcp_url or None,
                    token=_secret(s.payment_mcp_auth_token),
                ),
                payment_write,
                s.payment_source_kind,
            ),
            settings=s,
        )
