"""Provision an operator account without exposing public Admin registration.

Run inside the web container, as its normal user. The returned user ID belongs
in HOUSING_MODERATOR_IDS on Platform. Passwords are prompted, never CLI arguments.
"""

import argparse
import getpass
import secrets
import sqlite3
from pathlib import Path

from relohome_gateway.runtime_paths import database_path, runtime_root
from relohome_gateway.store import Store, password_hash


def provision(database: Path, email: str, name: str, password: str | None = None, existing: bool = False) -> str:
    email = email.strip().lower()
    if not email or "@" not in email or len(email) > 254:
        raise ValueError("Enter a valid operator email.")
    # Existing web processes may have active runs. Store startup performs runtime
    # recovery, so use it only to initialize a new database, never for a live one.
    if not database.exists():
        if existing:
            raise ValueError("This web database does not exist.")
        Store(database).db.close()
    connection = sqlite3.connect(database)
    connection.row_factory = sqlite3.Row
    try:
        current = connection.execute("SELECT id FROM users WHERE email=?", (email,)).fetchone()
        if existing:
            if not current:
                raise ValueError("This account does not exist. Omit --existing to create a dedicated operator account.")
            return current["id"]
        if current:
            raise ValueError("This email exists. Use --existing explicitly; its password will be preserved.")
        if not name.strip() or not password or not 12 <= len(password) <= 200:
            raise ValueError("A display name and a password of at least 12 characters are required.")
        salt, identifier = secrets.token_hex(16), secrets.token_hex(16)
        with connection:
            connection.execute(
                "INSERT INTO users(id,email,name,salt,password) VALUES (?,?,?,?,?)",
                (identifier, email, name.strip(), salt, password_hash(password, salt)),
            )
        return identifier
    finally:
        connection.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--email", required=True)
    parser.add_argument("--name", default="ReloHome Admin")
    parser.add_argument("--database", type=Path, help="Override SIU_WEB_DB; relative paths use RELOHOME_RUNTIME_ROOT.")
    parser.add_argument(
        "--existing", action="store_true", help="Select an existing account without changing its password."
    )
    args = parser.parse_args()
    try:
        database = database_path(runtime_root(), args.database)
    except ValueError as error:
        parser.error(str(error))
    password = None
    if not args.existing:
        password = getpass.getpass("New Admin password (12+ characters): ")
        if password != getpass.getpass("Confirm password: "):
            parser.error("Passwords differ.")
    try:
        identifier = provision(database, args.email, args.name, password, args.existing)
    except ValueError as error:
        parser.error(str(error))
    print("Operator account ID: " + identifier)
    print("Append this ID to HOUSING_MODERATOR_IDS in the target Coolify resource, preserving existing IDs.")
    print("Save and redeploy/recreate Platform to apply the updated environment.")
    print("Sign in through /admin using this account. Existing sessions retain their workspace.")


if __name__ == "__main__":
    main()
