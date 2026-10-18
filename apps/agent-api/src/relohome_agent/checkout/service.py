"""Nghiệp vụ thanh toán đa dịch vụ (payment-design §6–§12). Không gọi LLM.

Luồng: tóm tắt (dựng từ state) → xác nhận thanh toán (khóa chống trùng) → kiểm giá → [vé: giữ chỗ] → tạo đơn
ZaloPay sandbox → chờ trả / tester đánh dấu / đối soát → công việc hoàn tất (lưu bền, chạy một lần).
Mỗi bước gọi bên ngoài ghi ý định trước (`step`) và kết quả sau; lỗi không rõ chuyển sang đối soát.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import secrets
import string
from collections.abc import Callable
from contextlib import suppress
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from typing import Any

from relohome_agent.agents.common import utcnow
from relohome_agent.agents.models import AgentName
from relohome_agent.checkout.models import (
    OPEN,
    PAID,
    CheckoutError,
    FulfilmentJob,
    PaymentAttempt,
    ServiceTransaction,
)
from relohome_agent.checkout.store import CheckoutStore
from relohome_agent.services.adapters.mcp import ToolCallError

logger = logging.getLogger(__name__)
VN_OFFSET = timedelta(hours=7)
STALE_PROCESSING = timedelta(minutes=2)


def _letters(n: int) -> str:
    """Mã vô danh chỉ có chữ: Payment MCP từ chối mã có dãy số dài (giống số điện thoại / CCCD)."""
    return "".join(secrets.choice(string.ascii_lowercase) for _ in range(n))


def _letters_of(hex_digest: str) -> str:
    return hex_digest.translate(str.maketrans("0123456789", "ghijklmnop"))


@dataclass
class CheckoutSettings:
    tester_confirm_enabled: bool = False
    tester_user_ids: frozenset[str] = frozenset()
    production: bool = False
    reconcile_grace: timedelta = timedelta(minutes=3)
    # Worker tự đối soát lần thanh toán còn mở. Khi còn trả được (trước `expires_at`, đã gồm hạn giữ chỗ)
    # tra đều mỗi `reconcile_active` và thêm một lần `reconcile_final_margin` trước hạn, để đơn đã trả kịp
    # xuất vé. Sau hạn mới giãn dần từ `reconcile_min` tới `reconcile_max`.
    reconcile_active: timedelta = timedelta(seconds=10)
    reconcile_final_margin: timedelta = timedelta(seconds=3)
    reconcile_min: timedelta = timedelta(seconds=10)
    reconcile_max: timedelta = timedelta(minutes=5)
    viewing_slot_minutes: int = 30
    viewing_start_hour: int = 8
    viewing_end_hour: int = 20
    viewing_days: int = 14
    job_retry_limit: int = 5


@dataclass
class CheckoutService:
    store: CheckoutStore
    pii: Any  # SqlitePiiStore: put(data) -> ref
    secret: bytes  # khóa HMAC cho dấu vân tay hành khách (không lưu dữ liệu cá nhân)
    flight: Any = None  # McpToolClient ghi của Flight MCP (mô phỏng)
    payment: Any = None  # McpToolClient ghi của Payment MCP (ZaloPay sandbox)
    moving: Any = None  # McpToolClient đọc của Moving MCP (báo giá lại)
    moving_contact: Any = None  # QuoteContact của hệ thống, chỉ để báo giá
    settings: CheckoutSettings = field(default_factory=CheckoutSettings)
    clock: Callable[[], datetime] = utcnow
    # Lịch đối soát trong bộ nhớ: khởi động lại thì kiểm tra lại ngay mọi lần thanh toán còn mở.
    _next_check: dict[str, tuple[datetime, timedelta]] = field(default_factory=dict)
    locks: dict[str, asyncio.Lock] = field(default_factory=dict)
    _worker: asyncio.Task | None = None
    _jobs: set[asyncio.Task] = field(default_factory=set)
    _stopping: asyncio.Event = field(default_factory=asyncio.Event)

    # ------------------------------------------------------------------ helpers

    def _lock(self, key: str) -> asyncio.Lock:
        return self.locks.setdefault(key, asyncio.Lock())

    def _owned_tx(self, user_id: str, transaction_id: str) -> ServiceTransaction:
        tx = self.store.get_tx(transaction_id)
        if tx is None or tx.user_id != user_id:
            raise CheckoutError(404, "Không tìm thấy giao dịch.")
        return tx

    def _owned_attempt(self, user_id: str, attempt_id: str) -> PaymentAttempt:
        attempt = self.store.get_attempt(attempt_id)
        if attempt is None or attempt.user_id != user_id:
            raise CheckoutError(404, "Không tìm thấy lần thanh toán.")
        return attempt

    @staticmethod
    def payload_hash(tx: ServiceTransaction) -> str:
        """Gồm mọi thứ ảnh hưởng tới duyệt; không có dữ liệu cá nhân."""
        material = {
            "transaction_id": tx.transaction_id,
            "option_id": tx.option_id,
            "option_version": tx.option_version,
            "price_vnd": tx.price_vnd,
            "price_scope": tx.price_scope,
            "price_expires_at": tx.price_expires_at.isoformat() if tx.price_expires_at else None,
            "lines": tx.lines,
            "legs": tx.legs,
            "passenger_counts": tx.passenger_counts,
            "payee": tx.payee,
        }
        return hashlib.sha256(json.dumps(material, sort_keys=True, default=str).encode()).hexdigest()

    def _digest(self, data: Any) -> str:
        return hmac.new(self.secret, json.dumps(data, sort_keys=True, default=str).encode(), "sha256").hexdigest()[:32]

    def _touch(self, model):
        model.updated_at = self.clock()
        return model

    # ------------------------------------------------------------------ summary (dựng từ state, không gọi mạng)

    def summary(self, user_id: str, thread_id: str, values: dict, domain: str) -> dict:
        builder = {"flight": self._flight_tx, "relocation": self._moving_tx}.get(domain)
        if builder is None:
            raise CheckoutError(422, "Dịch vụ này không thanh toán qua app.")
        draft = builder(user_id, thread_id, values)
        tx = self._upsert_option(draft)
        return self.transaction_view(tx, values=values)

    def _upsert_option(self, draft: ServiceTransaction) -> ServiceTransaction:
        """Cùng phương án thì giữ giao dịch; phương án khác thì phiên bản mới, giao dịch cũ chưa trả bị thay."""
        current = self.store.current_tx(draft.user_id, draft.thread_id, draft.logical_key)
        if current is not None and current.option_id == draft.option_id:
            if current.status == "price_changed":
                # Giữ giá mới do nhà cung cấp vừa trả; người dùng xác nhận lại theo giá này.
                current.status = "selected"
                self.store.put_tx(self._touch(current))
            elif current.status == "selected":
                for key in ("price_vnd", "price_scope", "price_read_at", "price_expires_at", "lines", "legs", "title"):
                    setattr(current, key, getattr(draft, key))
                current.passenger_counts = draft.passenger_counts
                current.details = {**current.details, **draft.details}
                self.store.put_tx(self._touch(current))
            return current
        if current is not None:
            if any(a.outcome in PAID or a.outcome in OPEN for a in self.store.attempts_for(current.transaction_id)):
                raise CheckoutError(
                    409,
                    "Phương án cũ đã có lần thanh toán đang xử lý hoặc đã trả. Hãy hoàn tất hoặc đối soát trước khi đổi.",
                )
            current.superseded = True
            self.store.put_tx(self._touch(current))
            draft.option_version = current.option_version + 1
        self.store.put_tx(draft)
        return draft

    def _new_tx(self, **kw) -> ServiceTransaction:
        now = self.clock()
        return ServiceTransaction(transaction_id="tx_" + _letters(16), created_at=now, updated_at=now, **kw)

    @staticmethod
    def _selected(values: dict, domain: str) -> str | None:
        intake = values.get("intake")
        fact = intake.user_confirmed_facts.get(f"selected:{domain}") if intake else None
        return str(fact.value) if fact else None

    @staticmethod
    def _find_row(values: dict, agent: AgentName, option_id: str, keys: tuple[str, ...]):
        for task_id, result in (values.get("task_results") or {}).items():
            if result.agent != agent:
                continue
            for key in keys:
                for row in result.data.get(key) or []:
                    if isinstance(row, dict) and option_id in (row.get("id"), row.get("option_id")):
                        return task_id, result, row
        return None

    def _flight_tx(self, user_id: str, thread_id: str, values: dict) -> ServiceTransaction:
        option_id = self._selected(values, "flight")
        if not option_id:
            raise CheckoutError(409, "Hãy chọn chuyến bay trước khi thanh toán.")
        found = self._find_row(values, AgentName.FLIGHT, option_id, ("return_options", "offers"))
        if found is None:
            raise CheckoutError(409, "Chuyến đã chọn không còn trong kết quả. Hãy tìm lại.")
        task_id, result, row = found
        if row.get("kind") == "round_trip_outbound":
            raise CheckoutError(409, "Vé khứ hồi: hãy chọn chuyến về trước khi thanh toán.")
        if row.get("fare_vnd") is None:
            raise CheckoutError(409, "Chuyến này chưa có giá. Hãy chọn chuyến khác.")
        expires = _parse_dt(row.get("expires_at"))
        pax = result.data.get("passengers") or {"adults": 1}
        legs = row.get("legs") or [
            {
                "direction": "out",
                "carrier": row.get("carrier"),
                "origin": result.data.get("origin"),
                "destination": result.data.get("destination"),
                "depart_at": row.get("depart_at"),
                "arrive_at": row.get("arrive_at"),
            }
        ]
        round_trip = row.get("kind") == "round_trip"
        title = (
            f"Vé khứ hồi {result.data.get('origin')} ⇄ {result.data.get('destination')}"
            if round_trip
            else f"Vé {result.data.get('origin')} → {result.data.get('destination')}"
        )
        return self._new_tx(
            user_id=user_id,
            thread_id=thread_id,
            logical_key=f"flight:{task_id}",
            domain="flight",
            task_id=task_id,
            option_id=option_id,
            status="selected",
            price_vnd=int(row["fare_vnd"]),
            price_scope={
                "kind": "round_trip" if round_trip else "one_way",
                "passengers": pax,
                "currency": "VND",
                "reference": True,
            },
            price_source="SerpApi (giá tham khảo)",
            price_read_at=result.fetched_at,
            price_expires_at=expires,
            amount_kind="one_time",
            payee="ReloHome giữ tiền (mô phỏng, chưa chuyển cho hãng bay)",
            mode="simulated",
            title=title,
            lines=[{"label": _leg_label(leg), "direction": leg.get("direction", "out")} for leg in legs],
            legs=legs,
            passenger_counts={k: int(v) for k, v in pax.items()},
            details={"carrier": row.get("carrier"), "flight_date": (legs[0].get("depart_at") or "")[:10]},
        )

    def _moving_tx(self, user_id: str, thread_id: str, values: dict) -> ServiceTransaction:
        option_id = self._selected(values, "relocation")
        if not option_id:
            raise CheckoutError(409, "Hãy chọn một báo giá chuyển đồ trước khi thanh toán.")
        found = self._find_row(values, AgentName.RELOCATION, option_id, ("quotes",))
        if found is None:
            raise CheckoutError(409, "Báo giá đã chọn không còn trong kết quả. Hãy lấy báo giá mới.")
        task_id, result, row = found
        if row.get("price_vnd") is None:
            raise CheckoutError(409, "Báo giá này chưa có giá.")
        route = result.data.get("route") or {}
        order_time = route.get("order_time")
        move_at = datetime.fromtimestamp(order_time, tz=timezone_vn()) if order_time else None
        return self._new_tx(
            user_id=user_id,
            thread_id=thread_id,
            logical_key=f"moving:{task_id}",
            domain="relocation",
            task_id=task_id,
            option_id=option_id,
            status="selected",
            price_vnd=int(row["price_vnd"]),
            price_scope={"kind": "moving_quote", "currency": "VND", "reference": False},
            price_source="AhaMove staging",
            price_read_at=result.fetched_at,
            price_expires_at=_parse_dt(result.data.get("expires_at")),
            amount_kind="one_time",
            payee="ReloHome giữ tiền (mô phỏng, chưa tạo đơn AhaMove)",
            mode="staging",
            title=f"Chuyển đồ: {row.get('vehicle') or row.get('service_id')}",
            lines=[
                {"label": f"{result.data.get('from_address', '')} → {result.data.get('to_address', '')}"},
                {"label": f"{row.get('vehicle') or row.get('service_id')}"},
            ],
            details={
                "service_id": row.get("service_id"),
                "quote_id": result.data.get("quote_id"),
                "move_date": move_at.date().isoformat() if move_at else row.get("date"),
                "move_time": move_at.strftime("%H:%M") if move_at else None,
                "route": route,
                "moving_options": result.data.get("moving_options") or {},
            },
        )

    # ------------------------------------------------------------------ pay

    async def pay(
        self,
        user_id: str,
        transaction_id: str,
        payload_hash: str,
        request_key: str,
        passengers: dict | None = None,
    ) -> dict:
        async with self._lock(transaction_id):
            tx = self._owned_tx(user_id, transaction_id)
            if tx.superseded:
                raise CheckoutError(409, "Phương án đã thay đổi. Hãy xem lại tóm tắt.")
            if payload_hash != self.payload_hash(tx):
                raise CheckoutError(409, "Nội dung thanh toán đã thay đổi. Hãy xem lại tóm tắt và xác nhận lại.")
            if tx.domain not in {"flight", "relocation"}:
                raise CheckoutError(422, "Dịch vụ này không thanh toán qua app.")
            passenger_ref, passenger_digest, cleaned = None, None, None
            if tx.domain == "flight":
                cleaned = self._validate_passengers(tx, passengers)
                passenger_digest = self._digest(cleaned)
            # Lần trước đã đóng (chưa trả / hủy) thì lần sau là lần mới; hai tab cùng lúc vẫn ra cùng một khóa.
            retry = sum(a.outcome in {"not_paid", "cancelled"} for a in self.store.attempts_for(tx.transaction_id))
            key = self._digest(
                {"tx": tx.transaction_id, "v": tx.option_version, "h": payload_hash, "p": passenger_digest, "r": retry}
            )
            existing = self.store.attempt_by_key(key)
            if existing is not None:
                return self.attempt_view(existing)
            for other in self.store.attempts_for(tx.transaction_id):
                if other.outcome in PAID:
                    raise CheckoutError(409, "Giao dịch này đã được thanh toán.")
                if other.outcome == "needs_reconciliation":
                    raise CheckoutError(
                        409, "Đang kiểm tra lần thanh toán trước. Chỉ thanh toán lại khi đã xác định an toàn."
                    )
                if other.outcome in {"processing", "awaiting_payment"}:
                    if other.expires_at is None or other.expires_at > self.clock():
                        return self.attempt_view(other)
                    raise CheckoutError(409, "Lần thanh toán trước đã hết hạn và đang được đối soát. Hãy kiểm tra.")
            if tx.domain == "flight":
                passenger_ref = await self.pii.put(cleaned)
            versions = [a.passenger_version or 0 for a in self.store.attempts_for(tx.transaction_id)]
            now = self.clock()
            attempt = PaymentAttempt(
                attempt_id="pa_" + _letters(16),
                transaction_id=tx.transaction_id,
                user_id=user_id,
                thread_id=tx.thread_id,
                idempotency_key=key,
                payload_hash=payload_hash,
                option_version=tx.option_version,
                passenger_ref=passenger_ref,
                passenger_version=(max(versions, default=0) + 1) if tx.domain == "flight" else None,
                amount_vnd=int(tx.price_vnd or 0),
                lines=tx.lines,
                created_at=now,
                updated_at=now,
            )
            if not self.store.insert_attempt(attempt):  # hai tab cùng lúc: lần kia đã tạo
                return self.attempt_view(self.store.attempt_by_key(key))
            tx.status = "payment_processing"
            self.store.put_tx(self._touch(tx))
            try:
                await self._prepare(tx, attempt, cleaned)
            except CheckoutError as exc:
                attempt.outcome, attempt.note = "cancelled", exc.message
                self.store.put_attempt(self._touch(attempt))
                if exc.code == "price_changed":
                    tx.status = "price_changed"
                elif tx.status == "payment_processing":
                    tx.status = "selected"
                self.store.put_tx(self._touch(tx))
                raise
            return self.attempt_view(attempt)

    def _validate_passengers(self, tx: ServiceTransaction, passengers: dict | None) -> dict:
        from relohome_flight.schemas import Contact, Passenger

        if not isinstance(passengers, dict):
            raise CheckoutError(422, "Cần thông tin hành khách để đặt vé.", "passengers_required")
        try:
            rows = [Passenger.model_validate(p) for p in passengers.get("passengers") or []]
            contact = Contact.model_validate(passengers.get("contact") or {})
        except ValueError:
            raise CheckoutError(422, "Thông tin hành khách hoặc liên hệ chưa hợp lệ.", "passengers_invalid") from None
        counts = tx.passenger_counts or {"adults": 1}
        expected = (counts.get("adults", 0), counts.get("children", 0), counts.get("infants", 0))
        got = tuple(sum(1 for p in rows if p.type == t) for t in ("adult", "child", "infant"))
        if got != expected:
            raise CheckoutError(
                422,
                f"Vé dành cho {expected[0]} người lớn, {expected[1]} trẻ em, {expected[2]} em bé; "
                f"bạn đã nhập {got[0]}/{got[1]}/{got[2]}.",
                "passengers_mismatch",
            )
        # Cùng luật tuổi với Flight MCP, kiểm trước để báo đúng lỗi (không phải "chọn lại chuyến") và không giữ chỗ thừa.
        from relohome_flight.booking_engine import AGE_RULES, age_on

        fly = _parse_dt((tx.legs[0] if tx.legs else {}).get("depart_at"))
        labels = {"adult": "người lớn (từ 12 tuổi)", "child": "trẻ em (2–11 tuổi)", "infant": "em bé (dưới 2 tuổi)"}
        for index, p in enumerate(rows, start=1):
            low, high = AGE_RULES[p.type]
            if fly is not None and not low <= age_on(p.date_of_birth, fly.date()) < high:
                who = "Người đặt (hồ sơ tài khoản)" if index == 1 else f"Hành khách {index}"
                raise CheckoutError(
                    422,
                    f"{who}: ngày sinh không khớp loại vé {labels[p.type]} tại ngày bay. Hãy sửa ngày sinh.",
                    "passenger_age",
                )
        return {
            # Nội địa, không giữ CCCD/hộ chiếu (D3).
            "passengers": [p.model_dump(mode="json", exclude_none=True, exclude={"id_number"}) for p in rows],
            "contact": contact.model_dump(mode="json"),
        }

    async def _prepare(self, tx: ServiceTransaction, attempt: PaymentAttempt, people: dict | None) -> None:
        """Kiểm giá → [giữ chỗ] → tạo đơn ZaloPay. Mỗi bước ghi ý định trước khi gọi."""
        if self.payment is None:
            raise CheckoutError(503, "Cổng thanh toán sandbox chưa được bật.")
        if tx.domain == "flight":
            if self.flight is None:
                raise CheckoutError(503, "Đặt vé mô phỏng chưa được bật.")
            await self._check_flight_price(tx)
        else:
            await self._check_moving_price(tx)
        attempt.step = "price_checked"
        self.store.put_attempt(self._touch(attempt))
        if tx.domain == "flight":
            attempt.step = "holding"
            self.store.put_attempt(self._touch(attempt))
            try:
                booking = await self.flight.call(
                    "hold_booking",
                    {
                        "request": {
                            "offer_id": tx.option_id,
                            "passengers": people["passengers"],
                            "contact": people["contact"],
                            "passenger_ref": attempt.passenger_ref,
                        }
                    },
                )
            except ToolCallError as exc:
                if exc.transport:
                    raise CheckoutError(502, "Chưa giữ được chỗ (mất kết nối). Hãy thử lại.") from None
                # Lời Flight có thể chứa tên hành khách: không đưa vào ghi chú lưu bền.
                if "hết hạn" in exc.message or "expired" in exc.message.lower():
                    raise CheckoutError(
                        409, "Giá tham khảo của chuyến đã hết hạn. Hãy tìm lại.", "offer_expired"
                    ) from None
                raise CheckoutError(
                    409, "Không giữ được chỗ cho chuyến này. Hãy chọn lại chuyến.", "hold_failed"
                ) from None
            if int(booking.get("total_price") or -1) != attempt.amount_vnd:
                await self._cancel_hold(booking.get("booking_id"))
                raise CheckoutError(409, "Tổng tiền giữ chỗ khác số tiền đã xác nhận; đã hủy giữ chỗ.", "price_changed")
            attempt.hold = {
                "booking_id": booking.get("booking_id"),
                "pnr": booking.get("pnr"),
                "hold_expires_at": booking.get("hold_expires_at"),
                "simulated": True,
            }
            attempt.step = "held"
            self.store.put_attempt(self._touch(attempt))
        await self._create_payment(tx, attempt)

    async def _check_flight_price(self, tx: ServiceTransaction) -> None:
        try:
            detail = await self.flight.call("get_offer", {"offer_id": tx.option_id})
        except ToolCallError as exc:
            if exc.transport:
                raise CheckoutError(502, "Chưa đọc được chuyến bay. Hãy thử lại.") from None
            raise CheckoutError(
                409, "Giá tham khảo của chuyến này đã hết hạn. Hãy tìm lại chuyến.", "expired"
            ) from None
        offer = (detail or {}).get("offer") or {}
        price = offer.get("total_price")
        if price is None or int(price) != tx.price_vnd:
            tx.price_vnd = int(price) if price is not None else tx.price_vnd
            raise CheckoutError(409, "Giá tham khảo đã thay đổi. Hãy xem lại tóm tắt.", "price_changed")

    async def _check_moving_price(self, tx: ServiceTransaction) -> None:
        """Báo giá lại AhaMove staging với cùng tuyến, giờ, gói và tùy chọn (D2); không tạo đơn."""
        if self.moving is None or self.moving_contact is None:
            raise CheckoutError(503, "Chưa kết nối được dịch vụ báo giá chuyển đồ.")
        from relohome_contracts.moving_options import apply_draft_options, validated_options

        route = tx.details.get("route") or {}
        pickup, destination = route.get("pickup"), route.get("destination")
        if not pickup or not destination:
            raise CheckoutError(409, "Báo giá thiếu điểm lấy hoặc giao. Hãy lấy báo giá mới.")
        if route.get("order_time") and route["order_time"] < (self.clock() + timedelta(minutes=30)).timestamp():
            raise CheckoutError(409, "Giờ chuyển đã qua hoặc quá sát. Hãy chọn giờ mới và lấy báo giá mới.", "expired")
        options = validated_options(tx.details.get("moving_options"))

        def point(p: dict) -> dict:
            return {
                "address": p["address"],
                "coordinate": {"lat": p["lat"], "lng": p["lng"]},
                "name": self.moving_contact.name,
                "mobile": self.moving_contact.mobile,
            }

        draft = {"pickup": point(pickup), "destinations": [point(destination)], "payment_method": "CASH"}
        if route.get("order_time"):
            draft["order_time"] = route["order_time"]
        draft = apply_draft_options(draft, options)
        service_id = tx.details.get("service_id")
        services = [
            {"service_id": service_id, **({"requests": options["requests"]} if options.get("requests") else {})}
        ]
        try:
            estimate = await self.moving.call("estimate_move", {"draft": draft, "services": services})
        except ToolCallError as exc:
            if exc.transport:
                raise CheckoutError(502, "Chưa báo giá lại được với AhaMove. Hãy thử lại.") from None
            raise CheckoutError(
                409, "AhaMove không báo giá lại được phương án này. Hãy lấy báo giá mới.", "expired"
            ) from None
        quote = (estimate or {}).get("quote") or {}
        option = next((o for o in quote.get("options", []) if o.get("service_id") == service_id), None)
        total = ((option or {}).get("fee") or {}).get("total_price")
        if total is None:
            raise CheckoutError(409, "AhaMove không còn gói xe này. Hãy lấy báo giá mới.", "expired")
        tx.details["requote_id"] = quote.get("quote_id")
        if int(total) != tx.price_vnd:
            tx.price_vnd = int(total)
            raise CheckoutError(409, "Giá chuyển đồ đã thay đổi. Hãy xem lại tóm tắt.", "price_changed")

    async def _create_payment(self, tx: ServiceTransaction, attempt: PaymentAttempt) -> None:
        attempt.step = "creating_payment"
        attempt.gateway_status = "creating"
        self.store.put_attempt(self._touch(attempt))
        try:
            payment = await self.payment.call(
                "create_payment",
                {
                    "order_ref": attempt.attempt_id,
                    "amount": attempt.amount_vnd,
                    "customer_ref": "u_" + _letters_of(self._digest({"user": attempt.user_id})[:16]),
                },
            )
        except ToolCallError as exc:
            if exc.transport and not exc.retryable:
                raise CheckoutError(502, "Chưa tạo được đơn thanh toán. Hãy thử lại.") from None
            if not exc.retryable and exc.code != "TOOL_ERROR":
                # The gateway explicitly rejected the order, so none exists; reconciling would only repeat it.
                # Release the flight hold now: a cancelled attempt is never reconciled, so nothing else would.
                await self._cancel_hold((attempt.hold or {}).get("booking_id"))
                raise CheckoutError(
                    502, "Cổng thanh toán từ chối tạo đơn. Hãy thử lại sau.", "payment_rejected"
                ) from None
            # Đã gửi lệnh ghi mà không rõ kết quả: không tạo lại mù, chuyển đối soát.
            attempt.outcome, attempt.gateway_status = "needs_reconciliation", "unknown"
            attempt.note = "Chưa rõ kết quả tạo đơn thanh toán; đang đối soát."
            self.store.put_attempt(self._touch(attempt))
            return
        hold_expiry = _parse_dt((attempt.hold or {}).get("hold_expires_at"))
        expiries = [d for d in (_parse_dt(payment.get("expires_at")), hold_expiry) if d]
        attempt.payment_id = payment.get("payment_id")
        attempt.pay_url = payment.get("pay_url")
        attempt.qr_code = payment.get("qr_code")
        attempt.expires_at = min(expiries) if expiries else self.clock() + timedelta(minutes=15)
        attempt.gateway_status = "pending"
        attempt.outcome = "awaiting_payment"
        attempt.step = "payment_created"
        self.store.put_attempt(self._touch(attempt))
        tx.status = "awaiting_payment"
        self.store.put_tx(self._touch(tx))

    async def _cancel_hold(self, booking_id: str | None) -> None:
        if not booking_id or self.flight is None:
            return
        try:
            await self.flight.call("cancel_booking", {"booking_ref": booking_id, "confirm": True})
        except ToolCallError as exc:  # giữ chỗ tự hết hạn phía provider
            logger.warning("cancel hold failed: %s", exc.code)

    # ------------------------------------------------------------------ kiểm tra / đối soát

    async def check(self, user_id: str, attempt_id: str) -> dict:
        attempt = self._owned_attempt(user_id, attempt_id)
        async with self._lock(attempt.transaction_id):
            attempt = self.store.get_attempt(attempt_id)
            await self._sync(attempt)
            return self.attempt_view(self.store.get_attempt(attempt_id))

    async def _sync(self, attempt: PaymentAttempt) -> None:
        now = self.clock()
        if attempt.outcome in {"not_paid", "cancelled", "paid_verified"}:
            return
        if attempt.outcome == "processing" and now - attempt.updated_at > STALE_PROCESSING:
            # Bị gián đoạn giữa chừng (ví dụ khởi động lại) trước khi gửi lệnh tạo đơn: an toàn để hủy lần này.
            if attempt.step != "creating_payment":
                attempt.outcome = "cancelled"
                attempt.note = "Lần thanh toán bị gián đoạn trước khi tạo đơn. Hãy thanh toán lại."
                self.store.put_attempt(self._touch(attempt))
                await self._cancel_hold((attempt.hold or {}).get("booking_id"))
                tx = self.store.get_tx(attempt.transaction_id)
                if tx and tx.status == "payment_processing":
                    tx.status = "selected"
                    self.store.put_tx(self._touch(tx))
                return
            attempt.outcome = "needs_reconciliation"
        if attempt.payment_id is None:
            if attempt.outcome == "needs_reconciliation" and attempt.step == "creating_payment":
                # Tạo lại với cùng mã đơn: Payment MCP trả lại đơn cũ nếu đã tạo, không tạo đơn thứ hai.
                tx = self.store.get_tx(attempt.transaction_id)
                attempt.outcome = "processing"
                try:
                    await self._create_payment(tx, attempt)
                except CheckoutError as exc:
                    if exc.code != "payment_rejected":
                        raise
                    # A definite rejection ends this attempt instead of repeating on every reconcile.
                    attempt.outcome, attempt.note = "cancelled", exc.message
                    self.store.put_attempt(self._touch(attempt))
                    if tx and tx.status == "payment_processing":
                        tx.status = "selected"
                        self.store.put_tx(self._touch(tx))
            return
        expired = attempt.expires_at is not None and now >= attempt.expires_at
        if attempt.outcome == "awaiting_payment" and expired:
            attempt.outcome = "needs_reconciliation"
            attempt.note = "Đã hết hạn trên app; đang chờ đối soát với ZaloPay."
            self.store.put_attempt(self._touch(attempt))
        # Trong thời gian chờ sau hạn vẫn tra (chỉ đọc) để ghi nhận ngay lần trả sát hạn, nhưng chưa kết luận
        # "không thanh toán": cổng có thể chưa ghi nhận xong.
        within_grace = expired and now < attempt.expires_at + self.settings.reconcile_grace
        try:
            payment = await self.payment.call("get_payment", {"payment_ref": attempt.payment_id})
        except ToolCallError:
            if expired:
                attempt.outcome = "needs_reconciliation" if attempt.outcome != "paid_simulated" else attempt.outcome
                self.store.put_attempt(self._touch(attempt))
            return
        status = str((payment or {}).get("status") or "PENDING").upper()
        attempt.reconciled_at = now
        if status in {"PAID", "REFUNDED"}:
            attempt.gateway_status = "paid"
            previous = attempt.outcome
            attempt.outcome = "paid_verified"
            attempt.note = ""
            self._mark_paid(attempt, start_job=previous != "paid_simulated")
            return
        if status == "PENDING":
            attempt.gateway_status = "pending"
            self.store.put_attempt(self._touch(attempt))
            return
        attempt.gateway_status = {"FAILED": "failed", "EXPIRED": "expired", "CANCELLED": "cancelled"}.get(
            status, "unknown"
        )
        if within_grace and attempt.outcome != "paid_simulated":
            self.store.put_attempt(self._touch(attempt))
            return  # chưa kết luận trong thời gian chờ
        if attempt.outcome == "paid_simulated":
            self.store.put_attempt(self._touch(attempt))
            return  # tester đã đánh dấu: giữ kết quả mô phỏng, ghi trạng thái cổng riêng
        if attempt.gateway_status in {"failed", "expired", "cancelled"} and (expired or status != "EXPIRED"):
            attempt.outcome = "not_paid"
            attempt.note = "ZaloPay xác nhận đơn không được thanh toán. Có thể thanh toán lại."
            self.store.put_attempt(self._touch(attempt))
            await self._cancel_hold((attempt.hold or {}).get("booking_id"))
            tx = self.store.get_tx(attempt.transaction_id)
            if tx and tx.status in {"awaiting_payment", "payment_processing"}:
                tx.status = "selected"
                self.store.put_tx(self._touch(tx))
            return
        attempt.outcome = "needs_reconciliation"
        self.store.put_attempt(self._touch(attempt))

    def _mark_paid(self, attempt: PaymentAttempt, start_job: bool) -> None:
        """Kết quả thanh toán và công việc hoàn tất ghi trong cùng một lần ghi."""
        tx = self.store.get_tx(attempt.transaction_id)
        now = self.clock()
        db = self.store.db
        db.execute("BEGIN IMMEDIATE")
        try:
            self.store.put_attempt(self._touch(attempt))
            if tx is not None and tx.status not in {"ticketed", "approved", "paid_unfulfilled"}:
                tx.status = "paid_processing"
                self.store.put_tx(self._touch(tx))
            if start_job and tx is not None:
                self.store.create_job(
                    FulfilmentJob(
                        job_id="job_" + _letters(16),
                        transaction_id=tx.transaction_id,
                        attempt_id=attempt.attempt_id,
                        kind="flight_ticket" if tx.domain == "flight" else "moving_approve",
                        created_at=now,
                        updated_at=now,
                    )
                )
            db.execute("COMMIT")
        except BaseException:
            db.execute("ROLLBACK")
            raise
        self.kick()

    async def tester_paid(self, user_id: str, attempt_id: str) -> dict:
        if not self.tester_enabled_for(user_id):
            raise CheckoutError(403, "Không có quyền đánh dấu thanh toán.")
        attempt = self._owned_attempt(user_id, attempt_id)
        async with self._lock(attempt.transaction_id):
            attempt = self.store.get_attempt(attempt_id)
            if attempt.outcome != "awaiting_payment":
                raise CheckoutError(409, "Chỉ đánh dấu được lần thanh toán đang chờ.")
            if attempt.expires_at is None or attempt.expires_at <= self.clock():
                raise CheckoutError(409, "Lần thanh toán đã hết hạn, không đánh dấu được. Hãy kiểm tra để đối soát.")
            attempt.tester_mark = {"by": user_id, "at": self.clock().isoformat()}
            attempt.outcome = "paid_simulated"
            self._mark_paid(attempt, start_job=True)
            return self.attempt_view(attempt)

    def tester_enabled_for(self, user_id: str) -> bool:
        s = self.settings
        return s.tester_confirm_enabled and not s.production and user_id in s.tester_user_ids

    # ------------------------------------------------------------------ hoàn tất (bền, chạy một lần)

    def kick(self) -> None:
        """Run new fulfilment now, beside the worker: a paid hold must not wait behind slow reconciliation reads."""
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        task = loop.create_task(self.run_jobs())
        # Keep a reference until it finishes, as the asyncio docs require, so stop() can await it.
        self._jobs.add(task)
        task.add_done_callback(self._job_done)

    def _job_done(self, task: asyncio.Task) -> None:
        self._jobs.discard(task)
        if not task.cancelled() and (error := task.exception()) is not None:
            logger.error("checkout fulfilment failed", exc_info=error)

    async def reconcile_open(self) -> None:
        """Đối soát lần thanh toán còn mở dù người dùng không bấm Kiểm tra, để trả tiền xong là xuất vé
        trước khi giữ chỗ hết hạn. Giãn dần giữa các lần tra cổng; chạy trong khóa giao dịch như `check`."""
        now = self.clock()
        open_ids = set()
        for attempt in self.store.open_attempts():
            open_ids.add(attempt.attempt_id)
            due, delay = self._next_check.get(attempt.attempt_id, (now, self.settings.reconcile_min))
            if due > now:
                continue
            async with self._lock(attempt.transaction_id):
                fresh = self.store.get_attempt(attempt.attempt_id)
                if fresh is None or fresh.outcome not in OPEN:
                    continue
                try:
                    await self._sync(fresh)
                except Exception:  # pragma: no cover - ghi log, lần sau thử lại
                    logger.exception("checkout reconcile failed")
            after = self.store.get_attempt(attempt.attempt_id) or attempt
            self._next_check[attempt.attempt_id] = self._next_reconcile(after, self.clock(), delay)
        for attempt_id in set(self._next_check) - open_ids:
            self._next_check.pop(attempt_id, None)

    def _next_reconcile(self, attempt: PaymentAttempt, now: datetime, delay: timedelta) -> tuple[datetime, timedelta]:
        """Lần tra kế tiếp: đều và ngắn khi còn trả được (không vượt hạn), giãn dần khi đã quá hạn."""
        s = self.settings
        deadline = attempt.expires_at
        if deadline is not None and now < deadline:
            due = now + s.reconcile_active
            final = deadline - s.reconcile_final_margin
            if now < final < due:
                due = final  # một lần tra sát hạn: trả ở giây cuối vẫn kịp xuất vé nếu cổng đã ghi nhận
            elif due >= deadline:
                due = deadline
            return due, s.reconcile_min
        return now + delay, min(delay * 2, s.reconcile_max)

    async def run_jobs(self) -> None:
        for job in self.store.pending_jobs():
            async with self._lock(job.transaction_id):
                fresh = self.store.job_for(job.transaction_id)
                if fresh is None or fresh.status != "pending":
                    continue
                await self._run_job(fresh)

    async def _run_job(self, job: FulfilmentJob) -> None:
        tx = self.store.get_tx(job.transaction_id)
        attempt = self.store.get_attempt(job.attempt_id)
        if tx is None or attempt is None:
            logger.error("checkout fulfilment lost its records transaction_id=%s", job.transaction_id)
            job.status, job.last_error = "failed", "missing transaction"
            self.store.put_job(self._touch(job))
            return
        job.tries += 1
        if job.kind == "moving_approve":
            tx.status = "approved"
            tx.details["approved_at"] = self.clock().isoformat()
            self.store.put_tx(self._touch(tx))
            job.status, job.last_error = "done", ""
            self.store.put_job(self._touch(job))
            return
        booking_id = (attempt.hold or {}).get("booking_id")
        try:
            booking = await self.flight.call("confirm_booking", {"booking_ref": booking_id})
        except ToolCallError as exc:
            if (exc.transport or exc.retryable) and job.tries < self.settings.job_retry_limit:
                logger.warning(
                    "checkout fulfilment will retry transaction_id=%s code=%s tries=%s",
                    job.transaction_id,
                    exc.code,
                    job.tries,
                )
                job.last_error = exc.code
                self.store.put_job(self._touch(job))
                return
            # Đã trả nhưng không xuất được vé (giữ chỗ hết hạn...): giữ sự kiện thanh toán, cần xử lý.
            logger.error("checkout paid but unfulfilled transaction_id=%s code=%s", job.transaction_id, exc.code)
            tx.status = "paid_unfulfilled"
            tx.details["fulfilment_issue"] = (
                "Đã thanh toán nhưng chưa xuất được vé mô phỏng; cần giữ chỗ lại hoặc hoàn tiền thủ công."
            )
            self.store.put_tx(self._touch(tx))
            job.status, job.last_error = "failed", exc.code
            self.store.put_job(self._touch(job))
            return
        tx.status = "ticketed"
        tx.details["ticket"] = {
            "pnr": booking.get("pnr"),
            "ticket_count": len(booking.get("ticket_numbers") or []),
            "simulated": True,
        }
        self.store.put_tx(self._touch(tx))
        job.status, job.last_error = "done", ""
        self.store.put_job(self._touch(job))

    async def start(self, interval: float = 5.0) -> None:
        """Đối soát lần thanh toán còn mở, chạy tiếp công việc dở khi khởi động và quét định kỳ (một worker)."""

        async def loop():
            while not self._stopping.is_set():
                try:
                    await self.reconcile_open()
                    await self.run_jobs()
                except Exception:  # pragma: no cover - log và chạy tiếp vòng sau
                    logger.exception("checkout job loop failed")
                with suppress(TimeoutError):
                    await asyncio.wait_for(self._stopping.wait(), self.seconds_until_next(interval))

        self._worker = asyncio.create_task(loop())

    def seconds_until_next(self, interval: float) -> float:
        """Ngủ tới lần đối soát gần nhất đã hẹn (vd. lần tra sát hạn giữ chỗ), không quá `interval`."""
        now = self.clock()
        wait = interval
        if self._next_check:
            earliest = min(due for due, _ in self._next_check.values())
            wait = min(wait, (earliest - now).total_seconds())
        return max(wait, 0.05)

    async def stop(self) -> None:
        """Let the current pass and started fulfilment finish, so a provider call is never cut off mid-request."""
        self._stopping.set()
        if self._worker:
            await self._worker
        await asyncio.gather(*self._jobs, return_exceptions=True)  # failures are logged by _job_done

    # ------------------------------------------------------------------ nhà (người dùng tự báo, app không thu tiền)

    def viewing_slots(self, now: datetime | None = None) -> list[str]:
        s = self.settings
        local = (now or self.clock()).astimezone(timezone_vn())
        slots = []
        for day in range(s.viewing_days):
            current = local.date() + timedelta(days=day)
            minute = s.viewing_start_hour * 60
            while minute + s.viewing_slot_minutes <= s.viewing_end_hour * 60:
                moment = datetime.combine(current, time(minute // 60, minute % 60), tzinfo=timezone_vn())
                if moment > local:
                    slots.append(moment.isoformat())
                minute += s.viewing_slot_minutes
        return slots

    def _housing_tx(self, user_id: str, thread_id: str, values: dict) -> ServiceTransaction:
        listing_id = self._selected(values, "property")
        if not listing_id:
            raise CheckoutError(409, "Hãy chọn căn nhà trước.")
        current = self.store.current_tx(user_id, thread_id, f"housing:{listing_id}")
        if current is not None:
            return current
        found = self._find_row(values, AgentName.PROPERTY, listing_id, ("candidates",))
        row = found[2] if found else ((values.get("selections") or {}).get("property") or {})
        rent = row.get("price_vnd")
        tx = self._new_tx(
            user_id=user_id,
            thread_id=thread_id,
            logical_key=f"housing:{listing_id}",
            domain="property",
            task_id=found[0] if found else "",
            option_id=listing_id,
            status="selected",
            price_vnd=int(rent) if rent is not None else None,
            price_scope={"kind": "rent", "currency": "VND", "period": "month"},
            price_source="Tin đăng",
            amount_kind="monthly",
            payee="Chủ nhà (trả trực tiếp, ngoài app)",
            mode="user_reported",
            title=row.get("title") or "Căn đã chọn",
            lines=[{"label": row.get("address") or ""}],
        )
        self.store.put_tx(tx)
        return tx

    def housing_viewing(self, user_id: str, thread_id: str, values: dict, slot: str) -> dict:
        tx = self._housing_tx(user_id, thread_id, values)
        if tx.status in {"agreed", "reported_paid"}:
            raise CheckoutError(409, "Căn này đã báo thỏa thuận; không đổi lịch xem được.")
        if slot not in set(self.viewing_slots()):
            raise CheckoutError(422, "Khung giờ không hợp lệ hoặc đã qua. Hãy chọn khung khác.")
        tx.status = "viewing_scheduled"
        tx.details["viewing"] = {"slot": slot, "test_mode": True, "confirmed_by": "user"}
        tx.mode = "simulated"
        self.store.put_tx(self._touch(tx))
        return self.transaction_view(tx, values=values)

    def housing_agreement(
        self,
        user_id: str,
        thread_id: str,
        values: dict,
        agreed: bool,
        deposit_vnd: int | None,
        rent_vnd: int | None,
        move_in: str | None,
    ) -> dict:
        tx = self._housing_tx(user_id, thread_id, values)
        if tx.status not in {"viewing_scheduled", "agreed", "not_agreed"}:
            raise CheckoutError(409, "Hãy đặt lịch xem nhà trước khi báo kết quả.")
        if tx.status == "reported_paid":
            raise CheckoutError(409, "Đã báo trả cho chủ nhà; không đổi được thỏa thuận.")
        if not agreed:
            tx.status = "not_agreed"
            tx.details.pop("agreement", None)
        else:
            if not deposit_vnd or deposit_vnd <= 0 or not rent_vnd or rent_vnd <= 0:
                raise CheckoutError(422, "Hãy nhập tiền cọc và tiền thuê hằng tháng (số dương).")
            if move_in:
                try:
                    date.fromisoformat(move_in)
                except ValueError:
                    raise CheckoutError(422, "Ngày dọn vào chưa hợp lệ.") from None
            tx.status = "agreed"
            tx.price_vnd = int(rent_vnd)
            tx.details["agreement"] = {
                "deposit_vnd": int(deposit_vnd),
                "first_month_vnd": int(rent_vnd),
                "monthly_rent_vnd": int(rent_vnd),
                "move_in": move_in,
                "suggested_deposit_vnd": int(rent_vnd),
                "self_reported": True,
            }
        tx.mode = "user_reported"
        self.store.put_tx(self._touch(tx))
        return self.transaction_view(tx, values=values)

    def housing_paid(self, user_id: str, thread_id: str, values: dict, amount_vnd: int, paid_on: str) -> dict:
        tx = self._housing_tx(user_id, thread_id, values)
        if tx.status != "agreed":
            raise CheckoutError(409, "Hãy báo thỏa thuận thuê trước khi báo đã trả.")
        if amount_vnd <= 0:
            raise CheckoutError(422, "Số tiền đã trả phải là số dương.")
        try:
            date.fromisoformat(paid_on)
        except ValueError:
            raise CheckoutError(422, "Ngày trả chưa hợp lệ.") from None
        tx.status = "reported_paid"
        tx.details["reported_payment"] = {"amount_vnd": int(amount_vnd), "paid_on": paid_on, "verified": False}
        self.store.put_tx(self._touch(tx))
        return self.transaction_view(tx, values=values)

    # ------------------------------------------------------------------ hiển thị

    def attempt_view(self, attempt: PaymentAttempt | None) -> dict:
        if attempt is None:
            return {}
        data = attempt.model_dump(mode="json", exclude={"idempotency_key", "passenger_ref", "user_id"})
        data["has_qr"] = bool(attempt.qr_code)
        data.pop("qr_code", None)
        data["tester_marked"] = attempt.tester_mark is not None
        data.pop("tester_mark", None)
        return data

    def transaction_view(self, tx: ServiceTransaction, values: dict | None = None) -> dict:
        attempts = self.store.attempts_for(tx.transaction_id)
        latest = attempts[-1] if attempts else None
        job = self.store.job_for(tx.transaction_id)
        data = tx.model_dump(mode="json", exclude={"user_id"})
        data.update(
            payload_hash=self.payload_hash(tx),
            attempt=self.attempt_view(latest),
            paid_vnd=sum(a.amount_vnd for a in attempts if a.outcome in PAID),
            tester_paid=any(a.outcome == "paid_simulated" for a in attempts),
            job=job.model_dump(mode="json", include={"status", "tries", "last_error"}) if job else None,
            reminders=self.reminders(tx, values) if values is not None else [],
        )
        return data

    def reminders(self, tx: ServiceTransaction, values: dict) -> list[str]:
        """Chỉ nhắc, không chặn (D8)."""
        if tx.domain not in {"flight", "relocation"}:
            return []
        housing = [t for t in self.store.list_tx(tx.user_id, tx.thread_id) if t.domain == "property"]
        has_home = bool(self._selected(values, "property")) or bool(housing)
        notes = []
        agreed = next((t for t in housing if t.status in {"agreed", "reported_paid"}), None)
        if has_home and agreed is None:
            notes.append(
                "Bạn chưa báo đã thỏa thuận nhà. Nếu nhà không thành, vé hoặc xe có thể phải hủy theo điều kiện "
                "của bên cung cấp."
            )
        move_in = ((agreed.details.get("agreement") or {}).get("move_in")) if agreed else None
        moving = next((t for t in self.store.list_tx(tx.user_id, tx.thread_id) if t.domain == "relocation"), None)
        move_date = (moving.details.get("move_date") if moving else None) or (
            tx.details.get("move_date") if tx.domain == "relocation" else None
        )
        if tx.domain == "relocation" and move_in and move_date and move_date < move_in:
            notes.append(f"Ngày chuyển ({move_date}) trước ngày dọn vào ({move_in}).")
        if tx.domain == "flight":
            fly = tx.details.get("flight_date")
            back = next((leg for leg in tx.legs if leg.get("direction") == "return"), None)
            if fly and move_date and fly > move_date:
                notes.append(f"Chiều đi ({fly}) sau ngày chuyển đồ ({move_date}).")
            if back and move_in and (back.get("depart_at") or "")[:10] < move_in:
                notes.append(f"Chiều về ({(back.get('depart_at') or '')[:10]}) trước ngày dọn vào ({move_in}).")
        return notes

    def has_open_attempt(self, user_id: str, thread_id: str) -> bool:
        return any(
            a.outcome in OPEN
            for tx in self.store.list_tx(user_id, thread_id)
            for a in self.store.attempts_for(tx.transaction_id)
        )

    def thread_view(self, user_id: str, thread_id: str, values: dict) -> dict:
        txs = [self.transaction_view(t, values=values) for t in self.store.list_tx(user_id, thread_id)]
        totals = {
            "paid_vnd": 0,
            "paid_tester_vnd": 0,
            "pending_vnd": 0,
            "due_landlord_vnd": 0,
            "reported_landlord_vnd": 0,
            "monthly_vnd": 0,
        }
        for t in txs:
            attempt = t["attempt"] or {}
            if t["domain"] == "property":
                agreement = t["details"].get("agreement") or {}
                if t["status"] == "agreed":
                    totals["due_landlord_vnd"] += agreement.get("deposit_vnd", 0) + agreement.get("first_month_vnd", 0)
                if t["status"] == "reported_paid":
                    totals["reported_landlord_vnd"] += (t["details"].get("reported_payment") or {}).get("amount_vnd", 0)
                if t["status"] in {"agreed", "reported_paid"}:
                    totals["monthly_vnd"] += agreement.get("monthly_rent_vnd", 0)
                continue
            totals["paid_vnd"] += t["paid_vnd"]
            if t["tester_paid"]:
                totals["paid_tester_vnd"] += t["paid_vnd"]
            if attempt.get("outcome") in {"awaiting_payment", "needs_reconciliation", "processing"}:
                totals["pending_vnd"] += attempt.get("amount_vnd", 0)
        return {
            "transactions": txs,
            "totals": totals,
            "tester": self.tester_enabled_for(user_id),
            "viewing_slots": self.viewing_slots(),
        }


def timezone_vn():
    from datetime import timezone

    return timezone(VN_OFFSET)


def _parse_dt(value) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else None


def _leg_label(leg: dict) -> str:
    when = (leg.get("depart_at") or "")[:16].replace("T", " ")
    prefix = "Chiều về" if leg.get("direction") == "return" else "Chiều đi"
    return f"{prefix}: {leg.get('carrier') or ''} {leg.get('origin') or ''} → {leg.get('destination') or ''} · {when}".strip()
