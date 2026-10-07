"""Versioned, atomic schema for the isolated single-host Roommate store."""

import sqlite3

SCHEMA = (
    "CREATE TABLE access(actor TEXT PRIMARY KEY, adult INTEGER NOT NULL CHECK(adult IN (0,1)), terms TEXT NOT NULL, accepted REAL NOT NULL)",
    "CREATE TABLE profiles(owner TEXT PRIMARY KEY, version INTEGER NOT NULL CHECK(version>0), state TEXT NOT NULL, city TEXT, expires REAL, content TEXT NOT NULL)",
    "CREATE INDEX profiles_discovery ON profiles(state,city,expires)",
    "CREATE TABLE intros(owner TEXT PRIMARY KEY, content TEXT NOT NULL)",
    "CREATE TABLE criteria(owner TEXT PRIMARY KEY, content TEXT NOT NULL)",
    "CREATE TABLE bookmarks(owner TEXT NOT NULL, target TEXT NOT NULL, PRIMARY KEY(owner,target), CHECK(owner<>target))",
    "CREATE TABLE contacts(id TEXT PRIMARY KEY, owner TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('phone','zalo')), version INTEGER NOT NULL CHECK(version>0), ciphertext BLOB, UNIQUE(owner,kind))",
    "CREATE TABLE requests(id TEXT PRIMARY KEY, sender TEXT NOT NULL, recipient TEXT NOT NULL, state TEXT NOT NULL, created REAL NOT NULL, expires REAL NOT NULL, content TEXT NOT NULL, CHECK(sender<>recipient))",
    "CREATE INDEX requests_sender_time ON requests(sender,created)",
    "CREATE INDEX requests_recipient_state ON requests(recipient,state)",
    "CREATE TABLE grants(request TEXT PRIMARY KEY REFERENCES requests(id), expires REAL NOT NULL, state TEXT NOT NULL, content TEXT NOT NULL)",
    "CREATE TABLE pairs(first TEXT NOT NULL, second TEXT NOT NULL, request TEXT NOT NULL REFERENCES requests(id), expires REAL NOT NULL, PRIMARY KEY(first,second), CHECK(first<second))",
    "CREATE TABLE cooldowns(sender TEXT NOT NULL, recipient TEXT NOT NULL, until REAL NOT NULL, PRIMARY KEY(sender,recipient))",
    "CREATE TABLE operations(actor TEXT NOT NULL, key TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(actor,key))",
    "CREATE TABLE blocks(actor TEXT NOT NULL, target TEXT NOT NULL, PRIMARY KEY(actor,target), CHECK(actor<>target))",
    "CREATE TABLE restrictions(actor TEXT PRIMARY KEY, restricted INTEGER NOT NULL CHECK(restricted IN (0,1)))",
    "CREATE TABLE reports(id TEXT PRIMARY KEY, actor TEXT NOT NULL, target TEXT NOT NULL, reason TEXT NOT NULL, created REAL NOT NULL, status TEXT NOT NULL DEFAULT 'open')",
    "CREATE TABLE moderation(id TEXT PRIMARY KEY, actor TEXT NOT NULL, target TEXT NOT NULL, action TEXT NOT NULL, reason TEXT NOT NULL, created REAL NOT NULL)",
    "CREATE TABLE media(id TEXT PRIMARY KEY, owner TEXT NOT NULL, content BLOB NOT NULL, mime TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created REAL NOT NULL)",
)


def migrate(connection: sqlite3.Connection, statements: tuple[str, ...] = SCHEMA) -> None:
    connection.execute("BEGIN IMMEDIATE")
    try:
        version = connection.execute("PRAGMA user_version").fetchone()[0]
        if version > 1:
            raise ValueError("Unsupported Roommate schema version")
        if version == 0:
            for statement in statements:
                connection.execute(statement)
            connection.execute("PRAGMA user_version=1")
        connection.commit()
    except BaseException:
        connection.rollback()
        raise
