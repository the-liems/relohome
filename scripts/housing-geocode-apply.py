"""Synchronize reviewed housing data with its source JSONL and housing anchors only.

Use inspect before export; apply after the complete geocoding queue. No schema,
agents, service tools, accounts, units, offers or media are modified.
"""

import argparse
import copy
import importlib.util
import json
import runpy
import shutil
import subprocess
from collections import Counter, defaultdict
from datetime import UTC, datetime
from itertools import zip_longest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("housing_full", Path(__file__).with_name("housing-geocode-full.py"))
FULL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FULL)
BASE = FULL.BASE


def command():
    env = runpy.run_path(str(BASE.ROOT / "scripts/local-integration.py"))["environment"]("platform")
    return [
        "docker",
        "exec",
        "-i",
        "lifeflow-postgis",
        "psql",
        "-U",
        env["POSTGRES_ADMIN_USER"],
        "-d",
        env["POSTGRES_DB"],
        "-X",
        "-qAt",
        "-v",
        "ON_ERROR_STOP=1",
    ]


def sql(query):
    result = subprocess.run(command(), input=query, capture_output=True, text=True, encoding="utf-8", timeout=120)
    if result.returncode:
        raise RuntimeError("Database operation failed; no credentials or payload are printed")
    return result.stdout.strip()


def table_fingerprints():
    result = {}
    for table in [
        "housing.units",
        "housing.properties",
        "housing.offers",
        "housing.listing_media",
        "catalog.place_media",
    ]:
        query = f"SELECT json_build_object('count',count(*),'hash',md5(COALESCE(string_agg(md5(to_jsonb(t)::text),'' ORDER BY id),''))) FROM {table} t"
        result[table] = json.loads(sql("BEGIN READ ONLY; SET LOCAL statement_timeout='90s'; " + query + "; ROLLBACK;"))
    result["non_housing_places"] = json.loads(
        sql("""BEGIN READ ONLY; SET LOCAL statement_timeout='90s';
        SELECT json_build_object('count',count(*),'hash',md5(COALESCE(string_agg(md5(to_jsonb(t)::text),'' ORDER BY id),'')))
        FROM catalog.places t WHERE attributes->>'entity_role' IS DISTINCT FROM 'housing_anchor'; ROLLBACK;""")
    )
    # Includes verification, contacts/description/status as hashes, never exports their contents.
    result["listing_business_fields"] = json.loads(
        sql("""BEGIN READ ONLY; SET LOCAL statement_timeout='90s';
        SELECT json_build_object('count',count(*),'hash',md5(COALESCE(string_agg(md5((to_jsonb(t)-'attributes'-'updated_at')::text),'' ORDER BY id),'')))
        FROM housing.listings t; ROLLBACK;""")
    )
    return result


def database_rows():
    return json.loads(
        sql("""BEGIN READ ONLY; SET LOCAL statement_timeout='90s';
    SELECT COALESCE(json_agg(row_to_json(q)),'[]'::json) FROM (
      SELECT l.id AS listing_id,l.source_listing_id AS identity,cp.id AS place_id,
        l.verification_status AS listing_verification,cp.verification_status AS place_verification,
        cp.attributes->>'entity_role' AS role,ST_Y(cp.geom) AS lat,ST_X(cp.geom) AS lng,
        md5(cp.address::text) AS address_hash,md5(cp.attributes::text) AS place_attributes_hash,
        md5(l.attributes::text) AS listing_attributes_hash
      FROM housing.listings l JOIN housing.properties p ON p.id=l.property_id
      JOIN catalog.places cp ON cp.id=p.place_id WHERE l.source_type='partner'
      ORDER BY l.id
    ) q; ROLLBACK;""")
    )


def identity(row):
    return str(row["source_type"]) + ":" + str(row["source_listing_id"])


def coordinate_match(row, location):
    return (
        isinstance(location, dict)
        and isinstance(location.get("latitude"), (int, float))
        and isinstance(location.get("longitude"), (int, float))
        and abs(row["lat"] - location["latitude"]) < 1e-10
        and abs(row["lng"] - location["longitude"]) < 1e-10
    )


def inspect(output):
    inventory = json.loads((output / "inventory.json").read_text(encoding="utf-8"))
    source = Path(inventory["source"])
    live_hash = BASE.sha256(source)
    if live_hash != inventory.get("live_source_sha256", inventory["source_sha256"]):
        raise ValueError("Source changed")
    source_rows = {identity(r): r for r in BASE.read_jsonl(source)}
    rows = database_rows()
    by_place = defaultdict(list)
    blocked = {}
    counts = Counter()
    for row in rows:
        before = source_rows.get(row["identity"])
        if before is None:
            continue
        by_place[row["place_id"]].append(row["identity"])
        counts["matched_source_records"] += 1
        if row["listing_verification"] in {"source_verified", "lifeflow_verified"} or row["place_verification"] in {
            "source_verified",
            "lifeflow_verified",
        }:
            blocked[row["identity"]] = "preserve_database_verified"
        elif row["role"] != "housing_anchor":
            blocked[row["identity"]] = "preserve_database_nonhousing_anchor"
        elif not coordinate_match(row, before.get("location")):
            blocked[row["identity"]] = "preserve_database_coordinate_drift"
    # Shared DB anchors can contain distinct units/projects; do not update one at others' expense.
    for identities in by_place.values():
        if len(identities) > 1:
            for ident in identities:
                blocked[ident] = "preserve_database_shared_anchor"
    result = {
        "source_sha256": inventory["source_sha256"],
        "created_at": datetime.now(UTC).isoformat(),
        "live_source_sha256": live_hash,
        "rows": rows,
        "blocked": blocked,
        "fingerprints": table_fingerprints(),
    }
    BASE.write_json(output / "db-baseline.json", result)
    BASE.write_json(output / "db-protected.json", {"source_sha256": inventory["source_sha256"], "identities": blocked})
    counts.update(blocked.values())
    counts["source_records"] = len(source_rows)
    counts["database_partner_records"] = len(rows)
    print(json.dumps({"inspection": dict(counts), "live_data_changed": False}))


def validate_export(before_path, after_path):
    count = 0
    sentinel = object()
    for before, after in zip_longest(BASE.read_jsonl(before_path), BASE.read_jsonl(after_path), fillvalue=sentinel):
        if before is sentinel or after is sentinel:
            raise ValueError("Record count changed")
        restored = copy.deepcopy(after)
        for field in ["address_normalized", "location", "derived"]:
            if field in before:
                restored[field] = before[field]
            else:
                restored.pop(field, None)
        if restored != before:
            raise ValueError("Non-geocoding listing fields changed")
        count += 1
    return count


def payload_sql(patches):
    # COPY text escaping, not string interpolation of SQL literals or shell commands.
    copied = "\n".join(
        json.dumps(p, ensure_ascii=False).replace("\\", "\\\\").replace("\t", "\\t").replace("\r", "\\r")
        for p in patches
    )
    return (
        "CREATE TEMP TABLE housing_geo_input(data jsonb) ON COMMIT DROP;\nCOPY housing_geo_input(data) FROM STDIN;\n"
        + (copied + "\n" if copied else "")
        + "\\.\n"
    )


def apply(output, dry_run=False):
    inventory = json.loads((output / "inventory.json").read_text(encoding="utf-8"))
    exported = json.loads((output / "full-export.json").read_text(encoding="utf-8"))
    baseline = json.loads((output / "db-baseline.json").read_text(encoding="utf-8"))
    source = Path(inventory["source"])
    destination = output / "housing-geocoded.jsonl"
    old_hash = inventory["source_sha256"]
    before_hash = inventory.get("live_source_sha256", old_hash)
    journal_path = output / "apply-journal.json"
    if journal_path.exists():
        previous = json.loads(journal_path.read_text(encoding="utf-8"))
        if (
            previous["status"] in {"committed", "verified"}
            and BASE.sha256(source) == previous["source_after_sha256"] == exported["output_sha256"]
        ):
            verify(output)
            return
    if (
        BASE.sha256(source) != before_hash
        or baseline["source_sha256"] != old_hash
        or baseline.get("live_source_sha256", old_hash) != before_hash
    ):
        raise ValueError("Source/baseline changed; apply halted")
    if exported.get("live_source_sha256_before", old_hash) != before_hash:
        raise ValueError("Export belongs to an earlier live batch")
    if BASE.sha256(destination) != exported["output_sha256"]:
        raise ValueError("Export checksum mismatch")
    records = validate_export(source, destination)
    source_records = {identity(r): r for r in BASE.read_jsonl(source)}
    exported_records = {identity(r): r for r in BASE.read_jsonl(destination)}
    current = database_rows()
    old_rows = {r["identity"]: r for r in baseline["rows"]}
    current_rows = {r["identity"]: r for r in current}
    if len(old_rows) != len(baseline["rows"]) or len(current_rows) != len(current):
        raise ValueError("Duplicate DB source identities; apply halted")
    if current_rows != old_rows:
        raise ValueError("DB housing changed since inspect; refresh protection and export first")
    if table_fingerprints() != baseline["fingerprints"]:
        raise ValueError("Business data changed since inspect; take a fresh baseline")
    patches = []
    for patch in BASE.read_jsonl(output / "full-patch.jsonl"):
        expected = exported_records.get(patch["identity"])
        original = source_records.get(patch["identity"])
        if (
            not expected
            or not original
            or patch["location"] != expected["location"]
            or patch["old_location"] != original["location"]
        ):
            raise ValueError("Patch location does not match validated source/export")
        if (
            patch["address"] != {**expected["address_normalized"], "raw": expected.get("address_raw")}
            or patch["metadata"] != expected["derived"]["housing_geocoding"]
        ):
            raise ValueError("Patch address/provenance does not match validated export")
        row = current_rows.get(patch["identity"])
        if row is None:
            continue  # Original import rejected some records; do not resurrect them.
        if patch["identity"] in baseline["blocked"]:
            raise ValueError("Protected DB row in patch")
        if not coordinate_match(row, patch["old_location"]):
            raise ValueError("Old coordinate mismatch")
        patches.append(
            {
                **patch,
                "listing_id": row["listing_id"],
                "place_id": row["place_id"],
                "old_address_hash": row["address_hash"],
                "old_place_attributes_hash": row["place_attributes_hash"],
                "old_listing_attributes_hash": row["listing_attributes_hash"],
            }
        )
    if len({p["place_id"] for p in patches}) != len(patches):
        raise ValueError("Multiple patches target same DB place")
    backup = output / "housing-original.jsonl"
    if backup.exists() and BASE.sha256(backup) != old_hash:
        raise ValueError("Existing source backup differs; do not overwrite")
    if not backup.exists():
        if before_hash != old_hash:
            raise ValueError("Original backup missing after an earlier apply")
        shutil.copy2(source, backup)
    if BASE.sha256(backup) != old_hash:
        raise ValueError("Source backup checksum mismatch")
    rollback_backup = backup
    if before_hash != old_hash:
        rollback_backup = output / "housing-before-apply.jsonl"
        shutil.copy2(source, rollback_backup)
        if BASE.sha256(rollback_backup) != before_hash:
            raise ValueError("Current batch backup checksum mismatch")
    # Stage beside the canonical file to guarantee a same-volume atomic replacement.
    staged = source.with_name(source.name + ".geocode.tmp")
    shutil.copyfile(destination, staged)
    if BASE.sha256(staged) != exported["output_sha256"]:
        raise ValueError("Staged file checksum mismatch")
    prepared_at = datetime.now(UTC).isoformat()
    journal = {
        "status": "prepared",
        "source": str(source),
        "source_before_sha256": before_hash,
        "frozen_source_sha256": old_hash,
        "rollback_source_backup": str(rollback_backup),
        "source_after_sha256": exported["output_sha256"],
        "source_backup": str(backup),
        "db_records": len(patches),
        "source_records": records,
        "prepared_at": prepared_at,
    }
    BASE.write_json(output / "apply-journal.json", journal)
    error_path = output / "apply-psql-error.log"
    source_replaced = False
    committed = False
    commit_sent = False
    with error_path.open("w", encoding="utf-8") as errors:
        process = subprocess.Popen(
            command(),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=errors,
            text=True,
            encoding="utf-8",
            bufsize=1,
        )

        def send(statement):
            process.stdin.write(statement + "\n")
            process.stdin.flush()

        def marker(expected):
            for line in process.stdout:
                if line.strip() == expected:
                    return
            raise RuntimeError("DB synchronization failed; inspect local apply-psql-error.log")

        try:
            send("BEGIN; SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='90s';")
            send(payload_sql(patches))
            send("""CREATE TEMP TABLE housing_geo_targets ON COMMIT DROP AS
                SELECT data,(data->>'listing_id')::uuid AS listing_id,(data->>'place_id')::uuid AS place_id FROM housing_geo_input;
                SELECT 1 FROM housing.listings l JOIN housing_geo_targets t ON l.id=t.listing_id FOR UPDATE OF l;
                SELECT 1 FROM catalog.places cp JOIN housing_geo_targets t ON cp.id=t.place_id FOR UPDATE OF cp;
                DO $$ BEGIN
                IF (SELECT count(*) FROM housing_geo_targets t
                    JOIN housing.listings l ON l.id=t.listing_id
                    JOIN housing.properties p ON p.id=l.property_id
                    JOIN catalog.places cp ON cp.id=p.place_id AND cp.id=t.place_id
                    WHERE l.source_listing_id=t.data->>'identity')<>(SELECT count(*) FROM housing_geo_targets)
                THEN RAISE EXCEPTION 'Housing target cardinality mismatch'; END IF;
                IF EXISTS (
                  SELECT 1 FROM housing_geo_targets t JOIN housing.listings l ON l.id=t.listing_id
                    JOIN housing.properties p ON p.id=l.property_id JOIN catalog.places cp ON cp.id=p.place_id
                  WHERE cp.id<>t.place_id OR cp.attributes->>'entity_role' IS DISTINCT FROM 'housing_anchor'
                    OR l.verification_status<>'unverified' OR cp.verification_status<>'unverified'
                    OR md5(cp.address::text)<>t.data->>'old_address_hash'
                    OR md5(cp.attributes::text)<>t.data->>'old_place_attributes_hash'
                    OR md5(l.attributes::text)<>t.data->>'old_listing_attributes_hash'
                    OR abs(ST_Y(cp.geom)-(t.data#>>'{old_location,latitude}')::float8)>1e-10
                    OR abs(ST_X(cp.geom)-(t.data#>>'{old_location,longitude}')::float8)>1e-10
                ) THEN RAISE EXCEPTION 'Housing guard mismatch'; END IF;
                END $$;
                SELECT 'GUARDS_OK';""")
            marker("GUARDS_OK")
            # Export just the rows we will touch before mutation; no permanent backup table.
            send("""SELECT json_build_object('places',
              (SELECT COALESCE(json_agg(json_build_object('id',cp.id,'geom',ST_AsEWKT(cp.geom),'address',cp.address,'attributes',cp.attributes,'updated_at',cp.updated_at)),'[]'::json)
                FROM catalog.places cp JOIN housing_geo_targets t ON t.place_id=cp.id),
              'listings',(SELECT COALESCE(json_agg(json_build_object('id',l.id,'attributes',l.attributes,'updated_at',l.updated_at)),'[]'::json)
                FROM housing.listings l JOIN housing_geo_targets t ON t.listing_id=l.id)); SELECT 'BACKUP_END';""")
            captured = []
            for line in process.stdout:
                if line.strip() == "BACKUP_END":
                    break
                captured.append(line)
            snapshot = json.loads("".join(captured))
            BASE.write_json(output / "db-touched-original.json", snapshot)
            send("""UPDATE catalog.places cp SET
              geom=ST_SetSRID(ST_MakePoint((t.data#>>'{location,longitude}')::float8,(t.data#>>'{location,latitude}')::float8),4326),
              address=t.data->'address',
              attributes=cp.attributes||jsonb_build_object('location_accuracy',t.data#>>'{location,accuracy}',
                'location_method',t.data#>>'{location,method}','housing_geocoding',t.data->'metadata'), updated_at=now()
              FROM housing_geo_targets t WHERE cp.id=t.place_id;
              UPDATE housing.listings l SET attributes=l.attributes||jsonb_build_object(
                'location_accuracy',t.data#>>'{location,accuracy}','location_method',t.data#>>'{location,method}',
                'derived',COALESCE(l.attributes->'derived','{}'::jsonb)||jsonb_build_object('housing_geocoding',t.data->'metadata')), updated_at=now()
              FROM housing_geo_targets t WHERE l.id=t.listing_id;
              DO $$ BEGIN IF EXISTS (
                SELECT 1 FROM housing_geo_targets t JOIN catalog.places cp ON cp.id=t.place_id
                WHERE abs(ST_Y(cp.geom)-(t.data#>>'{location,latitude}')::float8)>1e-10
                  OR abs(ST_X(cp.geom)-(t.data#>>'{location,longitude}')::float8)>1e-10
                  OR cp.address<>t.data->'address'
              ) THEN RAISE EXCEPTION 'Housing update verification failed'; END IF; END $$;
              SELECT 'DB_PREPARED';""")
            marker("DB_PREPARED")
            if BASE.sha256(source) != before_hash:
                raise ValueError("Source changed during transaction")
            if dry_run:
                send("ROLLBACK; SELECT 'ROLLED_BACK';")
                marker("ROLLED_BACK")
                send("\\q")
                process.wait(timeout=20)
                if (
                    database_rows() != current
                    or table_fingerprints() != baseline["fingerprints"]
                    or BASE.sha256(source) != before_hash
                ):
                    raise ValueError("Dry-run changed live source or database")
                journal["status"] = "dry_run_rolled_back_verified"
                BASE.write_json(output / "apply-journal.json", journal)
                staged.unlink()
                print(
                    json.dumps(
                        {
                            "dry_run_verified": True,
                            "database_targets": len(patches),
                            "source_records": records,
                            "live_data_applied": False,
                        }
                    )
                )
                return
            staged.replace(source)
            source_replaced = True
            journal["status"] = "source_replaced_transaction_pending"
            BASE.write_json(output / "apply-journal.json", journal)
            commit_sent = True
            send("COMMIT; SELECT 'COMMITTED';")
            marker("COMMITTED")
            committed = True
            journal["status"] = "committed"
            journal["committed_at"] = datetime.now(UTC).isoformat()
            BASE.write_json(output / "apply-journal.json", journal)
            send("\\q")
            process.wait(timeout=20)
        except BaseException:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=20)  # Disconnect rolls back pending transaction.
            if commit_sent and not committed:
                # A lost acknowledgement can follow a successful COMMIT. Reconcile
                # metadata before deciding whether the source must be restored.
                try:
                    probe = json.loads(
                        sql(
                            "BEGIN; "
                            + payload_sql(patches)
                            + """
                      SELECT json_build_object('matching',count(*)) FROM housing_geo_input t
                      JOIN catalog.places cp ON cp.id=(t.data->>'place_id')::uuid
                      JOIN housing.listings l ON l.id=(t.data->>'listing_id')::uuid
                      WHERE cp.address=t.data->'address' AND cp.attributes->'housing_geocoding'=t.data->'metadata'
                        AND l.attributes#>'{derived,housing_geocoding}'=t.data->'metadata'
                        AND abs(ST_Y(cp.geom)-(t.data#>>'{location,latitude}')::float8)<1e-10
                        AND abs(ST_X(cp.geom)-(t.data#>>'{location,longitude}')::float8)<1e-10;
                      ROLLBACK;"""
                        )
                    )
                    if probe["matching"] == len(patches):
                        committed = True
                    elif probe["matching"] != 0:
                        journal["status"] = "needs_commit_reconciliation"
                        BASE.write_json(output / "apply-journal.json", journal)
                        raise RuntimeError("Commit outcome unclear; retain source and both backups")
                except (RuntimeError, subprocess.SubprocessError, json.JSONDecodeError):
                    journal["status"] = "needs_commit_reconciliation"
                    BASE.write_json(output / "apply-journal.json", journal)
                    raise
            if source_replaced and not committed:
                shutil.copyfile(rollback_backup, staged)
                staged.replace(source)
            journal["status"] = "committed" if committed else "rolled_back"
            BASE.write_json(output / "apply-journal.json", journal)
            if committed:
                inventory["frozen_source"] = str(backup.resolve())
                inventory["live_source_sha256"] = exported["output_sha256"]
                inventory["live_source_unchanged"] = False
                BASE.write_json(output / "inventory.json", inventory)
                verify(output)
                return
            raise
    inventory["frozen_source"] = str(backup.resolve())
    inventory["live_source_sha256"] = exported["output_sha256"]
    inventory["live_source_unchanged"] = False
    BASE.write_json(output / "inventory.json", inventory)
    verify(output)


def verify(output):
    journal = json.loads((output / "apply-journal.json").read_text(encoding="utf-8"))
    if journal["status"] not in {"committed", "verified"}:
        raise ValueError("No committed apply to verify")
    source = Path(journal["source"])
    if BASE.sha256(source) != journal["source_after_sha256"]:
        raise ValueError("Live source checksum mismatch")
    baseline = json.loads((output / "db-baseline.json").read_text(encoding="utf-8"))
    if table_fingerprints() != baseline["fingerprints"]:
        raise ValueError("Units/offers/media/properties/POIs/listing business fields changed")
    before = {r["identity"]: r for r in baseline["rows"]}
    after = {r["identity"]: r for r in database_rows()}
    if set(before) != set(after):
        raise ValueError("Database listing count/identities changed")
    source_rows = {identity(r): r for r in BASE.read_jsonl(source)}
    patched = {p["identity"]: p for p in BASE.read_jsonl(output / "full-patch.jsonl")}
    counts = Counter()
    for ident, old in before.items():
        new = after[ident]
        if ident not in patched:
            if new != old:
                raise ValueError("Untargeted DB row changed")
            counts["untargeted_db_rows_unchanged"] += 1
        else:
            if not coordinate_match(new, source_rows[ident]["location"]):
                raise ValueError("Source/PostGIS mismatch")
            counts["targeted_db_rows_match_source"] += 1
    records = validate_export(Path(journal["source_backup"]), source)
    result = {
        "records": records,
        "counts": dict(counts),
        "business_fields_preserved": True,
        "units_prices_media_pois_unchanged": True,
        "source_sha256": BASE.sha256(source),
        "live_data_applied": True,
    }
    BASE.write_json(output / "full-verification.json", result)
    proposal_path = output / "full-export.json"
    if proposal_path.exists():
        proposal = json.loads(proposal_path.read_text(encoding="utf-8"))
        if proposal["output_sha256"] == result["source_sha256"]:
            proposal["live_applied"] = True
            BASE.write_json(proposal_path, proposal)
    journal["status"] = "verified"
    BASE.write_json(output / "apply-journal.json", journal)
    print(json.dumps(result))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["inspect", "apply", "verify", "dry-run"])
    parser.add_argument("--output", type=Path, default=BASE.DEFAULT_OUTPUT)
    args = parser.parse_args()
    if args.mode == "dry-run":
        apply(args.output, dry_run=True)
    else:
        {"inspect": inspect, "apply": apply, "verify": verify}[args.mode](args.output)


if __name__ == "__main__":
    main()
