"""Run location integration suites using synthetic imports in disposable PostGIS."""

import json
import os
import secrets
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IMAGE = "ghcr.io/ai20k-build-phase-cohort-4/p-044/postgis:16-3.5-alpine"


def run(*args, **kwargs):
    return subprocess.run(args, check=True, cwd=ROOT, **kwargs)


def fixtures(directory):
    """Exercise the real importers without depending on a developer's snapshot."""
    tags = [{"tourism": "hotel"}, {"amenity": "hospital"}, {"shop": "supermarket"},
            {"amenity": "school"}, {"leisure": "fitness_centre"}, {"amenity": "restaurant"},
            {"amenity": "bus_station"}, {"amenity": "bank"}]
    places = [{"type": "Feature", "id": f"n{90000000 + i}",
               "geometry": {"type": "Point", "coordinates": [106.6 + i * .001, 10.8]},
               "properties": {**tags[i % len(tags)], "name": f"Isolated POI {i}"}} for i in range(128)]
    places.append({"type": "Feature", "id": "a190000000", "properties": {"name": "Isolated area", "tourism": "hotel"},
                   "geometry": {"type": "Polygon", "coordinates": [[[106.7, 10.7], [106.701, 10.7],
                                 [106.701, 10.701], [106.7, 10.701], [106.7, 10.7]]]}})
    areas = []
    for identity, name, level, x, y in [(38522189, "Phường Gò Vấp", "6", 106.65, 10.8),
                                       (3807033, "Thành phố Hà Nội", "4", 105.8, 21.0)]:
        areas.append({"type": "Feature", "id": f"r{identity}",
                      "properties": {"boundary": "administrative", "name": name, "admin_level": level},
                      "geometry": {"type": "Polygon", "coordinates": [[[x, y], [x+.02, y],
                                    [x+.02, y+.02], [x, y+.02], [x, y]]]}})
    for name, records in [("pois.jsonl", places), ("areas.jsonl", areas)]:
        (directory / name).write_text("\n".join(json.dumps(item) for item in records), encoding="utf-8")
    # The importer hashes this source artifact; no PBF parsing is performed here.
    (directory / "source.pbf").write_bytes(b"isolated synthetic import source\n")


def main():
    name = "lifeflow-ts-test-" + secrets.token_hex(6)
    password = secrets.token_hex(24)
    with tempfile.TemporaryDirectory(prefix="lifeflow-ts-test-") as temporary:
        directory = Path(temporary)
        fixtures(directory)
        try:
            run("docker", "run", "-d", "--name", name, "--tmpfs", "/var/lib/postgresql/data",
                "-p", "127.0.0.1::5432", "-e", "POSTGRES_USER=test_admin",
                "-e", "POSTGRES_PASSWORD=" + password, "-e", "POSTGRES_DB=lifeflow_poi_test_main",
                IMAGE, stdout=subprocess.DEVNULL)
            # TCP only: the image's first-start setup server listens on the socket alone.
            for _ in range(45):
                ready = subprocess.run(["docker", "exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "test_admin"],
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                if ready.returncode == 0:
                    break
                time.sleep(1)
            else:
                raise RuntimeError("Isolated PostGIS did not become ready")
            port = run("docker", "port", name, "5432", capture_output=True, text=True).stdout.strip().split(":")[-1]
            url = f"postgresql://test_admin:{password}@127.0.0.1:{port}/lifeflow_poi_test_main"
            config = {"POSTGRES_HOST": "127.0.0.1", "POSTGRES_PORT": port, "POSTGRES_DB": "lifeflow_poi_test_main",
                      "POSTGRES_ADMIN_USER": "test_admin", "POSTGRES_ADMIN_PASSWORD": password,
                      "POSTGRES_APP_USER": "test_app", "POSTGRES_APP_PASSWORD": password,
                      "POSTGRES_INGEST_USER": "test_ingest", "POSTGRES_INGEST_PASSWORD": password,
                      "LOCATION_DATABASE_URL": url, "LOCATION_ADMIN_DATABASE_URL": url, "LOCATION_INGEST_DATABASE_URL": url}
            env = {**os.environ, **config,
                   "RUN_POI_CANONICAL_TESTS": "1", "RUN_POI_DATASET_TESTS": "1", "RUN_POI_V2_INTEGRATION": "1",
                   "POI_ROUNDTRIP_DB": "lifeflow_poi_test_roundtrip", "POI_V2_SOURCE_PATH": str(directory / "pois.jsonl"),
                   "ADMIN_AREA_SOURCE_PATH": str(directory / "areas.jsonl"), "OSM_PBF_PATH": str(directory / "source.pbf"),
                   "OSM_SOURCE_VERSION": "isolated-synthetic-fixture"}
            for database in ["lifeflow_poi_test_main", "lifeflow_poi_test_roundtrip"]:
                if database.endswith("roundtrip"):
                    run("docker", "exec", name, "createdb", "-U", "test_admin", database)
                database_url = url.rsplit("/", 1)[0] + "/" + database
                migration_env = {**env, "POSTGRES_DB": database, "LOCATION_DATABASE_URL": database_url,
                                 "LOCATION_ADMIN_DATABASE_URL": database_url, "LOCATION_INGEST_DATABASE_URL": database_url}
                run("node", "apps/platform-api/dist/migrate.js", env=migration_env)
            # Query cleanup suites run before the shared imported snapshot is seeded.
            run("npm", "run", "test", "--workspace", "packages/housing-query", env=env)
            run("node", "apps/platform-api/dist/import-admin-areas.js", env=env)
            run("node", "apps/platform-api/dist/import-pois-v2.js", env=env)
            run("npm", "run", "test", "--workspace", "apps/platform-api", env=env)
            run("npm", "run", "test", "--workspace", "apps/location-mcp", env=env)
        finally:
            subprocess.run(["docker", "rm", "-f", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    signal.signal(signal.SIGINT, lambda *_: sys.exit(130))
    main()
