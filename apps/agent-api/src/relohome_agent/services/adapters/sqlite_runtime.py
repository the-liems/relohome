"""Durable single-host local runtime ports. No fabricated provider data.

PII is encrypted with a local persistent Fernet key. Keep this directory private,
back up its key with the DB, and use one application worker (deployment is separate).
"""

from __future__ import annotations

import json
import secrets
import sqlite3
from collections.abc import MutableMapping
from datetime import datetime, timedelta
from typing import Any

from cryptography.fernet import Fernet
from relohome_agent.agents.common import utcnow
from relohome_agent.agents.memory import apply_updates, forget_thread
from relohome_agent.agents.models import Approval, SessionContext, UsageCounts
from relohome_agent.runtime_paths import runtime_path


class RuntimeDatabase:
    def __init__(self, directory: str):
        root = runtime_path(directory)
        root.mkdir(parents=True, exist_ok=True)
        key_path = root / "pii.key"
        try:
            with key_path.open("xb") as file:
                file.write(Fernet.generate_key())
            key_path.chmod(0o600)
        except FileExistsError:
            pass
        self.cipher = Fernet(key_path.read_bytes())
        self.connection = sqlite3.connect(root / "runtime.sqlite3", isolation_level=None)
        self.connection.execute("PRAGMA journal_mode=WAL")
        self.connection.execute("PRAGMA busy_timeout=5000")
        self.connection.executescript("""
            CREATE TABLE IF NOT EXISTS records (namespace TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(namespace,id));
            CREATE TABLE IF NOT EXISTS approval_uses (id TEXT PRIMARY KEY, use_key TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS usage (thread TEXT NOT NULL, request TEXT NOT NULL, kind TEXT NOT NULL, llm INTEGER NOT NULL, paid INTEGER NOT NULL, data TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS usage_scope ON usage(thread,request);
        """)

    def get(self, namespace, key):
        row = self.connection.execute(
            "SELECT data FROM records WHERE namespace=? AND id=?", (namespace, key)
        ).fetchone()
        return json.loads(row[0]) if row else None

    def put(self, namespace, key, value):
        self.connection.execute(
            "INSERT INTO records VALUES(?,?,?) ON CONFLICT(namespace,id) DO UPDATE SET data=excluded.data",
            (namespace, key, json.dumps(value, ensure_ascii=False)),
        )

    def delete(self, namespace, key):
        self.connection.execute("DELETE FROM records WHERE namespace=? AND id=?", (namespace, key))

    def close(self):
        self.connection.close()


class DurableModels(MutableMapping):
    """Small durable mapping for adapter receipt/hold caches (contains no PII forms)."""

    def __init__(self, db, namespace, model):
        self.db, self.namespace, self.model = db, namespace, model

    def __getitem__(self, key):
        value = self.db.get(self.namespace, key)
        if value is None:
            raise KeyError(key)
        return self.model.model_validate(value)

    def __setitem__(self, key, value):
        self.db.put(self.namespace, key, value.model_dump(mode="json"))

    def __delitem__(self, key):
        self.db.delete(self.namespace, key)

    def __iter__(self):
        return iter(
            [r[0] for r in self.db.connection.execute("SELECT id FROM records WHERE namespace=?", (self.namespace,))]
        )

    def __len__(self):
        return self.db.connection.execute(
            "SELECT COUNT(*) FROM records WHERE namespace=?", (self.namespace,)
        ).fetchone()[0]


class SqliteSessionPort:
    def __init__(self, db):
        self.db = db

    async def load(self, user_id):
        return SessionContext.model_validate(self.db.get("session", user_id) or {})

    async def save(self, user_id, thread_id, updates):
        if updates:
            value = apply_updates(await self.load(user_id), updates, thread_id, utcnow())
            self.db.put("session", user_id, value.model_dump(mode="json"))

    async def forget(self, user_id):
        self.db.delete("session", user_id)

    async def forget_thread(self, user_id, thread_id):
        if self.db.get("session", user_id):
            value = forget_thread(await self.load(user_id), thread_id)
            self.db.put("session", user_id, value.model_dump(mode="json"))


class SqliteApprovalStore:
    def __init__(self, db):
        self.db = db

    async def create(self, *, user_id, thread_id, plan_version, payload_hash, expires_at, pii_refs=None):
        now = utcnow()
        if not now < expires_at <= now + timedelta(minutes=30):
            raise ValueError("Approval expiry out of range")
        item = Approval(
            approval_id=secrets.token_urlsafe(24),
            user_id=user_id,
            thread_id=thread_id,
            plan_version=plan_version,
            payload_hash=payload_hash,
            created_at=now,
            expires_at=expires_at,
            pii_refs=pii_refs or {},
        )
        self.db.put("approval", item.approval_id, item.model_dump(mode="json"))
        return item

    async def get(self, approval_id):
        value = self.db.get("approval", approval_id)
        return Approval.model_validate(value) if value else None

    async def mark_used(self, approval_id, use_key):
        value = await self.get(approval_id)
        if value is None or value.expires_at <= utcnow():
            return False
        self.db.connection.execute("INSERT OR IGNORE INTO approval_uses VALUES(?,?)", (approval_id, use_key))
        return (
            self.db.connection.execute("SELECT use_key FROM approval_uses WHERE id=?", (approval_id,)).fetchone()[0]
            == use_key
        )


class SqlitePiiStore:
    def __init__(self, db):
        self.db = db

    async def put(self, data: dict[str, Any]):
        ref = "pii_" + secrets.token_urlsafe(24)
        encrypted = self.db.cipher.encrypt(json.dumps(data).encode()).decode()
        self.db.put("pii", ref, {"expires": (utcnow() + timedelta(minutes=30)).isoformat(), "encrypted": encrypted})
        return ref

    async def get(self, ref):
        value = self.db.get("pii", ref)
        if not value or datetime.fromisoformat(value["expires"]) <= utcnow():
            self.db.delete("pii", ref)
            raise KeyError("PII missing or expired")
        return json.loads(self.db.cipher.decrypt(value["encrypted"].encode()))


class SqliteUsageMeter:
    def __init__(self, db):
        self.db = db

    async def record_llm(self, thread_id, request_id, node, model, tokens_in, tokens_out):
        self.db.connection.execute(
            "INSERT INTO usage VALUES(?,?,?,?,?,?)",
            (
                thread_id,
                request_id,
                "graph",
                1,
                0,
                json.dumps(dict(node=node, model=model, tokens_in=tokens_in, tokens_out=tokens_out)),
            ),
        )

    async def record_subagent(self, thread_id, request_id, agent, cost_tier, usage, elapsed_ms):
        paid = int(cost_tier == "paid" and (usage.provider_calls > 0 or usage.llm_calls > 0))
        self.db.connection.execute(
            "INSERT INTO usage VALUES(?,?,?,?,?,?)",
            (
                thread_id,
                request_id,
                "subagent",
                usage.llm_calls,
                paid,
                json.dumps(dict(agent=str(agent), elapsed_ms=elapsed_ms, **usage.model_dump())),
            ),
        )

    async def counts(self, thread_id, request_id=None):
        rows = self.db.connection.execute(
            "SELECT kind,llm,paid FROM usage WHERE thread=?" + (" AND request=?" if request_id is not None else ""),
            (thread_id, request_id) if request_id is not None else (thread_id,),
        ).fetchall()
        return UsageCounts(
            llm_calls=sum(r[1] for r in rows if r[0] == "graph"),
            subagent_llm_calls=sum(r[1] for r in rows if r[0] == "subagent"),
            paid_calls=sum(r[2] for r in rows),
        )
