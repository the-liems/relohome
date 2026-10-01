"""Local web persistence, separate from graph checkpoints and transaction PII."""

import hashlib
import json
import secrets
import sqlite3
import time
from pathlib import Path


def password_hash(password, salt):
    return hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()


class Store:
    def __init__(self, path):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript("""
            PRAGMA journal_mode=WAL;
            PRAGMA foreign_keys=ON;
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
                salt TEXT NOT NULL, password TEXT NOT NULL, preferences TEXT NOT NULL DEFAULT '{}'
            );
            CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, owner TEXT NOT NULL, expires REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS threads (
                id TEXT PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL, updated REAL NOT NULL,
                state TEXT NOT NULL DEFAULT '{}', revision INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS threads_owner ON threads(owner, updated);
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY, thread TEXT NOT NULL REFERENCES threads(id), role TEXT NOT NULL,
                content TEXT NOT NULL, created REAL NOT NULL
            );
            CREATE INDEX IF NOT EXISTS messages_thread ON messages(thread, created);
            CREATE TABLE IF NOT EXISTS runs (
                id TEXT PRIMARY KEY, owner TEXT NOT NULL, thread TEXT NOT NULL,
                fingerprint TEXT NOT NULL, status TEXT NOT NULL, result TEXT
            );
            CREATE TABLE IF NOT EXISTS saved (
                owner TEXT NOT NULL, id TEXT NOT NULL, thread TEXT NOT NULL,
                snapshot TEXT NOT NULL, PRIMARY KEY(owner,id)
            );
        """)
        self.db.execute("UPDATE runs SET status='unknown' WHERE status='running'")
        self.db.commit()

    def one(self, sql, args=()):
        row = self.db.execute(sql, args).fetchone()
        return dict(row) if row else None

    def all(self, sql, args=()):
        return [dict(row) for row in self.db.execute(sql, args).fetchall()]

    def write(self, sql, args=()):
        self.db.execute(sql, args)
        self.db.commit()

    def message(self, thread, role, content):
        self.write(
            "INSERT INTO messages VALUES (?,?,?,?,?)",
            (
                secrets.token_hex(16),
                thread,
                role,
                json.dumps(content, ensure_ascii=False),
                time.time(),
            ),
        )

    def history(self, thread):
        return [
            {**row, "content": json.loads(row["content"])}
            for row in self.all(
                "SELECT id,role,content,created FROM messages WHERE thread=? ORDER BY created,rowid", (thread,)
            )
        ]

    def create_session(self, owner):
        token = secrets.token_urlsafe(40)
        self.write("DELETE FROM sessions WHERE expires < ?", (time.time(),))
        self.write(
            "INSERT INTO sessions VALUES (?,?,?)",
            (
                hashlib.sha256(token.encode()).hexdigest(),
                owner,
                time.time() + 86400 * 14,
            ),
        )
        return token

    def session_user(self, token):
        return self.one(
            "SELECT u.* FROM sessions s JOIN users u ON u.id=s.owner WHERE s.token=? AND s.expires>?",
            (hashlib.sha256(token.encode()).hexdigest(), time.time()),
        )
