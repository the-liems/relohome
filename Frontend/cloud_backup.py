"""Back up web accounts, sessions, encryption key and listing photos to a private directory.

Pause writes before taking the accompanying PostGIS dump. This uses SQLite's
backup API so WAL contents are included. Never publish or commit this archive.
"""

import argparse
import hashlib
import json
import os
import shutil
import sqlite3
from pathlib import Path


def backup(destination: Path, database: Path, media: Path, key: Path) -> dict:
    destination.mkdir(mode=0o700, parents=True, exist_ok=False)
    if not database.is_file():
        raise ValueError("Web database does not exist.")
    target = destination / "siu-web.sqlite3"
    with sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True) as source:
        with sqlite3.connect(target) as copy:
            source.backup(copy)
            if copy.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                raise ValueError("SQLite backup integrity check failed.")
    target.chmod(0o600)
    if media.exists():
        shutil.copytree(media, destination / "housing-media")
    if key.is_file():
        shutil.copy2(key, destination / "siu-web-traveler.key")
    elif not os.getenv("SIU_TRAVELER_KEY"):
        raise ValueError("Traveler encryption key is missing. Preserve the external key separately if configured.")
    files = {}
    for path in destination.rglob("*"):
        if path.is_file():
            path.chmod(0o600)
            digest = hashlib.sha256()
            with path.open("rb") as handle:
                for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                    digest.update(chunk)
            files[str(path.relative_to(destination))] = digest.hexdigest()
        elif path.is_dir():
            path.chmod(0o700)
    manifest = {
        "schema": 1,
        "sqlite_integrity": "ok",
        "external_traveler_key": bool(os.getenv("SIU_TRAVELER_KEY")),
        "files": files,
    }
    (destination / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (destination / "manifest.json").chmod(0o600)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--database", type=Path, default=Path(os.getenv("SIU_WEB_DB", "/app/data/siu-web.sqlite3")))
    parser.add_argument(
        "--media", type=Path, default=Path(os.getenv("SIU_HOUSING_MEDIA_DIR", "/app/data/housing-media"))
    )
    parser.add_argument(
        "--key", type=Path, default=Path(os.getenv("SIU_TRAVELER_KEY_FILE", "/app/data/siu-web-traveler.key"))
    )
    args = parser.parse_args()
    try:
        result = backup(args.output, args.database, args.media, args.key)
    except (ValueError, FileExistsError) as error:
        parser.error(str(error))
    print(
        f"Private web backup completed: {len(result['files'])} files. Preserve PostGIS and other service volumes as well."
    )


if __name__ == "__main__":
    main()
