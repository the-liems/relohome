"""`TransactionPort` thật: chuỗi gọi tool ghi tất định theo `CommitActionKind` (agent-graph.md §6.9).

Không qua LLM (R3). Giá thực tế phải nằm trong khoảng người dùng đã đồng ý ở bước xác nhận (vé: đúng giá;
chuyển đồ: mặc định đúng giá vì `GraphSettings.price_tolerance = {}`; chỉ dùng biên độ khi cấu hình
tường minh và người dùng đồng ý); ngoài khoảng thì dừng, xin xác nhận lại. Thao tác
lỗi không kéo theo việc tự huỷ thao tác khác đã đặt.

| Kind | Bước |
|---|---|
| flight_booking | get_offer → hold_booking (PII qua pii_ref) → create_payment → [chờ PAID] → confirm_booking |
| moving_booking | tìm đơn theo mã đối soát (đã tạo thì dùng lại) → estimate_move lại với liên hệ thật + mã đối soát → ghi approval sang Moving (Q22) → create_move_order (CASH, Q21) |
| cancel_order   | flight: cancel_booking(confirm=true); moving: ghi approval → cancel_move_order |
"""

from __future__ import annotations

import logging
from collections.abc import Callable, MutableMapping
from datetime import datetime
from typing import Any

from relohome_agent.agents.common import fingerprint, utcnow
from relohome_agent.agents.models import Approval, CommitActionKind, PendingPayment, Receipt, SourceKind
from relohome_agent.services.adapters.mcp import McpToolClient, ToolCallError
from relohome_agent.services.adapters.moving_approval import (
    MissingMovingApprovalBridge,
    MovingApprovalBridge,
    MovingApprovalError,
    moving_approval_id,
)
from relohome_agent.services.adapters.ports import CommitError, CommitRequest

logger = logging.getLogger(__name__)


def opaque_ref(prefix: str, key: str) -> str:
    """Mã tham chiếu vô danh cho Payment (chữ, số, gạch, ≤ 30 ký tự; không chứa dữ liệu cá nhân)."""
    return f"{prefix}_{key[:24]}"


def _parse_dt(value: Any) -> datetime | None:
    try:
        return datetime.fromisoformat(str(value)) if value else None
    except ValueError:
        return None


class McpTransaction:
    def __init__(
        self,
        *,
        flight: McpToolClient | None,
        payment: McpToolClient | None,
        moving: McpToolClient | None,
        moving_approvals: MovingApprovalBridge | None = None,
        moving_source_kind: SourceKind = "sandbox",
        payment_source_kind: SourceKind = "sandbox",
        clock: Callable[[], datetime] = utcnow,
        receipts: MutableMapping[str, Receipt] | None = None,
        holds: MutableMapping[str, PendingPayment] | None = None,
        intent_store: Any = None,
    ):
        self.flight, self.payment, self.moving = flight, payment, moving
        self.moving_approvals = moving_approvals or MissingMovingApprovalBridge()
        self.moving_source_kind, self.payment_source_kind = moving_source_kind, payment_source_kind
        self.clock = clock
        # Receipt theo idempotency_key; mặc định trong process, runtime truyền kho bền (Q17). Provider cũng tự
        # chống trùng (Payment theo order_ref + amount, Moving theo workflow_id + action_id).
        # `is None`, not `or`: an empty durable mapping is falsy.
        self._receipts = receipts if receipts is not None else {}
        self._holds = holds if holds is not None else {}
        self.intent_store = intent_store

    async def guarded_commit(self, req):
        """Crash-safe fence: never blindly replay an uncertain write after restart."""
        if self.intent_store is None:
            return await self.commit(req)
        existing = await self.lookup(req.idempotency_key)
        if existing:
            return existing
        if self.intent_store.get("write_intents", req.idempotency_key):
            raise CommitError(
                "A previous write needs provider reconciliation before retry.",
                uncertain=True,
                code="pending_verification",
            )
        self.intent_store.put(
            "write_intents",
            req.idempotency_key,
            {"state": "started", "action": req.action.kind.value, "at": self.clock().isoformat()},
        )
        try:
            receipt = await self.commit(req)
        except CommitError as exc:
            if not exc.uncertain:
                self.intent_store.delete("write_intents", req.idempotency_key)
            raise
        self.intent_store.put("write_intents", req.idempotency_key, {"state": "done", "receipt_id": receipt.receipt_id})
        return receipt

    # --- tiện ích ---

    @staticmethod
    async def _call(
        client: McpToolClient | None, service: str, tool: str, args: dict[str, Any], *, write: bool = False
    ) -> Any:
        if client is None:
            raise CommitError(f"chưa cấu hình giao dịch cho service {service} (thiếu URL hoặc token ghi)")
        try:
            return await client.call(tool, args)
        except ToolCallError as exc:
            # McpToolClient sets transport=True only before dispatch to session.call_tool.
            # A retryable disconnect after dispatch is uncertain for writes; do not replay it.
            uncertain = (
                write
                and not exc.transport
                and (exc.retryable or exc.code in {"PROVIDER_INVALID_RESPONSE", "IDEMPOTENCY_CONFLICT", "TOOL_ERROR"})
            )
            raise CommitError(
                f"{service}.{tool}: {exc.message}",
                uncertain=uncertain or (write and exc.code == "timeout"),
                code=exc.code,
            ) from exc

    def _receipt(
        self,
        req: CommitRequest,
        receipt_id: str,
        provider: str,
        amount: int,
        source_kind: SourceKind,
        status: str,
        details: dict[str, Any],
    ) -> Receipt:
        receipt = Receipt(
            receipt_id=receipt_id,
            action_id=req.action.id,
            kind=req.action.kind,
            provider=provider,
            amount_vnd=amount,
            source_kind=source_kind,
            status=status,
            details=details,
            created_at=self.clock(),
        )
        self._receipts[req.idempotency_key] = receipt
        return receipt

    async def lookup(self, idempotency_key: str) -> Receipt | None:
        return self._receipts.get(idempotency_key)

    # --- Flight + Payment ---

    async def start_payment(self, req: CommitRequest) -> PendingPayment:
        if req.action.kind != CommitActionKind.FLIGHT_BOOKING:
            raise CommitError(f"{req.action.kind.value} không đi qua Payment")
        if req.idempotency_key in self._holds:
            return self._holds[req.idempotency_key]
        detail = await self._call(self.flight, "flight", "get_offer", {"offer_id": req.option_id})
        price = ((detail or {}).get("offer") or {}).get("total_price")
        if price != req.amount_vnd:
            raise CommitError(f"giá vé đã đổi ({price} ≠ {req.amount_vnd}); cần xác nhận lại")
        booking = await self._call(
            self.flight,
            "flight",
            "hold_booking",
            {
                "request": {
                    "offer_id": req.option_id,
                    "passengers": req.pii.get("passengers"),
                    "contact": req.pii.get("contact"),
                }
            },
            write=True,
        )
        booking_id = booking["booking_id"]
        if booking.get("total_price") != req.amount_vnd:
            await self._safe_cancel_booking(booking_id)
            raise CommitError("tổng tiền giữ chỗ khác số tiền đã xác nhận; đã huỷ giữ chỗ")
        payment = await self._call(
            self.payment,
            "payment",
            "create_payment",
            {
                "order_ref": opaque_ref("fb", req.idempotency_key),
                "amount": req.amount_vnd,
                "customer_ref": opaque_ref("u", fingerprint(req.approval.user_id)),
            },
            write=True,
        )
        expires = [d for d in (_parse_dt(payment.get("expires_at")), _parse_dt(booking.get("hold_expires_at"))) if d]
        pending = PendingPayment(
            action_id=req.action.id,
            payment_ref=payment["payment_id"],
            pay_url=payment.get("pay_url"),
            qr_code=payment.get("qr_code"),
            amount_vnd=req.amount_vnd,
            expires_at=min(expires) if expires else self.clock(),
            status="PENDING",
            source_kind=self.payment_source_kind,
            pre_payment_receipt=Receipt(
                receipt_id=booking_id,
                action_id=req.action.id,
                kind=req.action.kind,
                provider="lifeflow-flights",
                amount_vnd=req.amount_vnd,
                source_kind="demo",
                status="HELD",
                details={"pnr": booking.get("pnr")},
                created_at=self.clock(),
            ),
        )
        self._holds[req.idempotency_key] = pending
        return pending

    async def payment_status(self, payment_ref: str) -> str:
        payment = await self._call(self.payment, "payment", "get_payment", {"payment_ref": payment_ref})
        return payment["status"]

    async def cancel_payment(self, payment_ref: str) -> str:
        payment = await self._call(self.payment, "payment", "cancel_payment", {"payment_ref": payment_ref}, write=True)
        return payment["status"]

    async def simulate_payment(self, payment_ref: str, outcome: str) -> str:
        payment = await self._call(
            self.payment, "payment", "simulate_payment_result", {"payment_ref": payment_ref, "outcome": outcome}
        )
        return payment["status"]

    async def complete_after_payment(self, req: CommitRequest, pending: PendingPayment) -> Receipt:
        booking_id = pending.pre_payment_receipt.receipt_id
        try:
            booking = await self._call(
                self.flight, "flight", "confirm_booking", {"booking_ref": booking_id}, write=True
            )
        except CommitError as exc:
            # Đã trả tiền mà xuất vé lỗi: không tự thử lại; cần hoàn tiền (refund chưa có trong MVP của Payment).
            # A definite rejection means no ticket was issued; only an unknown outcome stays uncertain.
            raise CommitError(
                f"đã thanh toán nhưng xuất vé lỗi ({exc.message}); cần hoàn tiền thủ công", uncertain=exc.uncertain
            ) from exc
        self._holds.pop(req.idempotency_key, None)
        return self._receipt(
            req,
            booking_id,
            "lifeflow-flights",
            req.amount_vnd,
            "demo",
            booking.get("status", "TICKETED"),
            {
                "pnr": booking.get("pnr"),
                "ticket_count": len(booking.get("ticket_numbers") or []),
                "payment_ref": pending.payment_ref,
                "payment_source_kind": pending.source_kind,
            },
        )

    async def abort_after_payment(self, req: CommitRequest, pending: PendingPayment) -> None:
        if pending.pre_payment_receipt is not None:
            await self._safe_cancel_booking(pending.pre_payment_receipt.receipt_id)
        self._holds.pop(req.idempotency_key, None)

    async def _safe_cancel_booking(self, booking_id: str) -> None:
        try:
            await self._call(
                self.flight, "flight", "cancel_booking", {"booking_ref": booking_id, "confirm": True}, write=True
            )
        except CommitError as exc:  # giữ chỗ tự hết hạn phía provider
            logger.warning("cancel hold failed booking=%s: %s", booking_id, exc.message)

    # --- Moving + huỷ đơn ---

    async def commit(self, req: CommitRequest) -> Receipt:
        kind = req.action.kind
        if kind == CommitActionKind.MOVING_BOOKING:
            return await self._moving_booking(req)
        if kind == CommitActionKind.CANCEL_ORDER:
            return await self._cancel(req)
        if kind == CommitActionKind.UPDATE_ORDER:
            from relohome_contracts.schemas import MovingOrderUpdate

            update = MovingOrderUpdate.model_validate(req.pii.get("order_update", {})).model_dump(exclude_none=True)
            target = req.action.target_receipt_id
            if not target:
                raise CommitError("Cần mã đơn chính xác để cập nhật.")
            payload = {"action": "update", "order_id": target, **update}
            approval_id = await self._moving_approval(req.approval, req.action.id, "update", "update", payload)
            result = await self._call(
                self.moving,
                "moving",
                "update_move_order",
                {"order_id": target, **update, "approval_id": approval_id},
                write=True,
            )
            order = result.get("order", result)
            return self._receipt(
                req,
                target,
                "ahamove",
                0,
                self.moving_source_kind,
                order.get("status", "UNKNOWN"),
                {"updated": True, "fee_known": False},
            )
        raise CommitError(f"{kind.value} chưa được hỗ trợ")

    async def _moving_approval(
        self, approval: Approval, action_id: str, step: str, action_type: str, payload: dict
    ) -> str:
        approval_id = moving_approval_id(approval.approval_id, action_id, step)
        expires_at = approval.expires_at
        try:
            return await self.moving_approvals.register(
                approval_id=approval_id,
                action_type=action_type,
                payload=payload,
                approved_by=approval.user_id,
                expires_at=expires_at,
            )
        except MovingApprovalError as exc:
            raise CommitError(str(exc)) from exc

    async def _moving_booking(self, req: CommitRequest) -> Receipt:
        route = req.task_data.get("route") or {}
        service_id = req.option.get("service_id") or req.option_id.split(":", 1)[-1]
        pickup, destination = route.get("pickup"), route.get("destination")
        contacts = (req.pii.get("pickup_contact"), req.pii.get("destination_contact"))
        if not pickup or not destination or not all(contacts):
            raise CommitError("thiếu điểm lấy / giao hoặc liên hệ để đặt xe")

        from relohome_contracts.moving_options import apply_draft_options, validated_options
        from relohome_contracts.schemas import MovingContact

        options = validated_options(req.task_data.get("moving_options"))
        if options.get("service_id") and options["service_id"] != service_id:
            raise CommitError("Gói xe không khớp báo giá đã chọn; cần lấy báo giá mới.")

        def point(p: dict, contact: dict) -> dict[str, Any]:
            return {
                "address": p["address"],
                "coordinate": {"lat": p["lat"], "lng": p["lng"]},
                **MovingContact.model_validate(contact).model_dump(exclude_none=True),
            }

        # Mã đối soát vô danh, ổn định theo thao tác: đặt vào điểm giao TRƯỚC lần báo giá dùng để tạo đơn,
        # để Moving / graph tìm lại đơn khi kết quả tạo đơn không rõ (ADR-003).
        tracking = opaque_ref("mv", req.idempotency_key)
        found = await self._call(
            self.moving, "moving", "find_move_orders_by_tracking_number", {"tracking_number": tracking}
        )
        orders = found.get("orders", []) if isinstance(found, dict) else (found or [])
        if len(orders) > 1:
            raise CommitError(f"có {len(orders)} đơn cùng mã đối soát; cần kiểm tra thủ công", uncertain=True)
        if len(orders) == 1:  # đã tạo ở lần chạy trước (ví dụ sau khi restart): dùng lại, không tạo lần hai
            return self._moving_receipt(req, orders[0], int(req.amount_vnd))

        draft: dict[str, Any] = {
            "pickup": point(pickup, contacts[0]),
            "destinations": [{**point(destination, contacts[1]), "tracking_number": tracking}],
            "payment_method": "CASH",
        }
        if route.get("order_time"):
            draft["order_time"] = route["order_time"]
        draft = apply_draft_options(draft, options)
        # 1. Báo giá lại với liên hệ thật (đọc); giá phải nằm trong khoảng người dùng đã đồng ý.
        estimate = await self._call(
            self.moving,
            "moving",
            "estimate_move",
            {
                "draft": draft,
                "services": [
                    {"service_id": service_id, **({"requests": options["requests"]} if options.get("requests") else {})}
                ],
            },
        )
        quote = estimate["quote"]
        option = next((o for o in quote.get("options", []) if o.get("service_id") == service_id), None)
        total = (option or {}).get("fee", {}).get("total_price")
        if total is None or not req.price_accepted(int(total)):
            raise CommitError(
                f"giá chuyển đồ thực tế {total} nằm ngoài khoảng đã đồng ý "
                f"({req.min_amount_vnd or req.amount_vnd}–{req.max_amount_vnd or req.amount_vnd}); cần xác nhận lại"
            )
        workflow_id, action_id = f"lifeflow:{req.approval.thread_id}", req.idempotency_key
        # 2. Ghi approval sang Moving (Q22), mã approval gắn với quote cụ thể. 3. Tạo đơn, trả tiền mặt (Q21).
        approval_id = await self._moving_approval(
            req.approval,
            req.action.id,
            f"create:{quote['quote_id']}",
            "create",
            {
                "action": "create",
                "quote_id": quote["quote_id"],
                "quote_fingerprint": quote["request_fingerprint"],
                "service_id": service_id,
                "total_price": total,
                "workflow_id": workflow_id,
                "action_id": action_id,
            },
        )
        created = await self._call(
            self.moving,
            "moving",
            "create_move_order",
            {
                "quote_id": quote["quote_id"],
                "service_id": service_id,
                "approval_id": approval_id,
                "workflow_id": workflow_id,
                "action_id": action_id,
            },
            write=True,
        )
        return self._moving_receipt(req, created["order"], int(total))

    def _moving_receipt(self, req: CommitRequest, order: dict, actual_vnd: int) -> Receipt:
        return self._receipt(
            req,
            order["order_id"],
            "ahamove",
            actual_vnd,
            self.moving_source_kind,
            order.get("status", "UNKNOWN"),
            {
                "order_id": order["order_id"],
                "shared_link": order.get("shared_link"),
                "payment_method": "CASH",
                "estimated_vnd": req.amount_vnd,
                "to_address": req.task_data.get("to_address"),
            },
        )

    async def _cancel(self, req: CommitRequest) -> Receipt:
        target = req.action.target_receipt_id or ""
        if req.task_data.get("booking") or target.startswith("bk_"):
            result = await self._call(
                self.flight, "flight", "cancel_booking", {"booking_ref": target, "confirm": True}, write=True
            )
            fee = result.get("cancel_fee")
            return self._receipt(
                req,
                target,
                "lifeflow-flights",
                int(fee or 0),
                "demo",
                result.get("status", "CANCELLED"),
                {"cancel_fee_known": fee is not None, "refund_amount": result.get("refund_amount")},
            )
        order = await self._cancel_move_order(req.approval, req.action.id, "cancel", target)
        # AhaMove chưa có cách báo phí huỷ: không ghi 0 như thể miễn phí.
        return self._receipt(
            req,
            target,
            "ahamove",
            0,
            self.moving_source_kind,
            order.get("status", "CANCELLED"),
            {"cancel_fee_known": False},
        )

    async def _cancel_move_order(self, approval: Approval, action_id: str, step: str, order_id: str) -> dict:
        comment = "Khách huỷ qua LifeFlow"
        approval_id = await self._moving_approval(
            approval, action_id, step, "cancel", {"action": "cancel", "order_id": order_id, "comment": comment}
        )
        result = await self._call(
            self.moving,
            "moving",
            "cancel_move_order",
            {"order_id": order_id, "comment": comment, "approval_id": approval_id},
            write=True,
        )
        return result.get("order", result) if isinstance(result, dict) else {}

    async def compensate(self, receipt: Receipt) -> None:
        """Không tự huỷ đơn đã đặt bằng sự đồng ý cũ: huỷ là thao tác mới, đi qua `confirm` + approval
        (`cancel_order`). Graph báo người dùng phần đã đặt / lỗi rồi hỏi có muốn huỷ không."""
        raise CommitError("huỷ đơn đã đặt cần người dùng xác nhận riêng (cancel_order)")
