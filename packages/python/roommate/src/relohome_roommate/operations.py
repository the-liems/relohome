"""Offline portable backup/import helpers. Never includes other application data."""

import os
import sqlite3
from pathlib import Path
from uuid import uuid4

from relohome_roommate.migrations import CHAT, EXPANSION, SCHEMA
from relohome_roommate.storage import Storage

TABLES = tuple(
    statement.split("(")[0].split()[-1]
    for statement in (*SCHEMA, *EXPANSION, *CHAT)
    if statement.startswith("CREATE TABLE ")
)


def _rows(connection, table):
    if hasattr(connection, "raw"):
        cursor = connection.raw.cursor(name="rmbackup_" + uuid4().hex)
        cursor.execute("SELECT * FROM " + table)
    else:
        cursor = connection.execute("SELECT * FROM " + table)
    try:
        while batch := cursor.fetchmany(20):
            yield from batch
    finally:
        cursor.close()


def transfer(source, destination, *, skip_metadata=False):
    counts = {}
    for table in TABLES:
        if table == "private_metadata" and skip_metadata:
            continue
        if (
            not hasattr(source.connection, "raw")
            and not source.connection.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)
            ).fetchone()
        ):
            continue
        if destination.connection.execute("SELECT COUNT(*) FROM " + table).fetchone()[0]:
            raise ValueError("Roommate import requires an empty destination")
        count = 0
        for row in _rows(source.connection, table):
            columns = list(row.keys())
            values = [bytes(row[key]) if isinstance(row[key], memoryview) else row[key] for key in columns]
            destination.connection.execute(
                "INSERT INTO " + table + "(" + ",".join(columns) + ") VALUES (" + ",".join("?" for _ in columns) + ")",
                values,
            )
            count += 1
        counts[table] = count
    return counts


def _runtime_path(path: Path) -> Path:
    configured_root = os.getenv("RELOHOME_RUNTIME_ROOT")
    if not configured_root or not Path(configured_root).expanduser().is_absolute():
        raise ValueError("RELOHOME_RUNTIME_ROOT must be an absolute path for Roommate")
    root = Path(configured_root).expanduser().resolve()
    return (path if path.is_absolute() else root / path).resolve()


def _private_destination(directory: Path):
    directory = _runtime_path(directory)
    root = _runtime_path(Path("."))
    if directory.is_relative_to(root / "data") or any(
        directory.is_relative_to(root / public) for public in ("Frontend/public", "apps/web/public", "apps/web/dist")
    ):
        raise ValueError("Roommate backups must stay outside public data")
    directory.mkdir(parents=True, exist_ok=False, mode=0o700)
    return directory


def backup_sqlite(source_directory: Path, directory: Path, *, key_value: str | None = None):
    """Snapshot legacy state before Runtime.open can migrate it; includes WAL commits."""
    from relohome_roommate.contact_vault import ContactVault

    source_directory = _runtime_path(source_directory)
    source_path = source_directory / "roommate.sqlite3"
    if not source_path.is_file():
        raise ValueError("Roommate source database is missing")
    vault = ContactVault(source_directory / "contact.key", create=False, key_value=key_value)
    directory = _private_destination(directory)
    vault.backup_key(directory / "contact.key")
    target = directory / "roommate.sqlite3"
    with sqlite3.connect(source_path.as_uri() + "?mode=ro", uri=True) as source, sqlite3.connect(target) as destination:
        source.backup(destination)
        if (
            destination.execute("PRAGMA integrity_check").fetchone()[0] != "ok"
            or destination.execute("PRAGMA foreign_key_check").fetchone()
        ):
            raise ValueError("Roommate backup integrity check failed")
        schema = destination.execute("PRAGMA user_version").fetchone()[0]
    os.chmod(target, 0o600)
    return {"path": str(directory), "schema_version": schema, "integrity": "ok"}


def backup(runtime, directory: Path):
    directory = _private_destination(directory)
    target = directory / "roommate.sqlite3"
    key_path = directory / "contact.key"
    # Preserve the exact Fernet key; never write it to logs or arguments.
    runtime.vault.backup_key(key_path)
    with runtime.context() as source:
        if not runtime.postgres:
            with Storage(target) as destination:
                source.storage.connection.backup(destination.connection)
        else:
            with source.read_transaction(), Storage(target) as destination, destination.transaction():
                transfer(source.storage, destination)
    os.chmod(target, 0o600)
    with Storage(target, initialize=False, readonly=True) as snapshot:
        if (
            snapshot.connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok"
            or snapshot.connection.execute("PRAGMA foreign_key_check").fetchone()
        ):
            raise ValueError("Roommate backup integrity check failed")
    return {"path": str(directory), "schema": "roommate", "integrity": "ok"}


def import_snapshot(runtime, directory: Path):
    from relohome_roommate.contact_vault import ContactVault

    directory = _runtime_path(directory)
    source_vault = ContactVault(directory / "contact.key", create=False)
    if not (directory / "roommate.sqlite3").is_file():
        raise ValueError("Roommate snapshot database is missing")
    if source_vault.fingerprint != runtime.vault.fingerprint:
        raise ValueError("Import requires the exact source contact key")
    with (
        Storage(directory / "roommate.sqlite3", initialize=False, readonly=True) as source,
        runtime.context() as target,
    ):
        if (
            source.connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok"
            or source.connection.execute("PRAGMA foreign_key_check").fetchone()
        ):
            raise ValueError("Roommate snapshot integrity check failed")
        with source.transaction(readonly=True), target.transaction():
            counts = transfer(source, target.storage, skip_metadata=True)
        return {"imported": counts, "policy": "versions and deadlines preserved"}
