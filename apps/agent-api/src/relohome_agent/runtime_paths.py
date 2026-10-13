"""Deployment paths are independent of the installed wheel's location."""

import os
from pathlib import Path


def runtime_root() -> Path:
    configured = os.getenv("RELOHOME_RUNTIME_ROOT")
    if not configured or not Path(configured).expanduser().is_absolute():
        raise ValueError("RELOHOME_RUNTIME_ROOT must be an absolute deployment/checkout root")
    return Path(configured).expanduser().resolve()


def runtime_path(value: str | Path) -> Path:
    path = Path(value).expanduser()
    return path if path.is_absolute() else runtime_root() / path
