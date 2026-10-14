"""Sanitize telemetry copies only. Never mutate application inputs or outputs."""

from __future__ import annotations

import json
import math
import os
import re
from urllib.parse import urlsplit, urlunsplit

LIMIT = 16 * 1024
SECRET = re.compile(
    r"(?:^|_)(?:api_?key|authorization|cookie|password|secret|token|key1|key2|signature|credential)(?:$|_)",
    re.I,
)
PERSONAL = frozenset({
    "name", "full_name", "first_name", "last_name", "dob", "date_of_birth", "birthday",
    "email", "phone", "phone_number", "mobile", "contact", "address", "cccd", "cmnd",
    "passport", "id_number", "passengers_detail", "pickup_contact", "destination_contact",
})
EMAIL = re.compile(r"[^@\s\"<>]+@[^@\s\"<>]+\.[^@\s\"<>]+")
PHONE = re.compile(r"(?<![\d.])(?:\+84|0)(?:[\s.-]?\d){8,10}(?![\d.])")
IDENTITY = re.compile(r"(?<!\d)\d{12}(?!\d)")
KEY = re.compile(r"\b(?:sk-[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b")
BEARER = re.compile(r"\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+", re.I)
ASSIGNMENT = re.compile(
    r"(?i)(\b(?:api[_-]?key|authorization|password|secret|access[_-]?token|token|signature)"
    r"\s*[=:]\s*)(?:\"[^\"]*\"|'[^']*'|[^\s,;&}]+)"
)
URL = re.compile(r"https?://[^\s\"<>]+")


def mode() -> str:
    value = os.getenv("OBSERVABILITY_CONTENT_MODE", "redacted").lower()
    return value if value in {"metadata", "redacted", "raw"} else "metadata"


def _url(match: re.Match) -> str:
    try:
        url = urlsplit(match.group())
        host = url.hostname or ""
        return urlunsplit((url.scheme, host, url.path, "", ""))
    except ValueError:
        return "[url]"


def clean_text(value: str, *, personal: bool = True) -> str:
    value = URL.sub(_url, value)
    value = ASSIGNMENT.sub(r"\1[redacted]", BEARER.sub("[credential]", KEY.sub("[credential]", value)))
    if personal:
        value = EMAIL.sub("[email]", IDENTITY.sub("[identity]", PHONE.sub("[phone]", value)))
    return value


def _key(value: str) -> str:
    return re.sub(r"([a-z])([A-Z])", r"\1_\2", value).lower().replace("-", "_")


def sanitize(value, *, personal: bool = True, depth: int = 0):
    if depth > 12:
        return "[depth limit]"
    if value is None or isinstance(value, (bool, int)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if hasattr(value, "model_dump"):
        value = value.model_dump(mode="json")
    if isinstance(value, dict):
        output = {}
        for key, item in list(value.items())[:200]:
            key = str(key)
            normalized = _key(key)
            if SECRET.search(normalized) or normalized in {"pay_url", "qr_code", "pii_refs", "provider_data"}:
                output[key] = "[credential]"
            elif personal and normalized in PERSONAL:
                output[key] = "[personal]"
            else:
                output[clean_text(key)] = sanitize(item, personal=personal, depth=depth + 1)
        return output
    if isinstance(value, (list, tuple)):
        return [sanitize(item, personal=personal, depth=depth + 1) for item in value[:200]]
    if isinstance(value, str):
        # Tool arguments and LLM messages frequently contain JSON encoded inside strings.
        if value.lstrip().startswith(("{", "[")):
            try:
                decoded = json.loads(value)
            except (ValueError, RecursionError):
                pass
            else:
                return sanitize(decoded, personal=personal, depth=depth + 1)
        return clean_text(value, personal=personal)
    # Never call arbitrary __str__/repr on application objects or exception values.
    return "[unsupported]"


def content(value) -> str | None:
    selected = mode()
    if selected == "metadata":
        return None
    try:
        rendered = json.dumps(sanitize(value, personal=selected != "raw"), ensure_ascii=False, allow_nan=False)
        encoded = rendered.encode("utf-8")
        if len(encoded) > LIMIT:
            return encoded[:LIMIT - 16].decode("utf-8", errors="ignore") + " [truncated]"
        return rendered
    except Exception:
        return None
