"""Cầu nối approval sang backend Moving (agent-graph.md §6.9, Q22).

Tool ghi của Moving chỉ chạy khi có bản ghi approval do backend Moving lưu, khớp hash payload (ADR-003).
Sau khi `check_approval` của graph qua, `transaction` ghi bản ghi đó qua endpoint nội bộ của Moving
rồi mới gọi tool ghi. Endpoint do chủ service Moving cung cấp; contract đề xuất:

    POST <MOVING_APPROVAL_URL>   Authorization: Bearer <MOVING_APPROVAL_TOKEN>
    {"approval_id": "<uuid>", "action_type": "create" | "update" | "cancel",
     "payload": {...}, "approved_by": "<user_id>", "expires_at": "<ISO 8601>"}
    → 200 / 201 {"approval_id": "<uuid>"}

Moving tự tính hash của `payload` bằng cách canonical hoá của mình (`hash.ts`), nên graph gửi payload
chứ không gửi hash.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal, Protocol

import httpx


class MovingApprovalError(Exception):
    pass


class MovingApprovalBridge(Protocol):
    async def register(
        self,
        *,
        approval_id: str,
        action_type: Literal["create", "update", "cancel"],
        payload: dict[str, Any],
        approved_by: str,
        expires_at: datetime,
    ) -> str: ...


def moving_approval_id(graph_approval_id: str, action_id: str, step: str) -> str:
    """Moving yêu cầu UUID và tiêu thụ approval một lần: mỗi (approval, action, bước) một id ổn định."""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"lifeflow:{graph_approval_id}:{action_id}:{step}"))


class HttpMovingApprovalBridge:
    def __init__(self, url: str, token: str | None, timeout_s: float = 10.0):
        self.url, self.token, self.timeout_s = url, token, timeout_s

    async def register(self, *, approval_id, action_type, payload, approved_by, expires_at) -> str:
        headers = {"Authorization": f"Bearer {self.token}"} if self.token else {}
        body = {
            "approval_id": approval_id,
            "action_type": action_type,
            "payload": payload,
            "approved_by": approved_by,
            "expires_at": expires_at.isoformat(),
        }
        try:
            async with httpx.AsyncClient(timeout=self.timeout_s) as client:
                response = await client.post(self.url, json=body, headers=headers)
        except httpx.HTTPError as exc:
            raise MovingApprovalError(f"không gọi được endpoint approval của Moving: {type(exc).__name__}") from exc
        if response.status_code not in (200, 201):
            raise MovingApprovalError(f"Moving từ chối ghi approval (HTTP {response.status_code})")
        return approval_id


class MissingMovingApprovalBridge:
    """Dùng khi chưa có endpoint (Q22 chưa xong): thao tác ghi Moving bị từ chối rõ ràng, không đoán."""

    async def register(self, **_: Any) -> str:
        raise MovingApprovalError("chưa cấu hình endpoint ghi approval của Moving (MOVING_APPROVAL_URL)")
