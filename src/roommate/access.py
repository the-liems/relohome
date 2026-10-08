from contextlib import contextmanager
from datetime import datetime

from src.roommate.clock import Clock, SystemClock
from src.roommate.connection_repository import SqlConnections
from src.roommate.contact_vault import ContactVault
from src.roommate.location_catalog import AreaCatalog
from src.roommate.profile_repository import SqlProfiles
from src.roommate.safety_repository import SqlSafety
from src.roommate.storage import Storage


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
    ):
        self.storage = storage
        self.clock = clock or SystemClock()
        self.catalog = catalog or AreaCatalog()
        self.vault = vault
        self.moderators = moderators
        self.profiles = SqlProfiles(storage.connection)
        self.connections = SqlConnections(storage.connection)
        self.safety = SqlSafety(storage.connection)

    @contextmanager
    def transaction(self):
        with self.storage.transaction():
            yield self
