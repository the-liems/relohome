"""Lưu bền giao dịch, lần thanh toán và công việc hoàn tất trong runtime SQLite (một worker, một host)."""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from uuid import uuid4

from relohome_agent.checkout.models import FulfilmentJob, PaymentAttempt, ServiceTransaction

SCHEMA = """
CREATE TABLE IF NOT EXISTS checkout_transactions (
    transaction_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    logical_key TEXT NOT NULL,
    superseded INTEGER NOT NULL DEFAULT 0,
    data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS checkout_tx_scope ON checkout_transactions(user_id, thread_id, logical_key);
CREATE TABLE IF NOT EXISTS checkout_attempts (
    attempt_id TEXT PRIMARY KEY,
    transaction_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS checkout_attempt_tx ON checkout_attempts(transaction_id);
CREATE TABLE IF NOT EXISTS checkout_decisions (
    decision_key TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS checkout_jobs (
    job_id TEXT PRIMARY KEY,
    transaction_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,
    data TEXT NOT NULL
);
"""


class CheckoutStore:
    def __init__(self, connection: sqlite3.Connection):
        self.db = connection
        self.db.executescript(SCHEMA)

    @contextmanager
    def transaction(self):
        """Atomic synchronous store step, safe inside an existing SQLite transaction."""
        name = "checkout_" + uuid4().hex
        self.db.execute(f"SAVEPOINT {name}")
        try:
            yield
        except BaseException:
            self.db.execute(f"ROLLBACK TO {name}")
            raise
        finally:
            self.db.execute(f"RELEASE {name}")

    # --- giao dịch ---

    def put_tx(self, tx: ServiceTransaction) -> None:
        self.db.execute(
            "INSERT INTO checkout_transactions VALUES(?,?,?,?,?,?) ON CONFLICT(transaction_id) DO UPDATE SET "
            "superseded=excluded.superseded, data=excluded.data",
            (
                tx.transaction_id,
                tx.user_id,
                tx.thread_id,
                tx.logical_key,
                int(tx.superseded),
                tx.model_dump_json(),
            ),
        )

    def get_tx(self, transaction_id: str) -> ServiceTransaction | None:
        row = self.db.execute(
            "SELECT data FROM checkout_transactions WHERE transaction_id=?", (transaction_id,)
        ).fetchone()
        return ServiceTransaction.model_validate_json(row[0]) if row else None

    def current_tx(self, user_id: str, thread_id: str, logical_key: str) -> ServiceTransaction | None:
        row = self.db.execute(
            "SELECT data FROM checkout_transactions WHERE user_id=? AND thread_id=? AND logical_key=? AND superseded=0 "
            "ORDER BY rowid DESC LIMIT 1",
            (user_id, thread_id, logical_key),
        ).fetchone()
        return ServiceTransaction.model_validate_json(row[0]) if row else None

    def list_tx(self, user_id: str, thread_id: str) -> list[ServiceTransaction]:
        rows = self.db.execute(
            "SELECT data FROM checkout_transactions WHERE user_id=? AND thread_id=? AND superseded=0 ORDER BY rowid",
            (user_id, thread_id),
        ).fetchall()
        return [ServiceTransaction.model_validate_json(r[0]) for r in rows]

    def delete_thread(self, user_id: str, thread_id: str) -> None:
        ids = [
            r[0]
            for r in self.db.execute(
                "SELECT transaction_id FROM checkout_transactions WHERE user_id=? AND thread_id=?",
                (user_id, thread_id),
            ).fetchall()
        ]
        for tx_id in ids:
            self.db.execute("DELETE FROM checkout_attempts WHERE transaction_id=?", (tx_id,))
            self.db.execute("DELETE FROM checkout_jobs WHERE transaction_id=?", (tx_id,))
        self.db.execute("DELETE FROM checkout_transactions WHERE user_id=? AND thread_id=?", (user_id, thread_id))
        self.delete_decisions(user_id, thread_id)

    # --- lần thanh toán ---

    def insert_attempt(self, attempt: PaymentAttempt) -> bool:
        """False nếu `idempotency_key` đã có (gửi lặp, hai tab): không tạo lần thanh toán mới."""
        cursor = self.db.execute(
            "INSERT OR IGNORE INTO checkout_attempts VALUES(?,?,?,?)",
            (attempt.attempt_id, attempt.transaction_id, attempt.idempotency_key, attempt.model_dump_json()),
        )
        return cursor.rowcount == 1

    def put_attempt(self, attempt: PaymentAttempt) -> None:
        self.db.execute(
            "UPDATE checkout_attempts SET data=? WHERE attempt_id=?", (attempt.model_dump_json(), attempt.attempt_id)
        )

    def get_attempt(self, attempt_id: str) -> PaymentAttempt | None:
        row = self.db.execute("SELECT data FROM checkout_attempts WHERE attempt_id=?", (attempt_id,)).fetchone()
        return PaymentAttempt.model_validate_json(row[0]) if row else None

    def attempt_by_key(self, idempotency_key: str) -> PaymentAttempt | None:
        row = self.db.execute(
            "SELECT data FROM checkout_attempts WHERE idempotency_key=?", (idempotency_key,)
        ).fetchone()
        return PaymentAttempt.model_validate_json(row[0]) if row else None

    def attempts_for(self, transaction_id: str) -> list[PaymentAttempt]:
        rows = self.db.execute(
            "SELECT data FROM checkout_attempts WHERE transaction_id=? ORDER BY rowid", (transaction_id,)
        ).fetchall()
        return [PaymentAttempt.model_validate_json(r[0]) for r in rows]

    # --- công việc hoàn tất ---

    def create_job(self, job: FulfilmentJob) -> bool:
        """Mỗi giao dịch chỉ có một công việc hoàn tất: không chạy hoàn tất hai lần."""
        cursor = self.db.execute(
            "INSERT OR IGNORE INTO checkout_jobs VALUES(?,?,?,?)",
            (job.job_id, job.transaction_id, job.status, job.model_dump_json()),
        )
        return cursor.rowcount == 1

    def put_job(self, job: FulfilmentJob) -> None:
        self.db.execute(
            "UPDATE checkout_jobs SET status=?, data=? WHERE job_id=?", (job.status, job.model_dump_json(), job.job_id)
        )

    def job_for(self, transaction_id: str) -> FulfilmentJob | None:
        row = self.db.execute("SELECT data FROM checkout_jobs WHERE transaction_id=?", (transaction_id,)).fetchone()
        return FulfilmentJob.model_validate_json(row[0]) if row else None

    def open_attempts(self) -> list[PaymentAttempt]:
        """Lần thanh toán chưa có kết quả cuối, để worker tự đối soát (không chờ người dùng bấm Kiểm tra)."""
        rows = self.db.execute(
            "SELECT data FROM checkout_attempts WHERE json_extract(data, '$.outcome') IN "
            "('processing', 'awaiting_payment', 'needs_reconciliation') ORDER BY rowid"
        ).fetchall()
        return [PaymentAttempt.model_validate_json(r[0]) for r in rows]

    def pending_jobs(self) -> list[FulfilmentJob]:
        rows = self.db.execute("SELECT data FROM checkout_jobs WHERE status='pending' ORDER BY rowid").fetchall()
        return [FulfilmentJob.model_validate_json(r[0]) for r in rows]

    def delete_tx(self, transaction_id: str) -> None:
        """Chỉ dùng cho giao dịch không có lần thanh toán (nhà: tự báo, không thu tiền)."""
        if self.attempts_for(transaction_id):
            raise ValueError("Transactions with payment attempts are kept")
        self.db.execute("DELETE FROM checkout_transactions WHERE transaction_id=?", (transaction_id,))

    # --- quyết định chốt nhà (chống trùng, ghi ý định trước) ---

    def insert_decision(self, decision: dict) -> bool:
        cursor = self.db.execute(
            "INSERT OR IGNORE INTO checkout_decisions VALUES(?,?,?,?)",
            (decision["decision_key"], decision["user_id"], decision["thread_id"], json.dumps(decision)),
        )
        return cursor.rowcount == 1

    def get_decision(self, decision_key: str) -> dict | None:
        row = self.db.execute("SELECT data FROM checkout_decisions WHERE decision_key=?", (decision_key,)).fetchone()
        return json.loads(row[0]) if row else None

    def put_decision(self, decision: dict) -> None:
        self.db.execute(
            "UPDATE checkout_decisions SET data=? WHERE decision_key=?",
            (json.dumps(decision), decision["decision_key"]),
        )

    def delete_decisions(self, user_id: str, thread_id: str) -> None:
        self.db.execute("DELETE FROM checkout_decisions WHERE user_id=? AND thread_id=?", (user_id, thread_id))
