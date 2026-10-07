import sqlite3
from contextlib import contextmanager
from pathlib import Path

from src.roommate.migrations import migrate


def require_transaction(connection: sqlite3.Connection) -> None:
    if not connection.in_transaction:
        raise RuntimeError("Roommate writes require an explicit unit-of-work transaction")


class Storage:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self.connection = sqlite3.connect(path, isolation_level=None, timeout=10)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA foreign_keys=ON")
        self.connection.execute("PRAGMA journal_mode=WAL")
        self.connection.execute("PRAGMA busy_timeout=10000")
        try:
            migrate(self.connection)
        except BaseException:
            self.close()
            raise

    @contextmanager
    def transaction(self):
        # Fail nested transactions rather than accidentally committing an outer write.
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            yield self
            self.connection.commit()
        except BaseException:
            self.connection.rollback()
            raise

    def close(self) -> None:
        self.connection.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()
