from contextlib import contextmanager
from datetime import datetime

from relohome_roommate.clock import Clock, SystemClock
from relohome_roommate.connection_repository import SqlConnections
from relohome_roommate.contact_vault import ContactVault
from relohome_roommate.location_catalog import AreaCatalog
from relohome_roommate.profile_repository import SqlProfiles
from relohome_roommate.safety_repository import SqlSafety
from relohome_roommate.storage import Storage


class RoommateError(ValueError):
    def __init__(self, code: str, *, status: int = 409, until: datetime | None = None, reasons: tuple[str, ...] = ()):
        super().__init__(code)
        self.code, self.status, self.until, self.reasons = code, status, until, reasons


class RoommateContext:
    def __init__(
        self,
        storage: Storage,
        *,
        clock: Clock | None = None,
        catalog: AreaCatalog | None = None,
        vault: ContactVault | None = None,
        moderators: frozenset[str] = frozenset(),
        chat_retention_days: int = 180,
    ):
        self.storage = storage
        self.clock = clock or SystemClock()
        self.catalog = catalog or AreaCatalog()
        self.vault = vault
        self.moderators = moderators
        if not 1 <= chat_retention_days <= 3650:
            raise ValueError("Invalid chat retention")
        self.chat_retention_days = chat_retention_days
        self.profiles = SqlProfiles(storage.connection)
        self.connections = SqlConnections(storage.connection, self.clock)
        self.safety = SqlSafety(storage.connection)

    @contextmanager
    def transaction(self):
        with self.storage.transaction():
            yield self

    @contextmanager
    def read_transaction(self):
        with self.storage.transaction(readonly=True):
            yield self
