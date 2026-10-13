import hashlib
import secrets
from collections import Counter
from collections.abc import Callable
from datetime import date, datetime, timedelta

from relohome_flight.catalog import fare_rules_for, get_airline
from relohome_flight.errors import BookingNotFoundError, BookingStateError, InvalidRequestError
from relohome_flight.schemas import Booking, CancelResult, FlightOffer, HoldBookingRequest, Passenger
from relohome_flight.settings import now_vn
from relohome_flight.storage import FlightDatabase

PNR_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
DEFAULT_TICKET_PREFIX = "999"
# Tuổi tính tại ngày bay: (tối thiểu, tối đa không bao gồm)
AGE_RULES = {"adult": (12, 200), "child": (2, 12), "infant": (0, 2)}


def age_on(birth: date, on_day: date) -> int:
    """Số tuổi tròn tại một ngày."""
    return on_day.year - birth.year - ((on_day.month, on_day.day) < (birth.month, birth.day))


def validate_passengers(offer: FlightOffer, passengers: list[Passenger]) -> None:
    """Số khách từng loại phải khớp offer và tuổi phải đúng loại khách."""
    counts = Counter(p.type for p in passengers)
    expected = offer.passengers
    if (counts["adult"], counts["child"], counts["infant"]) != (expected.adults, expected.children, expected.infants):
        raise InvalidRequestError(
            f"Offer dành cho {expected.adults} người lớn, {expected.children} trẻ em, {expected.infants} em bé "
            f"nhưng nhận {counts['adult']}/{counts['child']}/{counts['infant']}. Hãy tìm lại với đúng số khách."
        )
    flight_day = offer.segments[0].departure_time.date()
    for p in passengers:
        low, high = AGE_RULES[p.type]
        if not low <= age_on(p.date_of_birth, flight_day) < high:
            raise InvalidRequestError(
                f"Hành khách {p.last_name} {p.first_name}: tuổi tại ngày bay không phù hợp loại '{p.type}' "
                "(người lớn >= 12, trẻ em 2-11, em bé < 2)."
            )


def _dedupe_key(offer_id: str, passengers: list[Passenger], passenger_ref: str | None = None) -> str:
    if passenger_ref:
        return hashlib.sha256(f"{offer_id}#ref:{passenger_ref}".encode()).hexdigest()
    names = sorted(f"{p.last_name}|{p.first_name}|{p.date_of_birth}" for p in passengers)
    return hashlib.sha256("#".join([offer_id, *names]).encode()).hexdigest()


class BookingEngine:
    """Giả lập hệ thống đặt chỗ của hãng: giữ chỗ -> xuất vé -> hủy.

    Không có thanh toán thật. Luồng hai bước (hold rồi confirm) đảm bảo phía server
    luôn có một điểm dừng để người dùng duyệt trước khi "xuất vé".
    """

    def __init__(self, db: FlightDatabase, hold_minutes: int = 15, clock: Callable[[], datetime] = now_vn) -> None:
        self._db = db
        self._hold = timedelta(minutes=hold_minutes)
        self._clock = clock

    def hold(self, offer: FlightOffer, request: HoldBookingRequest) -> Booking:
        """Tạo booking HELD. Gọi lại với cùng offer và hành khách sẽ trả booking cũ (không giữ chỗ trùng)."""
        validate_passengers(offer, request.passengers)
        dedupe_key = _dedupe_key(offer.offer_id, request.passengers, request.passenger_ref)
        existing = self._find_active_hold(dedupe_key)
        if existing is not None:
            return existing
        now = self._clock()
        # Có passenger_ref: chỉ kiểm hành khách trong bộ nhớ rồi bỏ; booking lưu tham chiếu, không lưu tên/liên hệ.
        anonymous = bool(request.passenger_ref)
        booking = Booking(
            booking_id=f"bk_{secrets.token_hex(6)}",
            pnr=self._new_pnr(),
            status="HELD",
            offer=offer,
            passengers=[] if anonymous else request.passengers,
            contact=None if anonymous else request.contact,
            passenger_ref=request.passenger_ref,
            passenger_counts=offer.passengers,
            total_price=offer.total_price,
            currency=offer.currency,
            hold_expires_at=now + self._hold,
            created_at=now,
            updated_at=now,
        )
        with self._db.conn as conn:
            conn.execute(
                "INSERT INTO bookings VALUES (?, ?, ?, ?, ?)",
                (booking.booking_id, booking.pnr, booking.status, dedupe_key, booking.model_dump_json()),
            )
        return booking

    def confirm(self, booking_ref: str) -> Booking:
        """Xuất vé cho booking HELD còn hạn. Idempotent: booking đã xuất vé được trả lại nguyên trạng."""
        booking = self.get(booking_ref)
        if booking.status == "TICKETED":
            return booking
        if booking.status != "HELD":
            raise BookingStateError(
                f"Booking {booking.pnr} đang ở trạng thái {booking.status}, không thể xuất vé. "
                "Hãy tìm chuyến và giữ chỗ lại."
            )
        prefix = self._ticket_prefix(booking)
        count = len(booking.passengers) or (booking.passenger_counts.total if booking.passenger_counts else 0)
        tickets = [f"{prefix}-{secrets.randbelow(10**10):010d}" for _ in range(count)]
        updated = booking.model_copy(
            update={
                "status": "TICKETED",
                "ticket_numbers": tickets,
                "hold_expires_at": None,
                "updated_at": self._clock(),
            }
        )
        self._save(updated)
        return updated

    def get(self, booking_ref: str) -> Booking:
        """Tìm theo booking_id hoặc PNR; tự chuyển HELD quá hạn sang EXPIRED."""
        row = self._db.conn.execute(
            "SELECT data FROM bookings WHERE booking_id = ? OR pnr = ?", (booking_ref, booking_ref.upper())
        ).fetchone()
        if row is None:
            raise BookingNotFoundError(f"Không tìm thấy booking '{booking_ref}'.")
        booking = Booking.model_validate_json(row[0])
        if booking.status == "HELD" and booking.hold_expires_at and booking.hold_expires_at <= self._clock():
            booking = booking.model_copy(update={"status": "EXPIRED", "updated_at": self._clock()})
            self._save(booking)
        return booking

    def cancel(self, booking_ref: str, confirm: bool = False) -> CancelResult:
        """confirm=False chỉ báo phí hủy/tiền hoàn; confirm=True mới hủy thật."""
        booking = self.get(booking_ref)
        if booking.status == "EXPIRED":
            raise BookingStateError(f"Booking {booking.pnr} đã hết hạn giữ chỗ, không cần hủy.")
        if booking.status == "CANCELLED":
            return self._cancel_result(booking, True, "Booking đã được hủy trước đó.")
        fee, refund, note = self._cancel_terms(booking)
        if not confirm:
            quote = booking.model_copy(update={"cancel_fee": fee, "refund_amount": refund})
            return self._cancel_result(quote, False, f"{note} Gọi lại với confirm=true để hủy.")
        cancelled = booking.model_copy(
            update={"status": "CANCELLED", "cancel_fee": fee, "refund_amount": refund, "updated_at": self._clock()}
        )
        self._save(cancelled)
        return self._cancel_result(cancelled, True, f"Đã hủy. {note}")

    # ---------- nội bộ ----------

    def _find_active_hold(self, dedupe_key: str) -> Booking | None:
        rows = self._db.conn.execute(
            "SELECT booking_id FROM bookings WHERE dedupe_key = ? AND status = 'HELD'", (dedupe_key,)
        ).fetchall()
        for (booking_id,) in rows:
            booking = self.get(booking_id)
            if booking.status == "HELD":
                return booking
        return None

    def _new_pnr(self) -> str:
        while True:
            pnr = "".join(secrets.choice(PNR_ALPHABET) for _ in range(6))
            if self._db.conn.execute("SELECT 1 FROM bookings WHERE pnr = ?", (pnr,)).fetchone() is None:
                return pnr

    def _save(self, booking: Booking) -> None:
        with self._db.conn as conn:
            conn.execute(
                "UPDATE bookings SET status = ?, data = ? WHERE booking_id = ?",
                (booking.status, booking.model_dump_json(), booking.booking_id),
            )

    @staticmethod
    def _ticket_prefix(booking: Booking) -> str:
        airline = get_airline(booking.offer.segments[0].airline_code)
        return airline.ticket_prefix if airline else DEFAULT_TICKET_PREFIX

    @staticmethod
    def _cancel_terms(booking: Booking) -> tuple[int, int, str]:
        """Trả về (phí hủy, tiền hoàn, ghi chú) theo điều kiện vé giả lập."""
        if booking.status == "HELD":
            return 0, 0, "Booking mới giữ chỗ, chưa thanh toán nên hủy miễn phí."
        rules = fare_rules_for(booking.offer.segments[0].airline_code, booking.offer.cabin_class)
        if not rules.refundable or rules.cancel_fee is None:
            return booking.total_price, 0, "Hạng vé không hoàn tiền."
        count = len(booking.passengers) or (booking.passenger_counts.total if booking.passenger_counts else 1)
        fee = min(booking.total_price, rules.cancel_fee * count)
        return fee, booking.total_price - fee, f"Phí hủy {rules.cancel_fee:,} VND/khách."

    @staticmethod
    def _cancel_result(booking: Booking, cancelled: bool, message: str) -> CancelResult:
        return CancelResult(
            booking_id=booking.booking_id,
            pnr=booking.pnr,
            status=booking.status,
            cancelled=cancelled,
            cancel_fee=booking.cancel_fee or 0,
            refund_amount=booking.refund_amount or 0,
            currency=booking.currency,
            message=message,
        )
