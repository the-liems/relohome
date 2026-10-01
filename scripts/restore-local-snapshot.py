"""Restore the verified teammate dump into a NEW database only; never clean/drop.

Run after starting config/local-integration.compose.yaml. This command refuses an
existing target, checks the dump's SHA256, awaits pg_restore, refreshes planner statistics
(ANALYZE), then runs migrations.
"""

import hashlib
import re
import subprocess
import sys
from pathlib import Path

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT = ROOT / "data/teammate-snapshot"


def main():
    config = dotenv_values(ROOT / "data/integration.env")
    database, user = config.get("POSTGRES_DB", ""), config.get("POSTGRES_ADMIN_USER", "")
    if not all(re.fullmatch(r"[a-z][a-z0-9_]{1,62}", x) for x in (database, user)):
        raise SystemExit("Set safe local DB/user names in data/integration.env first.")
    manifests = {}
    for line in (SNAPSHOT / "SHA256SUMS.txt").read_text(encoding="utf-8").splitlines():
        if match := re.fullmatch(r"([a-fA-F0-9]{64})\s+\*?(.+)", line):
            manifests[match[2]] = match[1].lower()
    with (SNAPSHOT / "database/lifeflow.dump").open("rb") as dump:
        digest = hashlib.file_digest(dump, "sha256").hexdigest()
    if digest != manifests.get("database/lifeflow.dump"):
        raise SystemExit("Dump checksum mismatch; no database was changed.")
    prefix = [
        "docker",
        "compose",
        "--env-file",
        "data/integration.env",
        "-f",
        "config/local-integration.compose.yaml",
        "exec",
        "-T",
        "postgis",
    ]
    exists = subprocess.run(
        prefix
        + ["psql", "-U", user, "-d", "postgres", "-Atc", f"SELECT 1 FROM pg_database WHERE datname='{database}'"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    if exists.stdout.strip():
        raise SystemExit("Target DB already exists. Restore refused; choose a NEW name, never overwrite existing data.")
    subprocess.run(prefix + ["createdb", "--template=template0", "-U", user, database], cwd=ROOT, check=True)
    subprocess.run(
        prefix
        + [
            "pg_restore",
            "--exit-on-error",
            "--no-owner",
            "--no-acl",
            "-U",
            user,
            "-d",
            database,
            "/snapshot/lifeflow.dump",
        ],
        cwd=ROOT,
        check=True,
    )
    # pg_restore does not restore planner statistics. Without them spatial housing/POI
    # queries pick bad plans and hit the 8 s statement timeout.
    subprocess.run(prefix + ["psql", "-U", user, "-d", database, "-c", "ANALYZE"], cwd=ROOT, check=True)
    subprocess.run([sys.executable, "scripts/local-integration.py", "migrate"], cwd=ROOT, check=True)
    print("Snapshot restored and migrations completed. No existing DB was deleted or overwritten.")


if __name__ == "__main__":
    main()
