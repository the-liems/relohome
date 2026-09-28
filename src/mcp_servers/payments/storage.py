import secrets
import sqlite3
from pathlib import Path

# Chỉ lưu dữ liệu vận hành tối thiểu: mã, số tiền, trạng thái, thời gian. Không có cột nào chứa
# thông tin khách hàng (xem ADR-015). Trạng thái nằm trong SQLite vì client MCP có thể mở
# process server mới cho mỗi lần gọi tool (giống flights, ADR-013).
_SCHEMA = """
CREATE TABLE IF NOT EXISTS payments (
    payment_id TEXT PRIMARY KEY,
    gateway_ref TEXT UNIQUE NOT NULL,
    dedupe_key TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_dedupe ON payments (dedupe_key, status);
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""
SALT_KEY = "pseudonym_salt"


class PaymentDatabase:
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

    def pseudonym_salt(self, configured: str = "") -> str:
        """Muối cho định danh giả danh: lấy từ cấu hình, nếu trống thì sinh một lần và giữ trong DB."""
        if configured:
            return configured
        row = self.conn.execute("SELECT value FROM meta WHERE key = ?", (SALT_KEY,)).fetchone()
        if row:
            return row[0]
        salt = secrets.token_hex(32)
        with self.conn as conn:
            conn.execute("INSERT OR IGNORE INTO meta VALUES (?, ?)", (SALT_KEY, salt))
        return self.conn.execute("SELECT value FROM meta WHERE key = ?", (SALT_KEY,)).fetchone()[0]

    def close(self) -> None:
        if self._conn is not None:
            self._conn.close()
            self._conn = None
