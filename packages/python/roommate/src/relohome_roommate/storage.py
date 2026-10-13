import sqlite3
from contextlib import contextmanager
from pathlib import Path

from relohome_roommate.migrations import migrate


def require_transaction(connection: sqlite3.Connection) -> None:
    if not connection.in_transaction:
        raise RuntimeError("Roommate writes require an explicit unit-of-work transaction")


class Storage:
    def __init__(self, path: Path, *, initialize: bool = True, readonly: bool = False):
        if readonly and initialize:
            raise ValueError("Read-only Roommate storage cannot run migrations")
        if not readonly:
            path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        # Each unit of work owns its connection; FastAPI sync dependencies can enter/exit on different workers.
        self.connection = sqlite3.connect(
            path.resolve().as_uri() + "?mode=ro" if readonly else path,
            uri=readonly,
            isolation_level=None,
            timeout=10,
            check_same_thread=False,
        )
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA foreign_keys=ON")
        if not readonly:
            self.connection.execute("PRAGMA journal_mode=WAL")
        self.connection.execute("PRAGMA busy_timeout=10000")
        try:
            if initialize:
                migrate(self.connection)
        except BaseException:
            self.close()
            raise

    @contextmanager
    def transaction(self, *, readonly: bool = False):
        # Fail nested transactions rather than accidentally committing an outer write.
        if self.connection.in_transaction:
            raise RuntimeError("Nested Roommate transactions are not supported")
        if readonly:
            self.connection.execute("PRAGMA query_only=ON")
        self.connection.execute("BEGIN" if readonly else "BEGIN IMMEDIATE")
        try:
            yield self
            self.connection.commit()
        except BaseException:
            self.connection.rollback()
            raise
        finally:
            if readonly:
                self.connection.execute("PRAGMA query_only=OFF")

    def close(self) -> None:
        self.connection.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()
