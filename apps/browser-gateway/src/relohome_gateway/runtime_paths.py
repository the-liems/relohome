"""Explicit deployment paths, independent of wheel location and working directory."""

import os
from pathlib import Path


def runtime_root() -> Path:
    configured = os.getenv("RELOHOME_RUNTIME_ROOT")
    if configured:
        root = Path(configured).expanduser()
        if not root.is_absolute():
            raise ValueError("RELOHOME_RUNTIME_ROOT must be an absolute path")
        return root.resolve()
    raise ValueError("Set RELOHOME_RUNTIME_ROOT to the existing deployment/checkout root")


def database_path(root: Path, override=None) -> Path:
    value = Path(override or os.getenv("SIU_WEB_DB", "data/siu-web.sqlite3"))
    return value if value.is_absolute() else root / value


def media_path(root: Path, override=None) -> Path:
    value = Path(override or os.getenv("SIU_HOUSING_MEDIA_DIR", "Frontend/data/housing-media"))
    return value if value.is_absolute() else root / value


def traveler_key_path(database: Path, root: Path, override=None) -> Path:
    value = Path(override or os.getenv("SIU_TRAVELER_KEY_FILE", str(database.parent / "siu-web-traveler.key")))
    return value if value.is_absolute() else root / value
