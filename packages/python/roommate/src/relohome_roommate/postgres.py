"""PostgreSQL adapter for the existing Roommate SQL repositories.

The small dialect boundary preserves domain rules. Mutations take a database
transaction lock shared by replicas, matching SQLite's serialized write policy.
Readers use independent MVCC snapshots and never take that writer lock.
"""

import re
from contextlib import contextmanager

from psycopg import pq, sql
from psycopg_pool import ConnectionPool

from relohome_roommate.migrations import CHAT, EXPANSION, SCHEMA, SCHEMA_VERSION


class Row(dict):
    def __getitem__(self, key):
        return tuple(self.values())[key] if isinstance(key, int) else super().__getitem__(key)


def row_factory(cursor):
    names = [column.name for column in cursor.description] if cursor.description else []
    return lambda values: Row(zip(names, values, strict=True))


def dialect(statement: str) -> str:
    # All statements are repository-owned constants; user values remain bound.
    statement = statement.replace("?", "%s")
    statement = statement.replace(
        "json_extract(p.content,'$.content.room.listing_id')", "(p.content::jsonb #>> '{content,room,listing_id}')"
    )
    statement = statement.replace(
        "json_extract(content,'$.content.room.listing_id')", "(content::jsonb #>> '{content,room,listing_id}')"
    )
    statement = statement.replace("until=MAX(until,excluded.until)", "until=GREATEST(cooldowns.until,excluded.until)")
    if statement.startswith("INSERT OR IGNORE INTO "):
        statement = statement.replace("INSERT OR IGNORE INTO ", "INSERT INTO ", 1) + " ON CONFLICT DO NOTHING"
    return statement


class Connection:
    def __init__(self, connection):
        self.raw = connection

    @property
    def in_transaction(self):
        return self.raw.info.transaction_status != pq.TransactionStatus.IDLE

    def execute(self, statement, parameters=()):
        return self.raw.execute(dialect(statement), parameters)

    def commit(self):
        self.raw.commit()

    def rollback(self):
        self.raw.rollback()


class PostgresPool:
    def __init__(self, url: str, schema: str = "roommate", *, max_size: int = 8):
        if not re.fullmatch(r"[a-z][a-z0-9_]{0,62}", schema) or schema in {
            "public",
            "pg_catalog",
            "information_schema",
        }:
            raise ValueError("Roommate requires a private schema name")
        self.schema = schema
        self.pool = ConnectionPool(
            url,
            min_size=1,
            max_size=max_size,
            timeout=10,
            max_waiting=32,
            kwargs={"autocommit": True, "row_factory": row_factory, "connect_timeout": 5},
            open=False,
        )
        try:
            self.pool.open(wait=True, timeout=10)
        except BaseException:
            self.pool.close()
            raise

    def initialize(self):
        with self.pool.connection() as raw, raw.transaction():
            raw.execute("SELECT pg_advisory_xact_lock(782014401)")
            # The operator provisions the private schema. Existing schemas must
            # not require CREATE on the entire application database at startup.
            if not raw.execute("SELECT 1 FROM pg_namespace WHERE nspname=%s", (self.schema,)).fetchone():
                raw.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(self.schema)))
            raw.execute(sql.SQL("SET LOCAL search_path TO {},pg_catalog").format(sql.Identifier(self.schema)))
            raw.execute("CREATE TABLE IF NOT EXISTS schema_version(version INTEGER PRIMARY KEY)")
            current = raw.execute("SELECT COALESCE(MAX(version),0) FROM schema_version").fetchone()[0]
            if current > SCHEMA_VERSION:
                raise ValueError("Unsupported Roommate schema version")
            for version, statements in ((1, SCHEMA), (2, EXPANSION), (3, CHAT)):
                if current >= version:
                    continue
                for statement in statements:
                    statement = re.sub(r"\bREAL\b", "DOUBLE PRECISION", statement)
                    statement = re.sub(r"\bBLOB\b", "BYTEA", statement)
                    raw.execute(dialect(statement))
                raw.execute("INSERT INTO schema_version VALUES (%s)", (version,))

    @contextmanager
    def storage(self):
        with self.pool.connection() as raw:
            raw.execute(sql.SQL("SET search_path TO {},pg_catalog").format(sql.Identifier(self.schema)))
            raw.execute("SET statement_timeout='8s'")
            raw.execute("SET lock_timeout='5s'")
            raw.execute("SET idle_in_transaction_session_timeout='15s'")
            yield PostgresStorage(raw)

    def close(self):
        self.pool.close()


class PostgresStorage:
    def __init__(self, raw):
        self.connection = Connection(raw)

    @contextmanager
    def transaction(self, *, readonly: bool = False):
        if self.connection.in_transaction:
            raise RuntimeError("Nested Roommate transactions are not supported")
        raw = self.connection.raw
        raw.execute("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" if readonly else "BEGIN")
        try:
            if not readonly:
                raw.execute("SELECT pg_advisory_xact_lock(782014402)")
            yield self
            raw.commit()
        except BaseException:
            raw.rollback()
            raise
