"""ServiceRegistry: URL, credential (read / write), allowlist tool và `source_kind` của từng service.

agent-graph.md §6.3.5, §6.3.7. Cấu hình đọc từ biến môi trường (`.env`); không service nào bắt buộc:
service chưa cấu hình thì lĩnh vực đó không được đăng ký (validate_plan từ chối task của nó).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from pydantic import Field, SecretStr
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
FLIGHT_READ_TOOLS = frozenset(
    {"search_airports", "search_flights", "search_return_flights", "get_offer", "get_booking"}
)
FLIGHT_WRITE_TOOLS = frozenset({"get_offer", "get_booking", "hold_booking", "confirm_booking", "cancel_booking"})
PAYMENT_WRITE_TOOLS = frozenset({"create_payment", "get_payment", "cancel_payment", "refund_payment"})
PAYMENT_SIMULATION_TOOLS = frozenset({"simulate_payment_result"})  # chỉ có ở Payment mock


class ServiceSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # fake: FakeAgent + FakeTransaction; live: nối các service đã cấu hình bên dưới
    agent_subagents: Literal["fake", "live"] = "live"
    agent_state_dir: str = "data/agent-runtime"
    agent_api_token: SecretStr = SecretStr("")
    agent_intake_model: str = "gpt-6-luna"
    agent_planner_model: str = "gpt-6-luna"
    agent_moving_model: str = "gpt-6-luna"
    agent_housing_model: str = "gpt-6-luna"
    agent_map_model: str = "gpt-6-luna"
    agent_flight_model: str = "gpt-6-luna"
    agent_payment_model: str = "gpt-6-luna"
    openai_api_key: SecretStr = SecretStr("")
    agent_writes_enabled: bool = False
    agent_max_attempts: int = Field(default=5, ge=1, le=5)  # Intake/Planner repairs, task retries, replans
    agent_sandbox_payments_enabled: bool = False
    # Local graph demos also use this opt-in for mock Flight search results.
    # AgentService.open rejects it for the application runtime.
    agent_allow_simulated_transactions: bool = False

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

    # Flight: dedicated HTTP service; missing URL leaves the domain unconfigured.
    flight_mcp_url: str = ""
    flight_mcp_auth_token: SecretStr = SecretStr("")

    # Payment / ZaloPay sandbox (nhánh Doan/api)
    payment_mcp_url: str = ""
    payment_mcp_auth_token: SecretStr = SecretStr("")
    payment_source_kind: Literal["sandbox", "demo", "live"] = "sandbox"
    # Nút "giả lập đã thanh toán" cho demo. Chỉ bật khi Payment MCP chạy PAYMENT_PROVIDER=mock
    # (server chỉ có tool `simulate_payment_result` ở chế độ mock; `/health` trả "simulation": true).
    payment_simulation_enabled: bool = False

    # Thanh toán đa dịch vụ của app (docs/review/payment-design.md): vé và chuyển đồ đi qua ZaloPay sandbox,
    # vé giữ chỗ/xuất vé mô phỏng trên Flight MCP, chuyển đồ chỉ ghi "đã duyệt". Không tạo đơn AhaMove.
    app_payment_demo_enabled: bool = False
    # Nút "Đã thanh toán" cho tester (ADR-015 mục cập nhật 2026-10-07). Không bao giờ bật trên production.
    payment_tester_confirm_enabled: bool = False
    payment_tester_user_ids: str = ""  # ID tài khoản gateway, phân tách bằng dấu phẩy
    payment_reconcile_grace_seconds: int = Field(default=180, ge=30, le=3600)
    # Worker tự đối soát lần thanh toán còn mở (không cần người dùng bấm Kiểm tra).
    payment_reconcile_active_seconds: int = Field(default=10, ge=2, le=120)  # khi giữ chỗ còn hạn
    payment_reconcile_min_seconds: int = Field(default=10, ge=2, le=600)
    payment_reconcile_max_seconds: int = Field(default=300, ge=10, le=3600)
    # Chọn nhiều căn, hẹn xem và chốt (docs/review/housing-viewing-design.md). Mọi ngưỡng là cấu hình.
    housing_viewing_enabled: bool = False
    housing_max_selected: int = Field(default=3, ge=1, le=10)
    housing_viewing_slot_minutes: int = Field(default=30, ge=5, le=240)
    housing_viewing_day_start: str = Field(default="08:00", pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")
    housing_viewing_day_end: str = Field(default="20:00", pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")
    housing_viewing_window_days: int = Field(default=14, ge=1, le=60)
    housing_viewing_lead_minutes: int = Field(default=120, ge=0, le=7 * 24 * 60)
    housing_viewing_travel_buffer_minutes: int = Field(default=15, ge=0, le=240)
    housing_viewing_min_gap_minutes: int = Field(default=60, ge=0, le=24 * 60)
    housing_viewing_daily_soft_limit: int = Field(default=4, ge=1, le=48)
    housing_viewing_route_profile: Literal["driving", "motorcycle", "walking"] = "motorcycle"
    # Thành phố có dữ liệu đường (contract calculate_route_between_entities); thử theo thứ tự này.
    housing_viewing_route_cities: str = "hcm,hanoi,danang"
    housing_viewing_route_cache_seconds: int = Field(default=1800, ge=0, le=86400)
    housing_same_place_meters: int = Field(default=50, ge=1, le=1000)
    housing_deposit_suggested_months: float = Field(default=1, ge=0, le=12)
    # Chỉ để test: ghi kết quả gặp chủ nhà ngay sau khi hẹn, không chờ tới giờ xem. Bị bỏ qua khi APP_ENV=production.
    housing_viewing_test_visit_anytime: bool = False
    app_timezone: str = "Asia/Ho_Chi_Minh"


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
