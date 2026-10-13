"""Local web persistence, separate from graph checkpoints and transaction PII."""

import hashlib
import json
import os
import secrets
import sqlite3
import time
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken


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
            CREATE TABLE IF NOT EXISTS traveler_profiles (
                owner TEXT PRIMARY KEY, data BLOB NOT NULL, updated REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS saved (
                owner TEXT NOT NULL, id TEXT NOT NULL, thread TEXT NOT NULL,
                snapshot TEXT NOT NULL, PRIMARY KEY(owner,id)
            );
            -- A viewing change the landlord inbox has not received yet (Platform unreachable): a booked
            -- time, or slot '' for withdrawing one. `baseline` fingerprints the remote request before the
            -- failed attempt so a send that landed despite a timeout is recognised. Retried only on the
            -- tenant's viewing actions; dropped when the booking changes.
            CREATE TABLE IF NOT EXISTS landlord_sync (
                owner TEXT NOT NULL, thread TEXT NOT NULL, listing TEXT NOT NULL,
                slot TEXT NOT NULL, updated REAL NOT NULL, baseline TEXT NOT NULL DEFAULT '',
                PRIMARY KEY(owner, thread, listing)
            );
        """)
        columns = {row[1] for row in self.db.execute("PRAGMA table_info(landlord_sync)")}
        if "baseline" not in columns:  # databases created before the column existed
            self.db.execute("ALTER TABLE landlord_sync ADD COLUMN baseline TEXT NOT NULL DEFAULT ''")
        session_columns = {row[1] for row in self.db.execute("PRAGMA table_info(sessions)")}
        if "workspace" not in session_columns:
            self.db.execute("ALTER TABLE sessions ADD COLUMN workspace TEXT NOT NULL DEFAULT 'customer'")
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

    def delete_thread(self, owner, thread):
        """Drop a conversation; saved homes stay as the user's favourites without the thread link."""
        with self.db:
            self.db.execute("DELETE FROM messages WHERE thread=?", (thread,))
            self.db.execute("DELETE FROM runs WHERE thread=? AND owner=?", (thread, owner))
            self.db.execute("DELETE FROM landlord_sync WHERE thread=? AND owner=?", (thread, owner))
            self.db.execute("UPDATE saved SET thread='' WHERE owner=? AND thread=?", (owner, thread))
            self.db.execute("DELETE FROM threads WHERE id=? AND owner=?", (thread, owner))

    def create_session(self, owner, workspace="customer"):
        token = secrets.token_urlsafe(40)
        self.write("DELETE FROM sessions WHERE expires < ?", (time.time(),))
        self.write(
            "INSERT INTO sessions(token,owner,expires,workspace) VALUES (?,?,?,?)",
            (
                hashlib.sha256(token.encode()).hexdigest(),
                owner,
                time.time() + 86400 * 14,
                workspace,
            ),
        )
        return token

    def session_user(self, token):
        return self.one(
            "SELECT u.*,s.workspace FROM sessions s JOIN users u ON u.id=s.owner WHERE s.token=? AND s.expires>?",
            (hashlib.sha256(token.encode()).hexdigest(), time.time()),
        )


class TravelerProfiles:
    """Booker details for flight tickets (payment-design D2): encrypted at rest, owner-scoped, never in messages."""

    def __init__(self, store, key_path):
        self.store = store
        key = os.getenv("SIU_TRAVELER_KEY", "").encode()
        if not key:
            path = Path(key_path)
            if not path.exists():
                path.parent.mkdir(parents=True, exist_ok=True)
                fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd, "wb") as handle:
                    handle.write(Fernet.generate_key())
            key = path.read_bytes().strip()
        self.fernet = Fernet(key)

    def get(self, owner):
        row = self.store.one("SELECT data FROM traveler_profiles WHERE owner=?", (owner,))
        if not row:
            return None
        try:
            return json.loads(self.fernet.decrypt(row["data"]))
        except InvalidToken:
            return None

    def put(self, owner, data):
        token = self.fernet.encrypt(json.dumps(data, ensure_ascii=False).encode())
        self.store.write("INSERT OR REPLACE INTO traveler_profiles VALUES (?,?,?)", (owner, token, time.time()))

    def delete(self, owner):
        self.store.write("DELETE FROM traveler_profiles WHERE owner=?", (owner,))
