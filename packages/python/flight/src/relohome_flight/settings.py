from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import Literal

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# Việt Nam không dùng giờ mùa hè nên offset cố định +07:00 là đủ (không cần tzdata trên Windows)
VN_TZ = timezone(timedelta(hours=7))


def now_vn() -> datetime:
    """Thời điểm hiện tại theo giờ Việt Nam."""
    return datetime.now(VN_TZ)


class FlightSettings(BaseSettings):
    """Cấu hình riêng của flight MCP server.

    Tách khỏi `src/config.py` để không đụng file cấu hình chung của đội.
    Mọi biến môi trường có tiền tố `FLIGHT_`, ví dụ `FLIGHT_SEARCH_PROVIDER=serpapi`.
    """

    model_config = SettingsConfigDict(
        env_prefix="FLIGHT_",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    search_provider: Literal["mock", "serpapi"] = "serpapi"
    simulation_enabled: bool = False
    serpapi_api_key: str = ""
    db_path: str = "./data/flights.db"
    search_cache_ttl: int = Field(default=3600, ge=0, description="Số giây cache kết quả SerpApi")
    offer_ttl_minutes: int = Field(default=30, ge=1, le=240)
    hold_minutes: int = Field(default=15, ge=1, le=120)
    round_trip_min_gap_minutes: int = Field(
        default=120,
        ge=0,
        le=1440,
        description="Khoảng cách tối thiểu giữa giờ hạ cánh chiều đi và giờ cất cánh chiều về",
    )
    mcp_auth_token: str = Field(default="", validation_alias=AliasChoices("MCP_AUTH_TOKEN", "FLIGHT_MCP_AUTH_TOKEN", "mcp_auth_token"))
    mcp_host: str = "127.0.0.1"
    mcp_port: int = Field(default=8765, ge=1, le=65535)


@lru_cache
def get_flight_settings() -> FlightSettings:
    return FlightSettings()
