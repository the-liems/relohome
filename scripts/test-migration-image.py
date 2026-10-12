"""Exercise a built release migration image against an isolated real database."""

import argparse
import json
import secrets
import signal
import subprocess
import sys
import time
import uuid
from pathlib import Path

import yaml


def docker(*args, capture=False, timeout=180, check=True, quiet=False):
    result = subprocess.run(
        ["docker", *args],
        check=check,
        text=True,
        stdout=subprocess.DEVNULL if quiet else subprocess.PIPE if capture else None,
        stderr=subprocess.DEVNULL if quiet else None,
        timeout=timeout,
    )

    return result.stdout if capture else result.returncode


def verify(kind, image, database_image=None):
    name = "migration-test-" + uuid.uuid4().hex[:12]
    database = name + "-db"
    migration = name + "-run"
    admin_password, app_password, ingest_password = [secrets.token_hex(24) for _ in range(3)]
    location = kind == "location-migrate"
    # Read raw YAML: Coolify adds fields that Docker Compose does not accept.
    compose = yaml.safe_load((Path(__file__).resolve().parents[1] / "compose.coolify.yaml").read_text())
    database_image = database_image or compose["services"]["postgis" if location else "moving-db"]["image"]
    history = "public.lifeflow_schema_migrations" if location else "moving.schema_migrations"
    env = (
        {
            "POSTGRES_HOST": database,
            "POSTGRES_PORT": "5432",
            "POSTGRES_DB": "migration_test",
            "POSTGRES_ADMIN_USER": "migration_admin",
            "POSTGRES_ADMIN_PASSWORD": admin_password,
            "POSTGRES_APP_USER": "migration_app",
            "POSTGRES_APP_PASSWORD": app_password,
            "POSTGRES_INGEST_USER": "migration_ingest",
            "POSTGRES_INGEST_PASSWORD": ingest_password,
        }
        if location
        else {
            "MOVING_DATABASE_ADMIN_URL": f"postgresql://migration_admin:{admin_password}@{database}:5432/migration_test",
            "MOVING_DB_APP_USER": "migration_app",
            "MOVING_DB_APP_PASSWORD": app_password,
        }
    )

    def sql(query, user="migration_admin", password=admin_password):
        return docker(
            "exec",
            "-e",
            "PGPASSWORD=" + password,
            database,
            "psql",
            "-X",
            "-h",
            "127.0.0.1",
            "-U",
            user,
            "-d",
            "migration_test",
            "-v",
            "ON_ERROR_STOP=1",
            "-Atc",
            query,
            capture=True,
        ).strip()

    try:
        docker("network", "create", name)
        docker(
            "run",
            "-d",
            "--name",
            database,
            "--network",
            name,
            "-e",
            "POSTGRES_USER=migration_admin",
            "-e",
            "POSTGRES_DB=migration_test",
            "-e",
            "POSTGRES_PASSWORD=" + admin_password,
            database_image,
        )
        # TCP readiness excludes the entrypoint's temporary socket-only server.
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            try:
                ready = docker(
                    "exec", database, "pg_isready", "-h", "127.0.0.1",
                    "-U", "migration_admin", "-d", "migration_test",
                    check=False, quiet=True, timeout=10,
                )
            except subprocess.TimeoutExpired:
                ready = 1
            if ready == 0:
                break
            time.sleep(1)
        else:
            raise RuntimeError("Database did not become ready within 120 seconds")
        if location:
            # Check every packaged migration was recorded, including future additions.
            files = json.loads(
                docker(
                    "run",
                    "--rm",
                    "--entrypoint",
                    "node",
                    image,
                    "-e",
                    "console.log(JSON.stringify(require('fs').readdirSync('/app/database/migrations').filter(x=>/^\\d+.*\\.sql$/.test(x)).sort()))",
                    capture=True,
                )
            )
        previous = None
        for attempt in (1, 2):
            # Use the image's default USER and CMD, exactly as deployment does.
            args = ["run", "--name", migration, "--network", name]
            for key, value in env.items():
                args += ["-e", f"{key}={value}"]
            docker(*args, image)
            docker("rm", migration)
            current = sql(f"SELECT name || ':' || checksum || ':' || applied_at FROM {history} ORDER BY name COLLATE \"C\"")
            if not current or (previous is not None and current != previous):
                raise RuntimeError("Missing or changed migration history on rerun")
            previous = current
            if location:
                if sql(f"SELECT name FROM {history} ORDER BY name COLLATE \"C\"").splitlines() != files:
                    raise RuntimeError("Migration history differs from packaged SQL files")
                if sql("SELECT count(*) FROM pg_extension WHERE extname='postgis'") != "1":
                    raise RuntimeError("PostGIS extension missing")
                sql(
                    "SELECT id FROM catalog.places LIMIT 1; SELECT id FROM housing.listings LIMIT 1",
                    "migration_app",
                    app_password,
                )
                sql("SELECT id FROM catalog.places LIMIT 1", "migration_ingest", ingest_password)
                grants = "has_table_privilege(current_user, 'housing.listings', 'INSERT') AND has_table_privilege(current_user, 'housing.listings', 'UPDATE')"
            else:
                if sql(f"SELECT count(*) FROM {history}") != "2":
                    raise RuntimeError("Moving migrations missing")
                sql(
                    "SELECT id FROM moving.quotes LIMIT 1; SELECT provider_order_id FROM moving.orders LIMIT 1",
                    "migration_app",
                    app_password,
                )
                grants = "has_table_privilege(current_user, 'moving.orders', 'INSERT') AND has_table_privilege(current_user, 'moving.orders', 'UPDATE')"
            if (
                sql(
                    f"SELECT {grants} AND has_table_privilege(current_user, 'audit.tool_calls', 'INSERT')",
                    "migration_app",
                    app_password,
                )
                != "t"
            ):
                raise RuntimeError("Application grants missing")
            print(f"{kind}: run {attempt} passed schema, history and role checks", flush=True)
    finally:
        for container in (migration, database):
            subprocess.run(
                ["docker", "rm", "-fv", container], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30
            )
        subprocess.run(
            ["docker", "network", "rm", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("kind", choices=["location-migrate", "moving-migrate"])
    parser.add_argument("image")
    parser.add_argument("--database-image", help="Override the test database image for the current host architecture.")
    args = parser.parse_args()
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    signal.signal(signal.SIGINT, lambda *_: sys.exit(130))
    try:
        verify(args.kind, args.image, args.database_image)
    except subprocess.TimeoutExpired:
        raise SystemExit("Migration integration test timed out") from None
    except subprocess.CalledProcessError as error:
        # Docker arguments contain disposable passwords; do not print the command.
        raise SystemExit(f"Migration integration test failed (exit {error.returncode})") from None
