"""Restore the verified teammate dump into a NEW database only; never clean/drop.

Run after starting config/local-integration.compose.yaml. This command refuses an
existing target, checks the dump's SHA256, awaits pg_restore, refreshes planner statistics
(ANALYZE), then runs migrations.
"""

import argparse
import hashlib
import os
import re
import runpy
import subprocess
import uuid
from pathlib import Path

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT = ROOT / "data/teammate-snapshot"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--snapshot", type=Path, default=SNAPSHOT, help="Verified snapshot directory; never overwritten."
    )
    parser.add_argument("--database", help="Restore to a NEW DB without changing .env.local.")
    parser.add_argument("--env-file", type=Path, default=ROOT / ".env.local")
    args = parser.parse_args()
    args.env_file = args.env_file.expanduser().resolve()
    if not args.env_file.is_file():
        parser.error(f"Missing local configuration: {args.env_file}")
    config = {**{k: v for k, v in dotenv_values(args.env_file).items() if v is not None}, **os.environ}
    database, user = args.database or config.get("POSTGRES_DB", ""), config.get("POSTGRES_ADMIN_USER", "")
    if not all(re.fullmatch(r"[a-z][a-z0-9_]{1,62}", x) for x in (database, user)):
        raise SystemExit("Set safe local DB/user names in .env.local first.")
    manifests = {}
    snapshot = args.snapshot.resolve()
    for line in (snapshot / "SHA256SUMS.txt").read_text(encoding="utf-8").splitlines():
        if match := re.fullmatch(r"([a-fA-F0-9]{64})\s+\*?(.+)", line):
            manifests[match[2]] = match[1].lower()
    dump_path = snapshot / "database/lifeflow.dump"
    with dump_path.open("rb") as dump:
        digest = hashlib.file_digest(dump, "sha256").hexdigest()
    if digest != manifests.get("database/lifeflow.dump"):
        raise SystemExit("Dump checksum mismatch; no database was changed.")
    prefix = [
        "docker",
        "compose",
        "--env-file",
        str(args.env_file),
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
    # The existing container may mount an older snapshot. Copy the exact
    # checksum-verified dump, never restore whichever file happens to be mounted.
    remote_dump = "/tmp/lifeflow-restore-" + uuid.uuid4().hex + ".dump"
    subprocess.run(prefix[:6] + ["cp", str(dump_path), "postgis:" + remote_dump], cwd=ROOT, check=True)
    try:
        subprocess.run(
            prefix
            + ["pg_restore", "--exit-on-error", "--no-owner", "--no-acl", "-U", user, "-d", database, remote_dump],
            cwd=ROOT,
            check=True,
        )
    finally:
        # Only the unique temporary copy created above, never a database/volume
        # or the original snapshot. A failed restore DB is retained for diagnosis.
        subprocess.run(prefix + ["rm", "--", remote_dump], cwd=ROOT, check=True)
    # pg_restore does not restore planner statistics. Without them spatial housing/POI
    # queries pick bad plans and hit the 8 s statement timeout.
    subprocess.run(prefix + ["psql", "-U", user, "-d", database, "-c", "ANALYZE"], cwd=ROOT, check=True)
    migration_env = runpy.run_path(str(ROOT / "scripts/local-integration.py"))["environment"](
        "migrate", env_file=args.env_file
    )
    migration_env["POSTGRES_DB"] = database
    subprocess.run(
        ["node", "apps/platform-api/dist/migrate.js"], cwd=ROOT, env=migration_env, check=True
    )
    print(
        f"Snapshot restored into {database}; ANALYZE/migrations completed. Existing DBs unchanged; temporary dump copy removed."
    )


if __name__ == "__main__":
    main()
