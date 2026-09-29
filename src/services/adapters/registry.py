"""ServiceRegistry: URL, credential (read / write), allowlist tool và `source_kind` của từng service.

agent-graph.md §6.3.5, §6.3.7. Cấu hình đọc từ biến môi trường (`.env`); không service nào bắt buộc:
service chưa cấu hình thì lĩnh vực đó không được đăng ký (validate_plan từ chối task của nó).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

from src.agents.models import SourceKind
from src.services.adapters.mcp import McpEndpoint, McpToolClient

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
FLIGHT_READ_TOOLS = frozenset({"search_airports", "search_flights", "get_offer", "get_booking"})
FLIGHT_WRITE_TOOLS = frozenset({"get_offer", "get_booking", "hold_booking", "confirm_booking", "cancel_booking"})
PAYMENT_WRITE_TOOLS = frozenset({"create_payment", "get_payment", "cancel_payment", "refund_payment"})


class ServiceSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # fake: FakeAgent + FakeTransaction; live: nối các service đã cấu hình bên dưới
    agent_subagents: Literal["fake", "live"] = "fake"

    # Location: housing + place + route (nhánh QuangDung), Streamable HTTP + Bearer
    location_mcp_url: str = ""
    location_mcp_auth_token: SecretStr = SecretStr("")

    # Moving / AhaMove (nhánh khoa), HTTP /mcp + Bearer
    moving_mcp_url: str = ""
    moving_mcp_auth_token: SecretStr = SecretStr("")
    moving_mcp_write_token: SecretStr = SecretStr("")  # để trống = không đặt / huỷ đơn được (không dùng token đọc thay)
    moving_environment: Literal["staging", "production"] = "staging"
    # Cầu nối approval sang backend Moving (Q22); endpoint do chủ service Moving cung cấp
    moving_approval_url: str = ""
    moving_approval_token: SecretStr = SecretStr("")
    # Liên hệ dùng để lấy báo giá (AhaMove bắt buộc tên + SĐT ngay cả khi chỉ ước tính). Đặt số tổng đài
    # của hệ thống; liên hệ thật của người dùng chỉ đưa vào lúc đặt, qua pii_ref (D16).
    moving_quote_contact_name: str = ""
    moving_quote_contact_mobile: str = ""

    # Flight (nhánh Doan/api). Để trống URL + bật stdio = tự chạy server Python cục bộ.
    flight_mcp_url: str = ""
    flight_mcp_token: SecretStr = SecretStr("")
    flight_mcp_stdio: bool = False

    # Payment / ZaloPay sandbox (nhánh Doan/api)
    payment_mcp_url: str = ""
    payment_mcp_token: SecretStr = SecretStr("")
    payment_mcp_stdio: bool = False
    payment_source_kind: Literal["sandbox", "demo", "live"] = "sandbox"


def _secret(value: SecretStr) -> str | None:
    return value.get_secret_value() or None


@dataclass(frozen=True)
class ServiceEntry:
    name: str
    read: McpEndpoint | None
    write: McpEndpoint | None
    source_kind: SourceKind

    def read_client(self) -> McpToolClient | None:
        return McpToolClient(self.read) if self.read and self.read.configured else None

    def write_client(self) -> McpToolClient | None:
        return McpToolClient(self.write) if self.write and self.write.configured else None


@dataclass(frozen=True)
class ServiceRegistry:
    location: ServiceEntry
    moving: ServiceEntry
    flight: ServiceEntry
    payment: ServiceEntry
    settings: ServiceSettings

    @classmethod
    def from_settings(cls, s: ServiceSettings | None = None) -> ServiceRegistry:
        s = s or ServiceSettings()
        location_read = McpEndpoint(
            "location", LOCATION_READ_TOOLS, url=s.location_mcp_url or None, token=_secret(s.location_mcp_auth_token)
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
        flight_stdio = "src.mcp_servers.flights" if s.flight_mcp_stdio and not s.flight_mcp_url else None
        flight_read = McpEndpoint(
            "flight",
            FLIGHT_READ_TOOLS,
            url=s.flight_mcp_url or None,
            token=_secret(s.flight_mcp_token),
            stdio_module=flight_stdio,
        )
        flight_write = McpEndpoint(
            "flight",
            FLIGHT_WRITE_TOOLS,
            url=s.flight_mcp_url or None,
            token=_secret(s.flight_mcp_token),
            stdio_module=flight_stdio,
        )
        payment_stdio = "src.mcp_servers.payments" if s.payment_mcp_stdio and not s.payment_mcp_url else None
        payment_write = McpEndpoint(
            "payment",
            PAYMENT_WRITE_TOOLS,
            url=s.payment_mcp_url or None,
            token=_secret(s.payment_mcp_token),
            stdio_module=payment_stdio,
        )
        return cls(
            location=ServiceEntry("location", location_read, None, "live"),
            moving=ServiceEntry(
                "moving", moving_read, moving_write, "sandbox" if s.moving_environment == "staging" else "live"
            ),
            # Tìm chuyến có thể là dữ liệu thật (SerpApi) hoặc mock; phần đặt vé luôn là giả lập (ADR-012).
            flight=ServiceEntry("flight", flight_read, flight_write, "demo"),
            payment=ServiceEntry("payment", None, payment_write, s.payment_source_kind),
            settings=s,
        )
