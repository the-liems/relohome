"""Bounded, value-free diagnostics for Moving MCP failures; never log raw messages."""

import logging
import re

from relohome_agent.services.adapters.mcp import ToolCallError

logger = logging.getLogger(__name__)

# Closed vocabulary: even a provider-controlled code or field name can contain PII.
_CODES = frozenset(
    "CONFIGURATION_ERROR VALIDATION_ERROR AUTHENTICATION_ERROR PROVIDER_FORBIDDEN "
    "PROVIDER_NOT_FOUND PROVIDER_CONFLICT PROVIDER_RATE_LIMITED PROVIDER_UNAVAILABLE "
    "PROVIDER_INVALID_RESPONSE PROVIDER_REJECTED APPROVAL_REQUIRED APPROVAL_INVALID "
    "APPROVAL_EXPIRED APPROVAL_CONFLICT WRITE_DISABLED INVALID_ORDER_STATUS "
    "IDEMPOTENCY_CONFLICT QUOTE_NOT_FOUND QUOTE_EXPIRED INTERNAL_ERROR UNAUTHORIZED FORBIDDEN "
    "MCP_INPUT_VALIDATION_ERROR MCP_OUTPUT_VALIDATION_ERROR TOOL_ERROR "
    "timeout unavailable not_configured tool_not_allowed".split()
)
_FIELD_KEYS = frozenset(
    "draft pickup destinations address short_address coordinate lat lng name mobile remarks "
    "tracking_number cod item_value building apartment_or_floor require_pod require_verification "
    "order_time payment_method promo_code items item_id quantity unit_price packages weight_kg "
    "length_cm width_cm height_cm description route_optimized idle_until services service_id "
    "requests request_id tier_code option_id meta contract_version provider environment observed_at "
    "quote quote_id request_fingerprint expires_at options warnings service_name fee currency "
    "distance_km duration_seconds distance_price stop_point_price special_request_price "
    "cod_commission_price voucher_discount subtotal_price total_price total_pay provider_data".split()
)
_FIELD_PATH = re.compile(r"(?:^|,\s*)([a-zA-Z_][a-zA-Z_0-9]*(?:\.[a-zA-Z_0-9]+)*):")


def record_tool_failure(error: ToolCallError, tool: str) -> dict:
    """Emit only trusted tool names/codes and allowlisted schema paths, not field values."""
    code = error.code if error.code in _CODES else "UNCLASSIFIED_TOOL_ERROR"
    category = {
        "MCP_INPUT_VALIDATION_ERROR": "input_validation",
        "MCP_OUTPUT_VALIDATION_ERROR": "output_validation",
        "TOOL_ERROR": "unclassified",
        "UNCLASSIFIED_TOOL_ERROR": "unclassified",
    }.get(code, "transport" if error.transport else "tool")
    fields: list[str] = []
    if category in {"input_validation", "output_validation"}:
        # SDK text: '<prefix>: <description> for tool <name>: path: reason, path: reason'.
        # No free-text reason, regex, received value, dynamic dictionary key or payload is retained.
        detail = error.message.split(": ", 2)[-1][:500]
        for match in _FIELD_PATH.finditer(detail):
            path = match[1]
            if (
                len(path) <= 128
                and all(part in _FIELD_KEYS or re.fullmatch(r"[0-9]{1,5}", part) for part in path.split("."))
                and path not in fields
            ):
                fields.append(path)
            if len(fields) == 16:
                break
    diagnostic = {
        "tool": tool,
        "code": code,
        "category": category,
        "retryable": error.retryable,
        "transport": error.transport,
        "validation_fields": fields,
    }
    logger.warning("Moving MCP failure: %s", diagnostic)
    return diagnostic
