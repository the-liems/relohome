"""Bảo vệ dữ liệu cá nhân: mã tham chiếu vô danh, định danh giả danh, lọc bí mật khỏi nhật ký.

Merchant sandbox của ZaloPay dùng chung cho mọi nhóm nên mọi thứ gửi đi coi như công khai.
Quy tắc: dữ liệu cá nhân không bao giờ rời máy nhóm (xem ADR-015).
"""

import hashlib
import hmac
import re
import secrets
from datetime import datetime
from typing import Any

from relohome_payment.errors import InvalidRequestError

REF_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,30}$")
LONG_DIGITS = re.compile(r"\d{9,}")  # dài như số điện thoại hoặc CCCD
GATEWAY_REF_HEX_LENGTH = 8
PSEUDONYM_LENGTH = 16
SECRET_KEYS = {"mac", "key1", "key2", "secret", "token", "zp_trans_token", "order_token", "api_key"}
REDACTED = "***"


def check_opaque_ref(value: str, field: str) -> str:
    """Chỉ nhận mã nội bộ vô danh. Message lỗi cố ý KHÔNG in lại `value` để dữ liệu cá nhân không lọt vào log."""
    if "@" in value or LONG_DIGITS.search(value) or not REF_PATTERN.match(value):
        raise InvalidRequestError(
            f"'{field}' phải là mã nội bộ vô danh (chữ, số, gạch, tối đa 30 ký tự; "
            "không chứa email, số điện thoại hay số giấy tờ). Ví dụ: bk_1a2b3c."
        )
    return value


def new_gateway_ref(prefix: str, now: datetime) -> str:
    """Mã đơn gửi ZaloPay: `yymmdd_<tiền tố nhóm>_<hex ngẫu nhiên>` (ZaloPay bắt buộc mở đầu bằng yymmdd_)."""
    return f"{now:%y%m%d}_{prefix}_{secrets.token_hex(GATEWAY_REF_HEX_LENGTH // 2)}"


def gateway_ref_pattern(prefix: str) -> re.Pattern[str]:
    return re.compile(rf"^\d{{6}}_{re.escape(prefix)}_[0-9a-f]{{{GATEWAY_REF_HEX_LENGTH}}}$")


def pseudonym(salt: str, customer_ref: str) -> str:
    """Định danh giả danh gửi làm `app_user`: băm có muối, không đảo ngược được."""
    digest = hmac.new(salt.encode(), customer_ref.encode(), hashlib.sha256).hexdigest()
    return digest[:PSEUDONYM_LENGTH]


def redact_secrets(value: Any) -> Any:
    """Thay giá trị của các khóa nhạy cảm (mac, key, token...) bằng `***`, đệ quy trong dict/list."""
    if isinstance(value, dict):
        return {k: REDACTED if k.lower() in SECRET_KEYS else redact_secrets(v) for k, v in value.items()}
    if isinstance(value, list):
        return [redact_secrets(v) for v in value]
    return value
