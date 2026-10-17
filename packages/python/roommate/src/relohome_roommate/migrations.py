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

SCHEMA_VERSION = 3
EXPANSION = (
    "CREATE INDEX profiles_expiry ON profiles(state,expires)",
    "CREATE INDEX profiles_room ON profiles(json_extract(content,'$.content.room.listing_id'),state,expires)",
    "CREATE INDEX requests_expiry ON requests(state,expires)",
    "CREATE INDEX requests_recipient_time ON requests(recipient,created,id)",
    "CREATE INDEX grants_expiry ON grants(state,expires)",
    "CREATE INDEX blocks_reverse ON blocks(target,actor)",
    "CREATE INDEX reports_queue ON reports(status,created,id)",
    "CREATE INDEX media_queue ON media(status,created,id)",
    "CREATE TABLE notifications(id TEXT NOT NULL,actor TEXT NOT NULL,kind TEXT NOT NULL,resource TEXT NOT NULL,created REAL NOT NULL,read_at REAL,PRIMARY KEY(actor,id))",
    "CREATE INDEX notifications_inbox ON notifications(actor,created,id)",
    "CREATE TABLE operation_times(actor TEXT NOT NULL,key TEXT NOT NULL,created REAL NOT NULL,PRIMARY KEY(actor,key),FOREIGN KEY(actor,key) REFERENCES operations(actor,key))",
    "CREATE TABLE rate_buckets(actor TEXT NOT NULL,bucket TEXT NOT NULL,bucket_start INTEGER NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(actor,bucket,bucket_start))",
    "CREATE TABLE operation_drafts(actor TEXT NOT NULL,key TEXT NOT NULL,fingerprint TEXT NOT NULL,ciphertext BLOB NOT NULL,created REAL NOT NULL,expires REAL NOT NULL,PRIMARY KEY(actor,key))",
    "CREATE INDEX operation_drafts_expiry ON operation_drafts(expires)",
    "CREATE TABLE private_metadata(name TEXT PRIMARY KEY,value TEXT NOT NULL)",
)

CHAT = (
    "CREATE TABLE chat_pairs(first TEXT NOT NULL, second TEXT NOT NULL, request TEXT NOT NULL REFERENCES requests(id), expires REAL, PRIMARY KEY(first,second), CHECK(first<second))",
    "CREATE TABLE chat_conversations(id TEXT PRIMARY KEY,request TEXT NOT NULL UNIQUE REFERENCES requests(id),first TEXT NOT NULL,second TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('active','closed')),created REAL NOT NULL,updated REAL NOT NULL,revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1)),CHECK(first<second))",
    "CREATE UNIQUE INDEX chat_active_pair ON chat_conversations(first,second) WHERE state='active'",
    "CREATE INDEX chat_first_updated ON chat_conversations(first,updated,id)",
    "CREATE INDEX chat_second_updated ON chat_conversations(second,updated,id)",
    "CREATE TABLE chat_messages(id TEXT PRIMARY KEY,conversation TEXT NOT NULL REFERENCES chat_conversations(id),sender TEXT NOT NULL,client_key TEXT NOT NULL,body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),created REAL NOT NULL,UNIQUE(sender,client_key))",
    "CREATE INDEX chat_message_page ON chat_messages(conversation,created,id)",
    "CREATE INDEX chat_message_retention ON chat_messages(created)",
    "CREATE INDEX chat_message_owner_page ON chat_messages(sender,created,id)",
    "CREATE TABLE chat_reads(conversation TEXT NOT NULL REFERENCES chat_conversations(id),actor TEXT NOT NULL,read_at REAL NOT NULL,message_id TEXT NOT NULL,PRIMARY KEY(conversation,actor))",
    "CREATE TABLE chat_message_keys(sender TEXT NOT NULL,client_key TEXT NOT NULL,fingerprint TEXT NOT NULL,message_id TEXT NOT NULL,PRIMARY KEY(sender,client_key))",
)


def migrate(connection: sqlite3.Connection, statements: tuple[str, ...] = SCHEMA) -> None:
    if connection.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION:
        return
    connection.execute("BEGIN IMMEDIATE")
    try:
        version = connection.execute("PRAGMA user_version").fetchone()[0]
        if version > SCHEMA_VERSION:
            raise ValueError("Unsupported Roommate schema version")
        if version == 0:
            for statement in statements:
                connection.execute(statement)
            connection.execute("PRAGMA user_version=1")
        if version < 2:
            for statement in EXPANSION:
                connection.execute(statement)
            connection.execute("PRAGMA user_version=2")
        if version < 3:
            for statement in CHAT:
                connection.execute(statement)
            connection.execute("PRAGMA user_version=3")
        connection.commit()
    except BaseException:
        connection.rollback()
        raise
