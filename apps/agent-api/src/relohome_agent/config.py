from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """One settings object for the agent API: app, Roommate and the agent services it wires."""

    model_config = SettingsConfigDict(extra="ignore")

    # App
    app_name: str = "ReloHome Agent"
    # "staging": team test deployment (compose.coolify.yaml); only "production" disables test-only controls.
    app_env: Literal["development", "staging", "production", "test"] = "development"
    cors_origins: str = "http://localhost:3000"
    agent_api_token: SecretStr = SecretStr("")

    # Isolated Roommate service: off until the complete release gates pass.
    roommate_enabled: bool = False
    roommate_state_dir: Path = Path("logs/private-roommate")
    roommate_area_catalog: Path | None = None
    roommate_moderators: str = ""
    # Reuse the existing Housing Admin account IDs; legacy Roommate IDs remain additive.
    housing_moderator_ids: str = ""
    roommate_storage: Literal["sqlite", "postgres"] = "sqlite"
    roommate_database_url: SecretStr = SecretStr("")
    roommate_contact_key: SecretStr = SecretStr("")
    roommate_database_schema: str = "roommate"
    roommate_database_pool_size: int = Field(default=8, ge=1, le=32)
    roommate_chat_retention_days: int = Field(default=180, ge=1, le=3650)

    # Agent services

    # fake: FakeAgent + FakeTransaction; live: nối các service đã cấu hình bên dưới
    agent_subagents: Literal["fake", "live"] = "live"
    agent_state_dir: str = "data/agent-runtime"
    agent_intake_model: str = "gpt-6-luna"
    agent_planner_model: str = "gpt-6-luna"
    agent_moving_model: str = "gpt-6-luna"
    agent_housing_model: str = "gpt-6-luna"
    agent_map_model: str = "gpt-6-luna"
    agent_flight_model: str = "gpt-6-luna"
    agent_payment_model: str = "gpt-6-luna"
    openai_api_key: SecretStr = SecretStr("")
    # Jev uses OpenRouter's separate Decisions endpoint. Never forward an OpenAI key there.
    openrouter_api_key: SecretStr = SecretStr("")
    agent_guardrail_mode: Literal["off", "shadow"] = "off"
    agent_guardrail_timeout_s: float = Field(default=1.5, ge=0.1, le=5.0)
    agent_writes_enabled: bool = False
    agent_max_attempts: int = Field(default=5, ge=1, le=5)  # Intake/Planner repairs, task retries, replans
    agent_filter_fast_path_enabled: bool = True  # single-service filter-only Housing searches and safe follow-up edits
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
    # Inclusive final start time, rather than the end of the last appointment.
    housing_viewing_day_end: str = Field(default="22:00", pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")
    housing_viewing_window_days: int = Field(default=14, ge=1, le=60)
    # Ngày tối đa chủ nhà đề xuất giờ thay thế; platform-api đọc cùng biến HOUSING_VIEWING_PROPOSAL_DAYS.
    housing_viewing_proposal_days: int = Field(default=7, ge=1, le=60)
    housing_viewing_lead_minutes: int = Field(default=60, ge=0, le=7 * 24 * 60)
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


@lru_cache
def get_settings() -> Settings:
    return Settings()
