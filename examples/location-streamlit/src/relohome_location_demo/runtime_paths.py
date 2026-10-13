"""Resolve external configuration explicitly for checkout and wheel launches."""

import os
from pathlib import Path


def repository_root() -> Path:
    configured = os.environ.get("RELOHOME_RUNTIME_ROOT")
    if configured:
        return Path(configured).expanduser().resolve()
    for directory in Path(__file__).resolve().parents:
        if (directory / "package.json").is_file() and (directory / "apps/location-mcp").is_dir():
            return directory
    raise RuntimeError("Set RELOHOME_RUNTIME_ROOT to the repository root when launching the installed location demo.")
