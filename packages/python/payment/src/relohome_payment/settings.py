from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import Literal

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

VN_TZ = timezone(timedelta(hours=7))


def now_vn() -> datetime:
    """Thời điểm hiện tại theo giờ Việt Nam."""
    return datetime.now(VN_TZ)


class PaymentSettings(BaseSettings):
    """Cấu hình riêng của payment MCP server, biến môi trường có tiền tố `PAYMENT_`.

    Tách khỏi `src/config.py` (xem ADR-013). `key1`/`key2` chỉ đọc từ môi trường/.env, không có giá trị mặc định.
    """

    model_config = SettingsConfigDict(env_prefix="PAYMENT_", env_file_encoding="utf-8", extra="ignore")

    provider: Literal["mock", "zalopay"] = "mock"
    zalopay_app_id: int = Field(default=0, ge=0)
    zalopay_key1: str = ""
    zalopay_key2: str = ""
    zalopay_endpoint: str = "https://sb-openapi.zalopay.vn/v2"
    redirect_url: str = Field(default="http://localhost:8502/", description="Nơi ZaloPay đưa khách quay lại")
    order_prefix: str = Field(
        default="P044",
        pattern=r"^[A-Za-z0-9]{2,8}$",
        description="Tiền tố nhóm trong mã đơn; merchant sandbox của ZaloPay dùng chung cho mọi nhóm",
    )
    pseudonym_salt: str = Field(default="", description="Để trống = tự sinh ngẫu nhiên và lưu trong SQLite")
    expire_minutes: int = Field(default=15, ge=5, le=1440)
    retention_days: int = Field(default=30, ge=1, le=365)
    db_path: str = "./data/payments.db"
    mcp_auth_token: str = Field(default="", validation_alias=AliasChoices("MCP_AUTH_TOKEN", "PAYMENT_MCP_AUTH_TOKEN", "mcp_auth_token"))
    mcp_host: str = "127.0.0.1"
    mcp_port: int = Field(default=8766, ge=1, le=65535)


@lru_cache
def get_payment_settings() -> PaymentSettings:
    return PaymentSettings()
