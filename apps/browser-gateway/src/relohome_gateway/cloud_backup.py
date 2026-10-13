"""Back up web accounts, sessions, encryption key and listing photos to a private directory.

Pause writes before taking the accompanying PostGIS dump. This uses SQLite's
backup API so WAL contents are included. Never publish or commit this archive.
"""

import argparse
import csv
import hashlib
import json
import os
import re
import shutil
import sqlite3
import subprocess
from pathlib import Path

from relohome_gateway.runtime_paths import database_path, media_path, runtime_root, traveler_key_path


def _restrict_windows_directory(directory: Path) -> None:
    """Protect a newly created directory before copying any account data or keys."""
    try:
        options = {
            "check": True,
            "capture_output": True,
            "text": True,
            "timeout": 10,
            "creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0),
        }
        identity = subprocess.run(["whoami.exe", "/user", "/fo", "csv", "/nh"], **options)
        sid = next(csv.reader(identity.stdout.splitlines()))[1].strip()
        if not re.fullmatch(r"S-1-(?:\d+-)*\d+", sid):
            raise ValueError("Invalid account SID.")
        # The new directory has only inherited ACEs. Remove them and grant the
        # operator and SYSTEM access, inherited by all copied files/directories.
        subprocess.run(
            [
                "icacls.exe",
                str(directory.resolve()),
                "/inheritance:r",
                "/grant:r",
                f"*{sid}:(OI)(CI)F",
                "*S-1-5-18:(OI)(CI)F",
                "/q",
            ],
            **options,
        )
    except (OSError, subprocess.SubprocessError, ValueError, IndexError, StopIteration) as error:
        raise ValueError("Cannot secure the Windows backup directory; no backup data was copied.") from error


def backup(destination: Path, database: Path, media: Path, key: Path) -> dict:
    if not database.is_file():
        raise ValueError("Web database does not exist.")
    if not key.is_file() and not os.getenv("SIU_TRAVELER_KEY"):
        raise ValueError("Traveler encryption key is missing. Preserve the external key separately if configured.")
    destination.mkdir(mode=0o700, parents=True, exist_ok=False)
    if os.name == "nt":
        _restrict_windows_directory(destination)
    else:
        destination.chmod(0o700)
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
    parser.add_argument("--database", type=Path, help="Override SIU_WEB_DB; relative paths use RELOHOME_RUNTIME_ROOT.")
    parser.add_argument(
        "--media", type=Path, help="Override SIU_HOUSING_MEDIA_DIR; relative paths use RELOHOME_RUNTIME_ROOT."
    )
    parser.add_argument(
        "--key", type=Path, help="Override SIU_TRAVELER_KEY_FILE; relative paths use RELOHOME_RUNTIME_ROOT."
    )
    args = parser.parse_args()
    try:
        root = runtime_root()
        database = database_path(root, args.database)
        result = backup(
            args.output, database, media_path(root, args.media), traveler_key_path(database, root, args.key)
        )
    except (ValueError, FileExistsError) as error:
        parser.error(str(error))
    print(
        f"Private web backup completed: {len(result['files'])} files. Preserve PostGIS and other service volumes as well."
    )


if __name__ == "__main__":
    main()
