"""Chọn nhiều căn, hẹn xem và chốt (docs/review/housing-viewing-design.md). Không gọi LLM.

Mỗi căn đã chọn là một giao dịch `housing:{listing_id}` trong kho checkout; trạng thái là nguồn sự thật
cho lịch, kết quả buổi xem và thỏa thuận. Checkpoint chỉ giữ danh sách căn (ID, nhãn) để agent biết.
Mọi ngưỡng lấy từ cấu hình; không có hằng số nghiệp vụ trong code.
"""

from __future__ import annotations

import asyncio
import hashlib
import math
import time as monotonic_time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from typing import Any, Literal
from uuid import uuid4
from zoneinfo import ZoneInfo

from relohome_agent.agents.common import utcnow
from relohome_agent.checkout.models import OPEN, CheckoutError, ServiceTransaction
from relohome_agent.checkout.service import _letters
from relohome_agent.checkout.store import CheckoutStore
from relohome_agent.config import get_settings
from relohome_agent.services.adapters.mcp import ToolCallError

# Trạng thái của một căn đã chọn (mục 5 thiết kế). `visit_due` được suy ra từ lịch đã qua giờ.
ACTIVE = frozenset({"selected", "viewing_scheduled", "visited", "backup", "agreed", "reported_paid"})
DECIDED = frozenset({"agreed", "reported_paid"})
VisitOutcome = Literal["met_agreed", "met_undecided", "met_rejected", "missed"]
PAID_MOVING = frozenset({"approved", "paid_processing", "paid_unfulfilled"})


@dataclass
class ViewingSettings:
    max_selected: int
    slot_minutes: int
    day_start: time
    day_end: time
    window_days: int
    lead: timedelta
    travel_buffer: timedelta
    min_gap: timedelta
    daily_soft_limit: int
    route_profile: str
    route_cities: tuple[str, ...]
    route_cache_seconds: int
    same_place_meters: int
    deposit_suggested_months: float
    timezone: ZoneInfo
    proposal_days: int = 7
    visit_anytime: bool = False  # chỉ môi trường test

    @classmethod
    def from_services(cls, s) -> ViewingSettings:
        def clock(value: str) -> time:
            hours, minutes = value.split(":")
            return time(int(hours), int(minutes))

        return cls(
            max_selected=s.housing_max_selected,
            slot_minutes=s.housing_viewing_slot_minutes,
            day_start=clock(s.housing_viewing_day_start),
            day_end=clock(s.housing_viewing_day_end),
            window_days=s.housing_viewing_window_days,
            lead=timedelta(minutes=s.housing_viewing_lead_minutes),
            travel_buffer=timedelta(minutes=s.housing_viewing_travel_buffer_minutes),
            min_gap=timedelta(minutes=s.housing_viewing_min_gap_minutes),
            daily_soft_limit=s.housing_viewing_daily_soft_limit,
            route_profile=s.housing_viewing_route_profile,
            route_cities=tuple(c.strip() for c in s.housing_viewing_route_cities.split(",") if c.strip()),
            route_cache_seconds=s.housing_viewing_route_cache_seconds,
            same_place_meters=s.housing_same_place_meters,
            deposit_suggested_months=s.housing_deposit_suggested_months,
            timezone=ZoneInfo(s.app_timezone),
            proposal_days=s.housing_viewing_proposal_days,
            visit_anytime=s.housing_viewing_test_visit_anytime and get_settings().app_env != "production",
        )


def distance_m(a: dict, b: dict) -> float | None:
    try:
        lat1, lng1, lat2, lng2 = (math.radians(float(v)) for v in (a["lat"], a["lng"], b["lat"], b["lng"]))
    except (KeyError, TypeError, ValueError):
        return None
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    return 2 * 6_371_000 * math.asin(math.sqrt(h))


def _parse(value: Any) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(str(value))
    except (TypeError, ValueError):
        return None
    return parsed if parsed.tzinfo else None


@dataclass
class ViewingService:
    store: CheckoutStore
    settings: ViewingSettings
    location: Any = None  # McpToolClient đọc của Location: get_housing, calculate_route_between_entities
    clock: Callable[[], datetime] = utcnow
    _routes: dict[tuple, tuple[float, float | None]] = field(default_factory=dict)
    _route_city: dict[str, str] = field(default_factory=dict)

    # ------------------------------------------------------------------ đọc

    def items(self, user_id: str, thread_id: str) -> list[ServiceTransaction]:
        txs = [t for t in self.store.list_tx(user_id, thread_id) if t.domain == "property"]
        return sorted(txs, key=lambda t: (t.details.get("selection") or {}).get("order", 0))

    def active(self, user_id: str, thread_id: str) -> list[ServiceTransaction]:
        return [t for t in self.items(user_id, thread_id) if t.status in ACTIVE]

    def _item(self, user_id: str, thread_id: str, listing_id: str) -> ServiceTransaction:
        tx = self.store.current_tx(user_id, thread_id, f"housing:{listing_id}")
        if tx is None or tx.status not in ACTIVE:
            raise CheckoutError(404, "Căn này không nằm trong các căn đang chọn.", "not_selected")
        return tx

    def status_of(self, tx: ServiceTransaction, now: datetime | None = None) -> str:
        # Ghi kết quả được từ giờ bắt đầu buổi xem: gặp chủ nhà xong có thể xác nhận ngay.
        start = _parse((tx.details.get("viewing") or {}).get("slot"))
        if (
            tx.status == "viewing_scheduled"
            and start
            and (self.settings.visit_anytime or start <= (now or self.clock()))
        ):
            return "visit_due"
        return tx.status

    def projection(self, user_id: str, thread_id: str) -> list[dict]:
        """Phần agent cần biết: căn nào đang được cân nhắc. Không có lịch hay số tiền."""
        return [
            {
                "listing_id": t.option_id,
                "label": t.title,
                "task_id": t.task_id,
                "decided": t.status in DECIDED,
            }
            for t in self.active(user_id, thread_id)
        ]

    # ------------------------------------------------------------------ khung giờ

    def slots(self, now: datetime | None = None) -> list[str]:
        s = self.settings
        local_now = (now or self.clock()).astimezone(s.timezone)
        earliest = local_now + s.lead
        step = timedelta(minutes=s.slot_minutes)
        result = []
        for offset in range(s.window_days):
            day = local_now.date() + timedelta(days=offset)
            start = datetime.combine(day, s.day_start, tzinfo=s.timezone)
            close = datetime.combine(day, s.day_end, tzinfo=s.timezone)
            while start <= close:
                if start >= earliest:
                    result.append(start.isoformat())
                start += step
        return result

    # ------------------------------------------------------------------ chọn

    def select(self, user_id: str, thread_id: str, task_id: str, row: dict) -> ServiceTransaction:
        listing_id = str(row["id"])
        active = self.active(user_id, thread_id)
        if any(t.status in DECIDED for t in active):
            raise CheckoutError(409, "Bạn đã chốt một căn. Báo thỏa thuận không thành trước khi chọn căn khác.")
        existing = self.store.current_tx(user_id, thread_id, f"housing:{listing_id}")
        if existing is not None and existing.status in ACTIVE:
            return existing
        if len(active) >= self.settings.max_selected:
            raise CheckoutError(
                409,
                f"Bạn đang chọn đủ {self.settings.max_selected} căn. Bỏ chọn một căn trước khi chọn thêm.",
                "selection_full",
            )
        now = self.clock()
        order = max(
            ((t.details.get("selection") or {}).get("order", 0) for t in self.items(user_id, thread_id)), default=0
        )
        snapshot = {
            k: row.get(k)
            for k in ("title", "address", "price_vnd", "deposit_vnd", "lat", "lng", "location_accuracy", "city")
        }
        details = {
            "selection": {"order": order + 1, "selected_at": now.isoformat()},
            "snapshot": {**snapshot, "read_at": now.isoformat()},
        }
        if existing is not None:  # chọn lại căn đã bỏ: giữ lịch sử
            existing.status = "selected"
            existing.task_id = task_id
            existing.details = {**existing.details, **details}
            existing.details.pop("viewing", None)
            existing.details.pop("visit_outcome", None)
            existing.details.pop("visit_review", None)
            self.store.put_tx(self._touch(existing))
            return existing
        tx = ServiceTransaction(
            transaction_id="tx_" + _letters(16),
            user_id=user_id,
            thread_id=thread_id,
            logical_key=f"housing:{listing_id}",
            domain="property",
            task_id=task_id,
            option_id=listing_id,
            status="selected",
            price_vnd=row.get("price_vnd"),
            price_scope={"kind": "rent", "currency": "VND", "period": "month"},
            price_source="Tin đăng",
            price_read_at=now,
            amount_kind="monthly",
            payee="Chủ nhà (trả trực tiếp, ngoài app)",
            mode="user_reported",
            title=row.get("title") or "Căn đã chọn",
            lines=[{"label": row.get("address") or ""}],
            details=details,
            created_at=now,
            updated_at=now,
        )
        self.store.put_tx(tx)
        return tx

    def selector(self, user_id: str, thread_id: str, task_id: str, row: dict) -> list[dict]:
        """Cho Intake: chọn căn qua chat. Lỗi nghiệp vụ trả về ValueError để graph không phụ thuộc module này."""
        try:
            self.select(user_id, thread_id, task_id, row)
        except CheckoutError as exc:
            raise ValueError(exc.message) from None
        return self.projection(user_id, thread_id)

    def unselector(self, user_id: str, thread_id: str, listing_id: str) -> list[dict]:
        """Cho Intake: bỏ một căn qua chat. Lỗi nghiệp vụ trả về ValueError."""
        try:
            self.unselect(user_id, thread_id, listing_id)
        except CheckoutError as exc:
            raise ValueError(exc.message) from None
        return self.projection(user_id, thread_id)

    def unselect(self, user_id: str, thread_id: str, listing_id: str) -> None:
        tx = self._item(user_id, thread_id, listing_id)
        if tx.status in DECIDED:
            raise CheckoutError(409, "Căn này đã chốt. Báo thỏa thuận không thành trước nếu muốn bỏ.")
        self._drop(tx, "user")

    def _drop(self, tx: ServiceTransaction, reason: str) -> None:
        if tx.details.get("viewing"):
            tx.details.setdefault("viewing_history", []).append({**tx.details["viewing"], "cancelled": reason})
            tx.details.pop("viewing", None)
        tx.status = "dropped"
        tx.details["dropped"] = {"reason": reason, "at": self.clock().isoformat()}
        self.store.put_tx(self._touch(tx))

    # ------------------------------------------------------------------ hẹn xem

    async def schedule(self, user_id: str, thread_id: str, listing_id: str, slot: str) -> dict:
        tx = self._item(user_id, thread_id, listing_id)
        if tx.status not in {"selected", "viewing_scheduled", "visited", "backup"}:
            raise CheckoutError(409, "Không hẹn xem được ở trạng thái hiện tại của căn.")
        if tx.status == "visited":
            raise CheckoutError(409, "Bạn đã xem căn này. Chốt hoặc bỏ chọn căn.")
        start = _parse(slot)
        if start is None or slot not in set(self.slots()):
            raise CheckoutError(
                422, "Khung giờ không hợp lệ, đã qua hoặc quá sát giờ. Hãy chọn khung khác.", "bad_slot"
            )
        start = start.astimezone(self.settings.timezone)
        length = timedelta(minutes=self.settings.slot_minutes)
        others = [
            t
            for t in self.active(user_id, thread_id)
            if t.transaction_id != tx.transaction_id and (t.details.get("viewing") or {}).get("slot")
        ]
        booked = sorted(
            ((_parse(t.details["viewing"]["slot"]).astimezone(self.settings.timezone), t) for t in others),
            key=lambda pair: pair[0],
        )
        for other_start, other in booked:
            if other_start < start + length and start < other_start + length:
                raise CheckoutError(409, f"Trùng giờ với lịch xem {other.title}.", "overlap")
        same_day = [(s, t) for s, t in booked if s.date() == start.date()]
        before = next((pair for pair in reversed(same_day) if pair[0] < start), None)
        after = next((pair for pair in same_day if pair[0] > start), None)
        legs = await asyncio.gather(
            self._needed_gap(before[1].option_id, listing_id) if before else _none(),
            self._needed_gap(listing_id, after[1].option_id) if after else _none(),
        )
        if before and start < before[0] + length + legs[0][0]:
            earliest = before[0] + length + legs[0][0]
            raise CheckoutError(
                409,
                f"Không kịp đi từ {before[1].title} ({legs[0][1]}). Giờ sớm nhất: {earliest:%H:%M}.",
                "not_reachable",
            )
        if after and after[0] < start + length + legs[1][0]:
            raise CheckoutError(
                409,
                f"Không kịp tới lịch {after[1].title} lúc {after[0]:%H:%M} ({legs[1][1]}). Hãy chọn giờ sớm hơn.",
                "not_reachable",
            )
        if tx.details.get("viewing"):
            tx.details.setdefault("viewing_history", []).append({**tx.details["viewing"], "rescheduled": True})
        tx.details["viewing"] = {
            "slot": start.isoformat(),
            "end": (start + length).isoformat(),
            "test_mode": True,
            "confirmed_by": "user",
            "travel": {"from_previous": legs[0][1] if before else None, "to_next": legs[1][1] if after else None},
        }
        if tx.status != "backup":
            tx.status = "viewing_scheduled"
        self.store.put_tx(self._touch(tx))
        return self.item_view(tx)

    def cancel(self, user_id: str, thread_id: str, listing_id: str) -> dict:
        tx = self._item(user_id, thread_id, listing_id)
        if not tx.details.get("viewing"):
            raise CheckoutError(409, "Căn này chưa có lịch hẹn.")
        tx.details.setdefault("viewing_history", []).append({**tx.details["viewing"], "cancelled": "user"})
        tx.details.pop("viewing", None)
        if tx.status == "viewing_scheduled":
            tx.status = "selected"
        self.store.put_tx(self._touch(tx))
        return self.item_view(tx)

    async def _needed_gap(self, origin: str, destination: str) -> tuple[timedelta, str]:
        seconds = await self.travel_seconds(origin, destination)
        if seconds is None:
            return self.settings.min_gap, "chưa tính được thời gian đi"
        return timedelta(seconds=seconds) + self.settings.travel_buffer, f"đi khoảng {math.ceil(seconds / 60)} phút"

    async def travel_seconds(self, origin: str, destination: str) -> float | None:
        if self.location is None or origin == destination:
            return 0 if origin == destination else None
        key = (origin, destination, self.settings.route_profile)
        cached = self._routes.get(key)
        if cached and cached[0] > monotonic_time.monotonic():
            return cached[1]
        known = self._route_city.get(origin) or self._route_city.get(destination)
        cities = [known] if known else list(self.settings.route_cities)
        seconds = None
        for city in cities:
            try:
                result = await self.location.call(
                    "calculate_route_between_entities",
                    {
                        "city": city,
                        "origin": {"type": "housing", "listing_id": origin},
                        "destination": {"type": "housing", "listing_id": destination},
                        "profile": self.settings.route_profile,
                    },
                )
            except ToolCallError:
                continue  # ngoài vùng của thành phố này, không có đường, hoặc dịch vụ lỗi
            seconds = ((result or {}).get("route") or {}).get("duration_seconds")
            if seconds is not None:
                self._route_city[origin] = self._route_city[destination] = city
                break
        self._routes[key] = (monotonic_time.monotonic() + self.settings.route_cache_seconds, seconds)
        return seconds

    # ------------------------------------------------------------------ sau buổi xem

    def visit(
        self, user_id: str, thread_id: str, listing_id: str, outcome: VisitOutcome, *, review: dict | None = None
    ) -> dict:
        tx = self._item(user_id, thread_id, listing_id)
        if tx.status not in {"viewing_scheduled", "visited", "backup"}:
            raise CheckoutError(
                409, "Không thể sửa kết quả xem căn đã chốt hoặc đã báo trả tiền.", "visit_state_conflict"
            )
        viewing = tx.details.get("viewing") or {}
        start = _parse(viewing.get("slot"))
        if start is None or (start > self.clock() and not self.settings.visit_anytime):
            raise CheckoutError(409, "Chỉ ghi kết quả từ giờ hẹn xem trở đi.", "visit_not_due")
        if review is not None:
            tx.details["visit_review"] = review
        tx.details.setdefault("viewing_history", []).append({**viewing, "outcome": outcome})
        if outcome == "missed":
            tx.details.pop("viewing", None)
            tx.details.pop("visit_outcome", None)
            if tx.status == "backup":
                tx.details["backup_from"] = "selected"
            else:
                tx.status = "selected"
        else:
            tx.details["visit_outcome"] = {"outcome": outcome, "at": self.clock().isoformat()}
            if outcome == "met_rejected":
                self.store.put_tx(self._touch(tx))
                self._drop(tx, "rejected_after_visit")
                return self.item_view(tx)
            if tx.status != "backup":
                tx.status = "visited"
            else:
                tx.details["backup_from"] = "visited"
        self.store.put_tx(self._touch(tx))
        return self.item_view(tx)

    # ------------------------------------------------------------------ chốt

    def begin_decision(
        self,
        user_id: str,
        thread_id: str,
        listing_id: str,
        keep_ids: list[str],
        form: dict,
        decision_key: str,
    ) -> dict:
        """Ghi ý định chốt trước mọi bước bên ngoài; gọi lại cùng khóa thì trả lại kế hoạch đã ghi."""
        normalized_form = {k: form.get(k) for k in ("rent_vnd", "deposit_vnd", "move_in")}
        keep = sorted(set(keep_ids))
        existing = self.store.get_decision(decision_key)
        if existing is not None:
            if (
                existing["user_id"] != user_id
                or existing["thread_id"] != thread_id
                or existing["listing_id"] != listing_id
            ):
                raise CheckoutError(409, "Mã chốt đã dùng cho thao tác khác.")
            if existing["form"] != normalized_form or existing["keep"] != keep:
                raise CheckoutError(
                    409, "Thông tin chốt đã đổi; không được dùng lại mã của yêu cầu cũ.", "decision_payload_mismatch"
                )
            self.validate_decision(existing)
            return existing
        tx = self._item(user_id, thread_id, listing_id)
        if tx.status != "visited":
            raise CheckoutError(409, "Chỉ chốt sau khi đã gặp chủ nhà ở buổi xem.", "not_visited")
        if any(t.status in DECIDED for t in self.active(user_id, thread_id)):
            raise CheckoutError(409, "Bạn đã chốt một căn khác.")
        rent, deposit = form.get("rent_vnd"), form.get("deposit_vnd")
        if not rent or rent <= 0 or not deposit or deposit <= 0:
            raise CheckoutError(422, "Hãy nhập tiền thuê hằng tháng và tiền cọc (số dương).")
        if form.get("move_in"):
            try:
                date.fromisoformat(form["move_in"])
            except ValueError:
                raise CheckoutError(422, "Ngày dọn vào chưa hợp lệ.") from None
        others = [t for t in self.active(user_id, thread_id) if t.option_id != listing_id]
        other_ids = {t.option_id for t in others}
        if not set(keep_ids) <= other_ids:
            raise CheckoutError(422, "Căn giữ lại phải là căn đang chọn.")
        decision = {
            "decision_key": decision_key,
            "user_id": user_id,
            "thread_id": thread_id,
            "listing_id": listing_id,
            "keep": keep,
            "drop": sorted(other_ids - set(keep_ids)),
            "form": normalized_form,
            "selection_fingerprint": self._selection_fingerprint(user_id, thread_id),
            "step": "planned",
        }
        self.store.insert_decision(decision)
        return self.store.get_decision(decision_key)

    def mark_decision(self, decision: dict, step: str) -> None:
        decision["step"] = step
        self.store.put_decision(decision)

    def _selection_fingerprint(self, user_id: str, thread_id: str) -> str:
        # Includes the complete consideration set, schedules and visit outcomes. A changed
        # set must not be cancelled by an intent recorded before the user's change.
        rows = sorted(self.active(user_id, thread_id), key=lambda tx: tx.transaction_id)
        return hashlib.sha256("\n".join(tx.model_dump_json() for tx in rows).encode()).hexdigest()

    def validate_decision(self, decision: dict) -> ServiceTransaction:
        user_id, thread_id = decision["user_id"], decision["thread_id"]
        tx = self.store.current_tx(user_id, thread_id, f"housing:{decision['listing_id']}")
        if tx is None:
            raise CheckoutError(409, "Căn của quyết định chốt không còn được chọn.", "decision_stale")
        owned = tx.status in DECIDED and tx.details.get("decision_key") == decision["decision_key"]
        if decision["step"] == "done" and not owned:
            raise CheckoutError(409, "Quyết định này đã được mở lại hoặc thay thế.", "decision_stale")
        if tx.status != "visited" and not owned:
            raise CheckoutError(409, "Trạng thái căn đã đổi; hãy xác nhận quyết định mới.", "decision_stale")
        if any(t.status in DECIDED and t.option_id != tx.option_id for t in self.active(user_id, thread_id)):
            raise CheckoutError(409, "Bạn đã chốt một căn khác.", "decision_stale")
        fingerprint = decision.get("selection_fingerprint")
        if not owned and fingerprint and fingerprint != self._selection_fingerprint(user_id, thread_id):
            raise CheckoutError(409, "Danh sách hoặc lịch xem đã đổi; hãy xác nhận quyết định mới.", "decision_stale")
        return tx

    def finish_decision(self, decision: dict) -> dict:
        # Reload durable intent, never trust a caller's stale copy. Store changes commit
        # together; graph selection is a separate durable step recovered by the API.
        recorded = self.store.get_decision(decision["decision_key"])
        if recorded is None or any(recorded[k] != decision[k] for k in ("user_id", "thread_id", "listing_id")):
            raise CheckoutError(409, "Không tìm thấy quyết định đã ghi.", "decision_stale")
        with self.store.transaction():
            return self._finish_decision(recorded)

    def _finish_decision(self, decision: dict) -> dict:
        user_id, thread_id = decision["user_id"], decision["thread_id"]
        tx = self.validate_decision(decision)
        if decision["step"] == "done":
            return self.item_view(tx)
        if tx.status not in DECIDED:
            form = decision["form"]
            tx.status = "agreed"
            tx.price_vnd = int(form["rent_vnd"])
            tx.details["agreement"] = {
                "deposit_vnd": int(form["deposit_vnd"]),
                "first_month_vnd": int(form["rent_vnd"]),
                "monthly_rent_vnd": int(form["rent_vnd"]),
                "move_in": form.get("move_in"),
                "self_reported": True,
            }
            tx.details["decision_key"] = decision["decision_key"]
            self.store.put_tx(self._touch(tx))
        for other in self.active(user_id, thread_id):
            if other.option_id in decision["drop"]:
                self._drop(other, "decided_other")
            elif other.option_id in decision["keep"] and other.status != "backup":
                other.details["backup_from"] = other.status
                other.status = "backup"
                self.store.put_tx(self._touch(other))
        self.mark_decision(decision, "done")
        return self.item_view(tx)

    def reopen(self, user_id: str, thread_id: str, *, rejected_report_key: str | None = None) -> str | None:
        """Thỏa thuận không thành: trả căn đã chốt về `visited`, căn dự phòng về trạng thái cũ."""
        chosen = next((t for t in self.active(user_id, thread_id) if t.status in DECIDED), None)
        if chosen is None:
            return None
        if chosen.status == "reported_paid":
            payment = chosen.details.get("reported_payment") or {}
            # Only the trusted gateway supplies a key, after reading the landlord's rejected report.
            # Matching the exact report prevents a concurrent new transfer from being reopened.
            if not rejected_report_key or rejected_report_key != (payment.get("report_key") or chosen.transaction_id):
                raise CheckoutError(409, "Bạn đã báo trả tiền cho chủ nhà; hãy tự xử lý với chủ nhà.", "already_paid")
            chosen.details.setdefault("reported_payment_history", []).append(chosen.details.pop("reported_payment"))
        history = chosen.details.setdefault("agreement_history", [])
        history.append({**(chosen.details.pop("agreement", None) or {}), "ended": self.clock().isoformat()})
        chosen.status = "visited"
        self.store.put_tx(self._touch(chosen))
        for other in self.active(user_id, thread_id):
            if other.status == "backup":
                other.status = other.details.pop("backup_from", None) or "selected"
                self.store.put_tx(self._touch(other))
        return chosen.option_id

    def report_paid(
        self, user_id: str, thread_id: str, amount_vnd: int, paid_on: str, report_key: str | None = None
    ) -> dict:
        chosen = next((t for t in self.active(user_id, thread_id) if t.status in {"agreed", "reported_paid"}), None)
        if chosen is None:
            raise CheckoutError(409, "Hãy chốt căn trước khi báo đã trả chủ nhà.")
        try:
            date.fromisoformat(paid_on)
        except ValueError:
            raise CheckoutError(422, "Ngày trả chưa hợp lệ.") from None
        previous = chosen.details.get("reported_payment")
        if previous and (not report_key or previous.get("report_key") == report_key):
            if previous["amount_vnd"] != int(amount_vnd) or previous["paid_on"] != paid_on:
                raise CheckoutError(409, "Khóa báo cáo đã dùng cho nội dung khác.")
            return self.item_view(chosen)
        if previous:
            chosen.details.setdefault("reported_payment_history", []).append(previous)
        chosen.status = "reported_paid"
        chosen.details["reported_payment"] = {
            "amount_vnd": int(amount_vnd),
            "paid_on": paid_on,
            "verified": False,
            "report_key": report_key or str(uuid4()),
        }
        self.store.put_tx(self._touch(chosen))
        return self.item_view(chosen)

    # ------------------------------------------------------------------ chuyển đồ khi chốt

    def moving_impact(self, user_id: str, thread_id: str, listing: dict, values: dict) -> str:
        """none | same | different_unpaid | different_paid (mục 6.6). Không chặn chuyển đồ tuần tự đang chờ."""
        destination = None
        for result in (values.get("task_results") or {}).values():
            if getattr(result, "agent", None) and result.agent.value == "relocation" and result.status == "done":
                destination = ((result.data or {}).get("route") or {}).get("destination") or destination
        paid = any(
            t.domain == "relocation"
            and (t.status in PAID_MOVING or any(a.outcome in OPEN for a in self.store.attempts_for(t.transaction_id)))
            for t in self.store.list_tx(user_id, thread_id)
        )
        if not destination:
            return "none"
        gap = distance_m(destination, listing)
        if gap is not None and gap <= self.settings.same_place_meters:
            return "same"
        return "different_paid" if paid else "different_unpaid"

    # ------------------------------------------------------------------ hiển thị

    def item_view(self, tx: ServiceTransaction) -> dict:
        details = tx.details
        return {
            "listing_id": tx.option_id,
            "transaction_id": tx.transaction_id,
            "task_id": tx.task_id,
            "title": tx.title,
            "status": self.status_of(tx),
            "snapshot": details.get("snapshot") or {},
            "viewing": details.get("viewing"),
            "visit_outcome": details.get("visit_outcome"),
            **({"visit_review": details["visit_review"]} if details.get("visit_review") else {}),
            "agreement": details.get("agreement"),
            "reported_payment": details.get("reported_payment"),
            "backup_from": details.get("backup_from"),
        }

    def warnings(self, items: list[ServiceTransaction], values: dict) -> list[dict]:
        """Chỉ nhắc, không chặn: số lịch/ngày, khác thành phố cùng ngày, trước giờ hạ cánh, sau ngày chuyển đồ."""
        notes = []
        by_day: dict[date, list[ServiceTransaction]] = {}
        for t in items:
            start = _parse((t.details.get("viewing") or {}).get("slot"))
            if start is not None:
                by_day.setdefault(start.astimezone(self.settings.timezone).date(), []).append(t)
        for day, group in by_day.items():
            if len(group) > self.settings.daily_soft_limit:
                notes.append({"code": "busy_day", "day": day.isoformat(), "count": len(group)})
            cities = {(t.details.get("snapshot") or {}).get("city") for t in group} - {None}
            if len(cities) > 1:
                notes.append({"code": "cities_same_day", "day": day.isoformat()})
        arrival, move_date = _plan_dates(values, self.settings.timezone)
        for t in items:
            start = _parse((t.details.get("viewing") or {}).get("slot"))
            if start is None:
                continue
            if arrival and start < arrival:
                notes.append({"code": "before_arrival", "listing_id": t.option_id})
            if move_date and start.astimezone(self.settings.timezone).date() > move_date:
                notes.append({"code": "after_move_date", "listing_id": t.option_id})
        return notes

    def thread_view(self, user_id: str, thread_id: str, values: dict) -> dict:
        items = self.items(user_id, thread_id)
        active = [t for t in items if t.status in ACTIVE]
        selected_home = _selected_home(values)
        legacy = None
        if selected_home and not any(t.option_id == selected_home for t in active):
            legacy = {"listing_id": selected_home, "status": "legacy_chosen"}
        return {
            "enabled": True,
            "items": [self.item_view(t) for t in active],
            "history": [self.item_view(t) for t in items if t.status not in ACTIVE],
            "legacy_chosen": legacy,
            "max_selected": self.settings.max_selected,
            "slot_minutes": self.settings.slot_minutes,
            "deposit_suggested_months": self.settings.deposit_suggested_months,
            "test_visit_anytime": self.settings.visit_anytime,
            "slots": self.slots(),
            "warnings": self.warnings(active, values),
            "moving_mode": values.get("moving_destination_mode"),
        }

    def delete_thread(self, user_id: str, thread_id: str) -> None:
        """Xóa hội thoại: bỏ căn đã chọn và lịch xem. Giao dịch có thanh toán (vé, chuyển đồ) giữ nguyên."""
        for tx in self.items(user_id, thread_id):
            self.store.delete_tx(tx.transaction_id)
        self.store.delete_decisions(user_id, thread_id)

    def _touch(self, tx: ServiceTransaction) -> ServiceTransaction:
        tx.updated_at = self.clock()
        return tx


async def _none():
    return (timedelta(0), "")


def _selected_home(values: dict) -> str | None:
    intake = values.get("intake")
    fact = intake.user_confirmed_facts.get("selected:property") if intake else None
    return str(fact.value) if fact else None


def _plan_dates(values: dict, zone: ZoneInfo) -> tuple[datetime | None, date | None]:
    """Giờ hạ cánh chiều đi của chuyến bay đã chọn và ngày chuyển đồ đã báo giá, nếu có."""
    arrival, move_date = None, None
    intake = values.get("intake")
    facts = intake.user_confirmed_facts if intake else {}
    chosen_flight = facts.get("selected:flight")
    for result in (values.get("task_results") or {}).values():
        agent = getattr(getattr(result, "agent", None), "value", None)
        if agent == "flight" and chosen_flight:
            for row in [*(result.data.get("offers") or []), *(result.data.get("return_options") or [])]:
                if row.get("id") == chosen_flight.value:
                    legs = row.get("legs") or [row]
                    arrival = _parse(legs[0].get("arrive_at")) or arrival
        if agent == "relocation":
            raw = (result.data.get("route") or {}).get("order_time")
            if isinstance(raw, int | float):
                move_date = datetime.fromtimestamp(raw, zone).date()
    return arrival, move_date
