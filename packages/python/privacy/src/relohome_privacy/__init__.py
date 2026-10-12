"""Agent-owned PII predicates and redaction; no application dependencies."""
import re
from typing import Any

_EMAIL = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")
_LONG_DIGITS = re.compile(r"\d{9,}")


_PHONE = re.compile(r"(?<![\d.])(?:\+84|0)(?:[\s.-]?\d){8,10}(?![\d.])")
_ID_NUMBER = re.compile(r"(?<!\d)\d{12}(?!\d)")  # CCCD


def redact_pii(text: str) -> str:
    """Che email, SĐT, số CCCD trước khi gửi tin nhắn cho LLM (D16). Không nhận diện được họ tên: người
    dùng được hướng nhập thông tin cá nhân qua form, không qua chat."""
    text = _EMAIL.sub("[email]", text)
    text = _ID_NUMBER.sub("[số giấy tờ]", text)
    return _PHONE.sub("[số điện thoại]", text)


def looks_like_pii(value: Any) -> bool:
    text = str(value)
    return bool(_EMAIL.search(text) or _LONG_DIGITS.search(text.replace(" ", "").replace(".", "")))

def contains_contact_pii(value: Any) -> bool:
    """Email or phone detection, without the broader long-digit heuristic."""
    text = str(value)
    return bool(_EMAIL.search(text) or _PHONE.search(text))
