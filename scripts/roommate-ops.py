"""Private Roommate operations. Secrets are read from environment/files, never arguments."""

import argparse
import json
import os
import sys
from pathlib import Path

os.environ.setdefault("RELOHOME_RUNTIME_ROOT", str(Path(__file__).resolve().parents[1]))

from relohome_agent.config import get_settings
from relohome_agent.roommate_runtime import RoommateRuntime
from relohome_roommate.operations import TABLES, backup, backup_sqlite, import_snapshot


def provision(settings):
    import re

    import psycopg
    from psycopg import sql

    role = os.environ.get("ROOMMATE_DB_USER", "p044_roommate_app")
    password = os.environ.get("ROOMMATE_DB_PASSWORD", "")
    admin = os.environ.get("ROOMMATE_ADMIN_DATABASE_URL", "")
    if not admin or not password or not re.fullmatch(r"[a-z][a-z0-9_]*roommate[a-z0-9_]*", role):
        raise ValueError("Provision requires a dedicated roommate role, admin URL and password in environment")
    schema = settings.roommate_database_schema
    if not re.fullmatch(r"[a-z][a-z0-9_]{0,62}", schema) or schema in ("public", "pg_catalog", "information_schema"):
        raise ValueError("Provision requires a private schema name")
    with psycopg.connect(admin) as connection:
        exists = connection.execute("SELECT 1 FROM pg_roles WHERE rolname=%s", (role,)).fetchone()
        if not exists:
            connection.execute(
                sql.SQL("CREATE ROLE {} LOGIN PASSWORD {}").format(sql.Identifier(role), sql.Literal(password))
            )
        else:
            connection.execute(
                sql.SQL("ALTER ROLE {} LOGIN PASSWORD {}").format(sql.Identifier(role), sql.Literal(password))
            )
        connection.execute(
            sql.SQL("CREATE SCHEMA IF NOT EXISTS {} AUTHORIZATION {}").format(
                sql.Identifier(schema), sql.Identifier(role)
            )
        )
        connection.execute(
            sql.SQL("GRANT USAGE,CREATE ON SCHEMA {} TO {}").format(sql.Identifier(schema), sql.Identifier(role))
        )
    return {"provisioned": True, "schema": schema, "role": role}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("check", "backup", "backup-sqlite", "import", "provision"))
    parser.add_argument("--directory", type=Path)
    args = parser.parse_args()
    settings = get_settings()
    if args.command == "backup-sqlite":
        if not args.directory or settings.roommate_storage != "sqlite":
            raise ValueError("Provide a private backup directory and select SQLite source")
        print(
            json.dumps(
                backup_sqlite(
                    settings.roommate_state_dir,
                    args.directory,
                    key_value=settings.roommate_contact_key.get_secret_value() or None,
                )
            )
        )
        return
    if args.command == "provision":
        print(json.dumps(provision(settings)))
        return
    runtime = RoommateRuntime.open(settings)
    if not runtime:
        raise ValueError("Roommate is disabled")
    try:
        if args.command == "backup":
            if not args.directory:
                raise ValueError("Provide a new private backup directory")
            result = backup(runtime, args.directory)
        elif args.command == "import":
            if not args.directory:
                raise ValueError("Provide the private snapshot directory")
            result = import_snapshot(runtime, args.directory)
        else:
            with runtime.context() as ctx, ctx.read_transaction():
                counts = {
                    table: ctx.storage.connection.execute("SELECT COUNT(*) FROM " + table).fetchone()[0]
                    for table in TABLES
                }
                result = {
                    "storage": settings.roommate_storage,
                    "schema": settings.roommate_database_schema if runtime.postgres else "sqlite",
                    "configured_moderators": len(runtime.moderators),
                    "counts": counts,
                    "contact_key_verified": True,
                }
        print(json.dumps(result))
    finally:
        runtime.close()


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Avoid connection strings, rejected private input and traceback in operator output.
        print("Roommate operation failed. Check private config/key, destination and operator runbook.", file=sys.stderr)
        sys.exit(1)
