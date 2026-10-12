import json
from contextlib import contextmanager
from pathlib import Path

from src.config import Settings
from src.roommate.access import RoommateContext
from src.roommate.clock import Clock, SystemClock
from src.roommate.contact_vault import ContactVault
from src.roommate.demo import DemoDataset
from src.roommate.location_catalog import AreaCatalog
from src.roommate.storage import Storage


class RoommateRuntime:
    def __init__(
        self,
        path: Path,
        vault: ContactVault,
        catalog: AreaCatalog,
        moderators: frozenset[str],
        token: str,
        clock: Clock | None = None,
        demo: DemoDataset | None = None,
        postgres=None,
    ):
        self.path, self.vault, self.catalog, self.moderators, self.token = path, vault, catalog, moderators, token
        self.clock = clock or SystemClock()
        self.closed = False
        self.demo = demo
        self.postgres = postgres

    @classmethod
    def open(cls, settings: Settings):
        if not settings.roommate_enabled:
            return None
        token = settings.agent_api_token.get_secret_value()
        if not token:
            raise ValueError("Roommate requires a trusted gateway token")
        moderators = frozenset(value.strip() for value in settings.roommate_moderators.split(",") if value.strip())
        if not moderators:
            raise ValueError("Roommate requires at least one configured moderator")
        directory = settings.roommate_state_dir.resolve()
        root = Path(__file__).resolve().parents[2]
        if directory.is_relative_to(root / "data") or directory.is_relative_to(root / "Frontend" / "public"):
            raise ValueError("Roommate state must be outside public data and frontend assets")
        path = directory / "roommate.sqlite3"
        membership = (
            json.loads(settings.roommate_area_catalog.read_text(encoding="utf-8"))
            if settings.roommate_area_catalog
            else {}
        )
        catalog = AreaCatalog(membership)
        demo = None
        if settings.roommate_demo_enabled:
            if settings.app_env == "production" or settings.roommate_demo_dataset is None:
                raise ValueError("Roommate demo requires an explicit dataset and a non-production environment")
            demo_path = settings.roommate_demo_dataset.resolve()
            if demo_path.is_relative_to(root / "Frontend" / "public"):
                raise ValueError("Demo dataset must not be a public frontend asset")
            demo = DemoDataset.load(demo_path)
        postgres = None
        key_value = settings.roommate_contact_key.get_secret_value()
        if settings.roommate_storage == "postgres":
            from src.roommate.postgres import PostgresPool

            if not settings.roommate_database_url.get_secret_value() or not key_value:
                raise ValueError("PostgreSQL Roommate requires database URL and a stable contact key secret")
            vault = ContactVault(directory / "contact.key", create=False, key_value=key_value)
            postgres = PostgresPool(
                settings.roommate_database_url.get_secret_value(),
                settings.roommate_database_schema,
                max_size=settings.roommate_database_pool_size,
            )
            try:
                postgres.initialize()
                with postgres.storage() as storage, storage.transaction():
                    metadata = storage.connection.execute(
                        "SELECT value FROM private_metadata WHERE name='contact_key'"
                    ).fetchone()
                    if metadata and metadata[0] != vault.fingerprint:
                        raise ValueError("Roommate contact key does not match the existing database")
                    sample = storage.connection.execute(
                        "SELECT ciphertext FROM contacts WHERE ciphertext IS NOT NULL LIMIT 1"
                    ).fetchone()
                    if sample:
                        vault.open(bytes(sample[0]))
                    storage.connection.execute(
                        "INSERT INTO private_metadata VALUES ('contact_key',?) ON CONFLICT(name) DO NOTHING",
                        (vault.fingerprint,),
                    )
            except BaseException:
                postgres.close()
                raise
        else:
            vault = ContactVault(directory / "contact.key", create=not path.exists(), key_value=key_value)
            with Storage(path) as storage, storage.transaction():
                metadata = storage.connection.execute(
                    "SELECT value FROM private_metadata WHERE name='contact_key'"
                ).fetchone()
                if metadata and metadata[0] != vault.fingerprint:
                    raise ValueError("Roommate contact key does not match the existing database")
                sample = storage.connection.execute(
                    "SELECT ciphertext FROM contacts WHERE ciphertext IS NOT NULL LIMIT 1"
                ).fetchone()
                if sample:
                    vault.open(bytes(sample[0]))
                storage.connection.execute(
                    "INSERT INTO private_metadata VALUES ('contact_key',?) ON CONFLICT(name) DO NOTHING",
                    (vault.fingerprint,),
                )
        return cls(path, vault, catalog, moderators, token, demo=demo, postgres=postgres)

    @contextmanager
    def context(self):
        if self.closed:
            raise RuntimeError("Roommate runtime is closed")
        storage_context = self.postgres.storage() if self.postgres else Storage(self.path, initialize=False)
        with storage_context as storage:
            yield RoommateContext(
                storage, clock=self.clock, catalog=self.catalog, vault=self.vault, moderators=self.moderators
            )

    def close(self) -> None:
        self.closed = True
        if self.postgres:
            self.postgres.close()
