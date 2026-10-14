"""Anonymous browser sessions in the existing gateway store; no synthetic accounts."""

import hashlib
import os
import secrets
import time

from fastapi import HTTPException

GUEST_COOKIE = "relohome_guest"
TTL = 86400


def enabled():
    return os.getenv("RELOHOME_GUEST_ENABLED", "false").lower() == "true"


class GuestSessions:
    def __init__(self, store):
        self.store = store
        store.db.executescript("""
            CREATE TABLE IF NOT EXISTS guest_sessions (
                token TEXT PRIMARY KEY, id TEXT UNIQUE NOT NULL, expires REAL NOT NULL,
                thread TEXT, claim_target TEXT, claim_key TEXT, claimed INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS guest_expiry ON guest_sessions(claimed, expires);
            CREATE TABLE IF NOT EXISTS guest_budgets (
                actor TEXT NOT NULL, period INTEGER NOT NULL, bucket INTEGER NOT NULL,
                used INTEGER NOT NULL, PRIMARY KEY(actor, period, bucket)
            );
            CREATE TABLE IF NOT EXISTS guest_metadata (name TEXT PRIMARY KEY, value TEXT NOT NULL);
        """)
        store.db.execute("INSERT OR IGNORE INTO guest_metadata VALUES ('ip_salt', ?)", (secrets.token_hex(32),))
        store.db.commit()

    def lookup(self, token, *, expired=False):
        if not token or not enabled():
            return None
        row = self.store.one("SELECT * FROM guest_sessions WHERE token=?", (self.digest(token),))
        return row if row and not row["claimed"] and (expired or row["expires"] > time.time()) else None

    @staticmethod
    def digest(token):
        return hashlib.sha256(token.encode()).hexdigest()

    def peer(self, peer):
        salt = self.store.one("SELECT value FROM guest_metadata WHERE name='ip_salt'")["value"]
        return hashlib.sha256((salt + peer).encode()).hexdigest()

    def request_budget(self, peer):
        self.reserve([(f"read:{self.peer(peer)}", 60, int(os.getenv("RELOHOME_GUEST_REQUESTS_MINUTE", "120")))])

    def create(self, peer=None):
        if peer is not None:
            self.reserve(
                [
                    (f"sessions:{self.peer(peer)}", 1800, 60),
                    ("sessions:global", TTL, 1000),
                ]
            )
        token = secrets.token_urlsafe(40)
        self.store.write(
            "INSERT INTO guest_sessions(token,id,expires) VALUES (?,?,?)",
            (self.digest(token), "guest_" + secrets.token_hex(16), time.time() + TTL),
        )
        return token, self.lookup(token)

    @staticmethod
    def public(row):
        return {
            "id": row["id"],
            "kind": "guest",
            "is_guest": True,
            "name": "Khách",
            "email": "",
            "preferences": {},
            "expires_at": row["expires"],
            "active_thread_id": row["thread"],
            "capabilities": ["chat", "housing_read", "flight_read", "map_read", "guides"],
        }

    def budget(self, guest, peer):
        """Atomic shared counters; rotating the guest cookie does not reset the IP budget."""
        ip = "ip:" + self.peer(peer)
        limits = [
            (guest["id"], 1800, int(os.getenv("RELOHOME_GUEST_TURNS_30M", "10"))),
            (guest["id"], TTL, int(os.getenv("RELOHOME_GUEST_TURNS_DAY", "30"))),
            (ip, 1800, int(os.getenv("RELOHOME_GUEST_IP_TURNS_30M", "30"))),
            (ip, TTL, int(os.getenv("RELOHOME_GUEST_IP_TURNS_DAY", "100"))),
            ("global", TTL, int(os.getenv("RELOHOME_GUEST_GLOBAL_TURNS_DAY", "300"))),
        ]
        self.reserve(limits)

    def reserve(self, limits):
        now = int(time.time())
        with self.store.db:
            # Acquire SQLite's writer lock before checking, across gateway processes.
            self.store.db.execute("DELETE FROM guest_budgets WHERE bucket + period < ?", (now - TTL,))
            for actor, period, limit in limits:
                bucket = now // period * period
                row = self.store.one(
                    "SELECT used FROM guest_budgets WHERE actor=? AND period=? AND bucket=?",
                    (actor, period, bucket),
                )
                if limit < 1 or (row and row["used"] >= limit):
                    raise HTTPException(429, {"code": "guest_quota", "retry_after": bucket + period - now})
            for actor, period, _ in limits:
                self.store.db.execute(
                    "INSERT INTO guest_budgets VALUES(?,?,?,1) ON CONFLICT(actor,period,bucket) "
                    "DO UPDATE SET used=used+1",
                    (actor, period, now // period * period),
                )
