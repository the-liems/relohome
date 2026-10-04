"""Tiện ích dùng chung của graph: JSON canonical, băm, thời gian UTC.

`canonical` / `fingerprint` lấy từ `src/agent_services/common.py` (nhánh `khoa`, agent-graph.md §3.3).
"""

from __future__ import annotations

import hashlib
import json
import unicodedata
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel


def utcnow() -> datetime:
    return datetime.now(UTC)


def _plain(value: Any) -> Any:
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(k): _plain(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [_plain(v) for v in value]
    return value


def canonical(value: Any) -> str:
    """JSON ổn định (sắp key, không khoảng trắng) để băm payload."""
    return json.dumps(_plain(value), ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def fingerprint(value: Any) -> str:
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def nfc(text: str) -> str:
    return unicodedata.normalize("NFC", text)
