import json
import sqlite3
import time
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Any

from relohome_flight.errors import OfferNotFoundError
from relohome_flight.schemas import FlightOffer
from relohome_flight.settings import now_vn

# Mọi trạng thái nằm trong SQLite để tồn tại qua các kết nối MCP và lần khởi động lại server.
_SCHEMA = """
CREATE TABLE IF NOT EXISTS offers (
    offer_id TEXT PRIMARY KEY,
    expires_at TEXT NOT NULL,
    data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS search_cache (
    cache_key TEXT PRIMARY KEY,
    expires_at REAL NOT NULL,
    data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bookings (
    booking_id TEXT PRIMARY KEY,
    pnr TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL,
    dedupe_key TEXT NOT NULL,
    data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bookings_dedupe ON bookings (dedupe_key, status);
CREATE TABLE IF NOT EXISTS offer_tokens (
    offer_id TEXT PRIMARY KEY,
    token TEXT NOT NULL,
    request TEXT NOT NULL,
    expires_at TEXT NOT NULL
);
"""


class FlightDatabase:
    """Kết nối SQLite dùng chung, mở lười ở lần truy cập đầu tiên."""

    def __init__(self, path: str) -> None:
        self._path = path
        self._conn: sqlite3.Connection | None = None

    @property
    def conn(self) -> sqlite3.Connection:
        if self._conn is None:
            if self._path != ":memory:":
                Path(self._path).parent.mkdir(parents=True, exist_ok=True)
            self._conn = sqlite3.connect(self._path, timeout=10, check_same_thread=False)
            self._conn.executescript(_SCHEMA)
        return self._conn

    def close(self) -> None:
        if self._conn is not None:
            self._conn.close()
            self._conn = None


class OfferCache:
    """Lưu các offer vừa tìm được để get_offer/hold_booking dùng lại."""

    def __init__(self, db: FlightDatabase, clock: Callable[[], datetime] = now_vn) -> None:
        self._db = db
        self._clock = clock

    def put_many(self, offers: list[FlightOffer]) -> None:
        rows = [(o.offer_id, o.expires_at.isoformat(), o.model_dump_json()) for o in offers]
        with self._db.conn as conn:
            conn.execute("DELETE FROM offers WHERE expires_at < ?", (self._clock().isoformat(),))
            conn.executemany("INSERT OR REPLACE INTO offers VALUES (?, ?, ?)", rows)

    def put_return_token(self, offer: FlightOffer, token: str, request_json: str) -> None:
        """Mã lấy chiều về của một chuyến đi khứ hồi; chỉ server giữ, không trả cho client."""
        with self._db.conn as conn:
            conn.execute("DELETE FROM offer_tokens WHERE expires_at < ?", (self._clock().isoformat(),))
            conn.execute(
                "INSERT OR REPLACE INTO offer_tokens VALUES (?, ?, ?, ?)",
                (offer.offer_id, token, request_json, offer.expires_at.isoformat()),
            )

    def get_return_token(self, offer_id: str) -> tuple[str, str]:
        row = self._db.conn.execute(
            "SELECT token, request FROM offer_tokens WHERE offer_id = ?", (offer_id,)
        ).fetchone()
        if row is None:
            raise OfferNotFoundError(f"Offer '{offer_id}' không có chiều về. Hãy tìm vé khứ hồi lại.")
        return row[0], row[1]

    def get(self, offer_id: str) -> FlightOffer:
        row = self._db.conn.execute("SELECT data FROM offers WHERE offer_id = ?", (offer_id,)).fetchone()
        if row is None:
            raise OfferNotFoundError(f"Không tìm thấy offer '{offer_id}'. Hãy gọi search_flights để lấy offer mới.")
        offer = FlightOffer.model_validate_json(row[0])
        if offer.expires_at <= self._clock():
            raise OfferNotFoundError(f"Offer '{offer_id}' đã hết hạn. Hãy gọi search_flights để lấy giá mới.")
        return offer


class SearchCache:
    """Cache response thô của SerpApi để tiết kiệm lượt gọi (gói miễn phí 100 lượt/tháng)."""

    def __init__(self, db: FlightDatabase, ttl_seconds: int) -> None:
        self._db = db
        self._ttl = ttl_seconds

    def get(self, key: str) -> dict[str, Any] | None:
        row = self._db.conn.execute(
            "SELECT data FROM search_cache WHERE cache_key = ? AND expires_at > ?", (key, time.time())
        ).fetchone()
        return json.loads(row[0]) if row else None

    def put(self, key: str, data: dict[str, Any]) -> None:
        if self._ttl <= 0:
            return
        with self._db.conn as conn:
            conn.execute("DELETE FROM search_cache WHERE expires_at <= ?", (time.time(),))
            conn.execute(
                "INSERT OR REPLACE INTO search_cache VALUES (?, ?, ?)",
                (key, time.time() + self._ttl, json.dumps(data)),
            )
