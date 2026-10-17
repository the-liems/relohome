import json
import os
from contextlib import contextmanager
from pathlib import Path

from relohome_agent.config import Settings
from relohome_roommate.access import RoommateContext
from relohome_roommate.clock import Clock, SystemClock
from relohome_roommate.contact_vault import ContactVault
from relohome_roommate.location_catalog import AreaCatalog
from relohome_roommate.storage import Storage


class RoommateRuntime:
    def __init__(
        self,
        path: Path,
        vault: ContactVault,
        catalog: AreaCatalog,
        moderators: frozenset[str],
        token: str,
        clock: Clock | None = None,
        postgres=None,
        chat_retention_days: int = 180,
    ):
        self.path, self.vault, self.catalog, self.moderators, self.token = path, vault, catalog, moderators, token
        self.clock = clock or SystemClock()
        self.closed = False
        self.postgres = postgres
        self.chat_retention_days = chat_retention_days

    @classmethod
    def open(cls, settings: Settings):
        if not settings.roommate_enabled:
            return None
        token = settings.agent_api_token.get_secret_value()
        if not token:
            raise ValueError("Roommate requires a trusted gateway token")
        moderators = frozenset(
            value.strip()
            for configured in (settings.housing_moderator_ids, settings.roommate_moderators)
            for value in configured.split(",")
            if value.strip()
        )
        if not moderators:
            raise ValueError("Roommate requires a moderator in HOUSING_MODERATOR_IDS or ROOMMATE_MODERATORS")
        configured_root = os.getenv("RELOHOME_RUNTIME_ROOT")
        if not configured_root or not Path(configured_root).expanduser().is_absolute():
            raise ValueError("RELOHOME_RUNTIME_ROOT must be an absolute path for Roommate")
        root = Path(configured_root).expanduser().resolve()

        def runtime_path(value: Path) -> Path:
            return (value if value.is_absolute() else root / value).resolve()

        directory = runtime_path(settings.roommate_state_dir)
        if directory.is_relative_to(root / "data") or any(
            directory.is_relative_to(root / public)
            for public in ("Frontend/public", "apps/web/public", "apps/web/dist")
        ):
            raise ValueError("Roommate state must be outside public data and frontend assets")
        path = directory / "roommate.sqlite3"
        membership = (
            json.loads(runtime_path(settings.roommate_area_catalog).read_text(encoding="utf-8"))
            if settings.roommate_area_catalog
            else {}
        )
        catalog = AreaCatalog(membership)
        postgres = None
        key_value = settings.roommate_contact_key.get_secret_value()
        if settings.roommate_storage == "postgres":
            from relohome_roommate.postgres import PostgresPool

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
        return cls(
            path,
            vault,
            catalog,
            moderators,
            token,
            postgres=postgres,
            chat_retention_days=settings.roommate_chat_retention_days,
        )

    @contextmanager
    def context(self):
        if self.closed:
            raise RuntimeError("Roommate runtime is closed")
        storage_context = self.postgres.storage() if self.postgres else Storage(self.path, initialize=False)
        with storage_context as storage:
            yield RoommateContext(
                storage,
                clock=self.clock,
                catalog=self.catalog,
                vault=self.vault,
                moderators=self.moderators,
                chat_retention_days=self.chat_retention_days,
            )

    def close(self) -> None:
        self.closed = True
        if self.postgres:
            self.postgres.close()
