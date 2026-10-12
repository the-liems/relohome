import hashlib
import secrets
from collections.abc import Callable
from datetime import datetime, timedelta

from relohome_payment.errors import InvalidRequestError, PaymentNotFoundError, PaymentStateError
from relohome_payment.gateways import PaymentGateway
from relohome_payment.privacy import check_opaque_ref, new_gateway_ref, pseudonym
from relohome_payment.schemas import MAX_AMOUNT, MIN_AMOUNT, Payment, RefundResult, SimulatedOutcome
from relohome_payment.settings import PaymentSettings, now_vn
from relohome_payment.storage import PaymentDatabase

ACTIVE_STATUSES = ("PENDING", "PAID")


def _dedupe_key(provider: str, order_ref: str, amount: int) -> str:
    return hashlib.sha256(f"{provider}|{order_ref}|{amount}".encode()).hexdigest()


class PaymentEngine:
    """Vòng đời giao dịch: tạo → (PAID | FAILED | EXPIRED | CANCELLED) → REFUNDED.

    Engine là nơi duy nhất chuẩn bị dữ liệu gửi cho cổng, nên cũng là nơi thực thi quy tắc
    bảo vệ dữ liệu cá nhân: mã đơn ngẫu nhiên có tiền tố nhóm, định danh giả danh, mô tả cố định.
    """

    def __init__(
        self,
        db: PaymentDatabase,
        gateway: PaymentGateway,
        settings: PaymentSettings,
        clock: Callable[[], datetime] = now_vn,
    ) -> None:
        self.environment = (
            "sandbox" if gateway.name == "zalopay"
            and settings.zalopay_endpoint.rstrip("/") == "https://sb-openapi.zalopay.vn/v2"
            else "mock" if gateway.name == "mock" else "unknown"
        )
        self._db = db
        self._gateway = gateway
        self._prefix = settings.order_prefix
        self._salt_setting = settings.pseudonym_salt
        self._expire = timedelta(minutes=settings.expire_minutes)
        self._retention = timedelta(days=settings.retention_days)
        self._clock = clock

    @property
    def provider(self) -> str:
        return self._gateway.name

    async def create(self, order_ref: str, amount: int, customer_ref: str = "guest") -> Payment:
        """Tạo đơn PENDING. Gọi lại với cùng order_ref + amount khi đơn còn hiệu lực sẽ trả đơn cũ."""
        check_opaque_ref(order_ref, "order_ref")
        check_opaque_ref(customer_ref, "customer_ref")
        if not MIN_AMOUNT <= amount <= MAX_AMOUNT:
            raise InvalidRequestError(f"Số tiền phải từ {MIN_AMOUNT:,} đến {MAX_AMOUNT:,} VND.")
        dedupe_key = _dedupe_key(self._gateway.name, order_ref, amount)
        existing = await self._find_active(dedupe_key)
        if existing is not None:
            return existing

        now = self._clock()
        self._purge_old(now)
        gateway_ref = new_gateway_ref(self._prefix, now)
        order = await self._gateway.create(
            gateway_ref=gateway_ref,
            amount=amount,
            app_user=pseudonym(self._db.pseudonym_salt(self._salt_setting), customer_ref),
            description=f"{self._prefix} demo {gateway_ref}",
            expire_seconds=int(self._expire.total_seconds()),
        )
        payment = Payment(
            payment_id=f"pay_{secrets.token_hex(6)}",
            order_ref=order_ref,
            gateway_ref=gateway_ref,
            provider=self._gateway.name,  # type: ignore[arg-type]
            amount=amount,
            status="PENDING",
            pay_url=order.pay_url,
            qr_code=order.qr_code,
            expires_at=now + self._expire,
            created_at=now,
            updated_at=now,
        )
        with self._db.conn as conn:
            conn.execute(
                "INSERT INTO payments VALUES (?, ?, ?, ?, ?, ?)",
                (
                    payment.payment_id,
                    gateway_ref,
                    dedupe_key,
                    payment.status,
                    now.isoformat(),
                    payment.model_dump_json(),
                ),
            )
        return payment

    async def get(self, payment_ref: str) -> Payment:
        """Tìm trong DB của nhóm theo payment_id hoặc mã đơn; đơn PENDING được đồng bộ với cổng.

        Mã không có trong DB thì báo không tìm thấy và KHÔNG hỏi cổng, để không đọc được đơn của nhóm khác
        trên merchant sandbox dùng chung.
        """
        payment = self._load(payment_ref)
        if payment.status != "PENDING":
            return payment
        remote = await self._gateway.query(payment.gateway_ref)
        if remote != "PENDING":
            return self._save(payment, status=remote)
        if payment.expires_at <= self._clock():
            return self._save(payment, status="EXPIRED")
        return payment

    async def cancel(self, payment_ref: str) -> Payment:
        """Hủy đơn chưa thanh toán (chỉ cổng hỗ trợ hủy)."""
        payment = await self.get(payment_ref)
        if payment.status == "CANCELLED":
            return payment
        if payment.status != "PENDING":
            raise PaymentStateError(f"Giao dịch {payment.payment_id} đang {payment.status}, chỉ hủy được khi PENDING.")
        if not self._gateway.supports_cancel_refund:
            raise PaymentStateError(
                f"{self._gateway.name} không có API hủy đơn. Đơn sẽ tự hết hạn lúc "
                f"{payment.expires_at:%H:%M %d/%m}; đừng thanh toán link này nữa."
            )
        return self._save(payment, status="CANCELLED")

    async def refund(self, payment_ref: str, confirm: bool = False) -> RefundResult:
        """confirm=False chỉ báo số tiền sẽ hoàn; confirm=True mới hoàn."""
        payment = await self.get(payment_ref)
        if payment.status == "REFUNDED":
            return self._refund_result(payment, True, "Giao dịch đã được hoàn trước đó.")
        if payment.status != "PAID":
            raise PaymentStateError(f"Giao dịch {payment.payment_id} đang {payment.status}, chỉ hoàn được khi PAID.")
        if not self._gateway.supports_cancel_refund:
            raise PaymentStateError(f"Hoàn tiền qua {self._gateway.name} chưa được hỗ trợ trong bản MVP.")
        if not confirm:
            return self._refund_result(
                payment, False, f"Sẽ hoàn {payment.amount:,} VND. Gọi lại với confirm=true để hoàn."
            )
        refunded = self._save(payment, status="REFUNDED", refund_amount=payment.amount)
        return self._refund_result(refunded, True, f"Đã hoàn {payment.amount:,} VND.")

    async def simulate(self, payment_ref: str, outcome: SimulatedOutcome) -> Payment:
        """Chỉ dành cho cổng mock: ép kết quả thanh toán để demo."""
        if self._gateway.name != "mock":
            raise PaymentStateError("Chỉ giả lập được kết quả khi PAYMENT_PROVIDER=mock.")
        payment = await self.get(payment_ref)
        if payment.status != "PENDING":
            raise PaymentStateError(f"Giao dịch {payment.payment_id} đang {payment.status}, không giả lập được nữa.")
        return self._save(payment, status=outcome)

    # ---------- nội bộ ----------

    def _load(self, payment_ref: str) -> Payment:
        row = self._db.conn.execute(
            "SELECT data FROM payments WHERE payment_id = ? OR gateway_ref = ?", (payment_ref, payment_ref)
        ).fetchone()
        if row is None:
            raise PaymentNotFoundError("Không tìm thấy giao dịch của nhóm với mã đã cho.")
        return Payment.model_validate_json(row[0])

    async def _find_active(self, dedupe_key: str) -> Payment | None:
        rows = self._db.conn.execute(
            "SELECT payment_id FROM payments WHERE dedupe_key = ? AND status IN ('PENDING', 'PAID')", (dedupe_key,)
        ).fetchall()
        for (payment_id,) in rows:
            payment = await self.get(payment_id)
            if payment.status in ACTIVE_STATUSES:
                return payment
        return None

    def _purge_old(self, now: datetime) -> None:
        with self._db.conn as conn:
            conn.execute("DELETE FROM payments WHERE created_at < ?", ((now - self._retention).isoformat(),))

    def _save(self, payment: Payment, **update: object) -> Payment:
        updated = payment.model_copy(update={**update, "updated_at": self._clock()})
        with self._db.conn as conn:
            conn.execute(
                "UPDATE payments SET status = ?, data = ? WHERE payment_id = ?",
                (updated.status, updated.model_dump_json(), updated.payment_id),
            )
        return updated

    @staticmethod
    def _refund_result(payment: Payment, refunded: bool, message: str) -> RefundResult:
        return RefundResult(
            payment_id=payment.payment_id,
            status=payment.status,
            refunded=refunded,
            amount=payment.refund_amount if refunded and payment.refund_amount else payment.amount,
            message=message,
        )
