"""Normalize zero bedrooms for rental rooms, preserving provenance and ambiguous ads.

Dry run by default. --apply updates the reviewed local JSONL and matching DB units.
Raw staging/source payloads, prices, pins, and listing IDs stay unchanged.
--property-type studio applies the explicit studio sleeping-space convention.
"""
import argparse
import hashlib
import json
import re
import runpy
import shutil
import subprocess
import unicodedata
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RULE = 'rental_room_zero_to_one_v1'


def folded(value):
    return ''.join(c for c in unicodedata.normalize('NFD', value.lower().replace('đ', 'd'))
                   if unicodedata.category(c) != 'Mn')


def decision(record, property_type='room'):
    if property_type == 'studio':
        return ('normalize_studio' if record.get('property_type') == 'studio'
                and record.get('unit', {}).get('bedrooms') == 0 else 'out_of_scope')
    if record.get('property_type') != 'room' or record.get('unit', {}).get('bedrooms') != 0:
        return 'out_of_scope'
    if record.get('listing_type') != 'rent':
        return 'not_long_term_rent'
    if record.get('verification', {}).get('status') == 'lifeflow_verified':
        return 'verified_record'
    text = folded((record.get('title') or '') + ' ' + (record.get('description') or ''))
    if re.search(r'ky tuc xa|dorm|sleep\s*box|giuong tang|o ghep|cho ngu|capsule|co.?living', text):
        return 'shared_or_bedspace_review'
    if re.search(r'\bstudio\b|open.?plan|khong (?:co )?phong ngu (?:rieng|tach)', text):
        return 'studio_or_open_plan_review'
    if re.search(r'(?:nha|can ho)\s+nguyen\s+can|nguyen\s+(?:can|tang|nha)', text):
        return 'whole_property_review'
    if re.search(r'\b(?:[2-9]|1\d)\s*(?:pn\b|phong ngu\b|ngu\b)', text):
        return 'multiple_bedroom_claim_review'
    return 'normalize_single_rental_room'


def file_hash(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--property-type', choices=['room', 'studio'], default='room')
    args = parser.parse_args()
    kind = args.property_type
    rule = RULE if kind == 'room' else 'studio_zero_to_one_v1'
    accepted = 'normalize_single_rental_room' if kind == 'room' else 'normalize_studio'
    source = ROOT / 'Maps VN/Data/housing_clean_2026-09-26.jsonl'
    folder = ROOT / ('data/map-housing-osrm-audit-20261004' if kind == 'room'
                     else 'data/studio-mainland-map-20261004')
    folder.mkdir(exist_ok=True)
    env = runpy.run_path(str(ROOT / 'scripts/local-integration.py'))['environment']('platform')

    def sql(query):
        result = subprocess.run(['docker', 'exec', '-i', 'lifeflow-postgis', 'psql',
                                 '-U', env['POSTGRES_ADMIN_USER'], '-d', env['POSTGRES_DB'],
                                 '-qAt', '-v', 'ON_ERROR_STOP=1'], input=query,
                                capture_output=True, text=True, encoding='utf-8')
        if result.returncode:
            # Do not print SQL or credentials on a DB failure.
            raise RuntimeError('Local housing data operation failed; transaction not committed')
        return json.loads(result.stdout)

    stats = Counter()
    changes = []
    review = []
    original_hash = file_hash(source)
    with source.open(encoding='utf-8-sig') as stream:
        for number, line in enumerate(stream, 1):
            if not line.strip():
                continue
            record = json.loads(line)
            reason = decision(record, kind)
            stats[reason] += 1
            key = f"{record['source_type']}:{record['source_listing_id']}"
            if reason == accepted:
                changes.append({'key': key, 'line': number})
            elif reason != 'out_of_scope':
                review.append({'key': key, 'line': number, 'title': record['title'], 'reason': reason})
    eligible_keys = [row['key'] for row in changes]
    keys_sql = "'" + json.dumps(eligible_keys).replace("'", "''") + "'::jsonb"
    target_condition = f"""p.property_type='{kind}' AND u.bedrooms=0 AND u.deleted_at IS NULL
      AND EXISTS(SELECT 1 FROM housing.listings l WHERE l.unit_id=u.id
        AND l.source_listing_id IN (SELECT jsonb_array_elements_text({keys_sql}))
        {"AND l.listing_type='rent'" if kind == 'room' else ''})"""
    if kind == 'room':
        target_condition += """ AND NOT EXISTS(SELECT 1 FROM housing.listings l WHERE l.unit_id=u.id AND l.verification_status='lifeflow_verified')"""
    protected_tables = ['housing.properties', 'housing.listings', 'housing.offers',
                        'housing.listing_media', 'catalog.places', 'catalog.place_sources',
                        'integration.source_records', 'integration.housing_staging']
    protection_sql = ','.join(f"'{table}',(SELECT md5(coalesce(string_agg(md5(row_to_json(t)::text),'' ORDER BY id),'')) FROM {table} t)" for table in protected_tables)
    snapshot = sql(f"""SELECT json_build_object(
      'target_units',(SELECT coalesce(json_agg(row_to_json(u)),'[]'::json) FROM housing.units u
        JOIN housing.properties p ON p.id=u.property_id WHERE {target_condition}),
      'protected',json_build_object({protection_sql}),
      'unit_count',(SELECT count(*) FROM housing.units),
      'remaining_room_zero',(SELECT count(*) FROM housing.units u JOIN housing.properties p ON p.id=u.property_id WHERE p.property_type='room' AND u.bedrooms=0),
      'studios_zero',(SELECT count(*) FROM housing.units u JOIN housing.properties p ON p.id=u.property_id WHERE p.property_type='studio' AND u.bedrooms=0));""")
    ids = [row['id'] for row in snapshot['target_units']]
    ids_sql = "'" + json.dumps(ids) + "'::jsonb"
    unchanged_units_query = f"""SELECT md5(coalesce(string_agg(md5(row_to_json(u)::text),'' ORDER BY id),''))
      FROM housing.units u WHERE id NOT IN(SELECT jsonb_array_elements_text({ids_sql})::uuid)"""
    snapshot['unaffected_units_hash'] = sql(f'SELECT to_json(({unchanged_units_query}));')
    report = {'rule': rule, 'source': str(source), 'source_before_sha256': original_hash,
              'counts': dict(stats), 'source_rows_to_change': len(changes),
              'database_units_to_change': len(ids), 'preserved_review': review,
              'protected': snapshot['protected'], 'before': {k: v for k, v in snapshot.items() if k not in ['target_units', 'protected']}}
    if not args.apply:
        (folder / f'housing-{kind}-dry-run.json').write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(json.dumps({k: v for k, v in report.items() if k not in ['preserved_review', 'protected']}, ensure_ascii=True))
        return
    reviewed = json.loads((folder / f'housing-{kind}-dry-run.json').read_text(encoding='utf-8'))
    for key in ['source_before_sha256', 'source_rows_to_change', 'database_units_to_change', 'protected', 'before']:
        if reviewed[key] != report[key]:
            raise RuntimeError('Dry-run data changed; review again before apply')
    backup_source = folder / f'housing-source-before-{kind}-normalization.jsonl'
    backup_units = folder / f'housing-units-before-{kind}-normalization.json'
    if backup_source.exists() or backup_units.exists():
        raise RuntimeError('Backup exists; do not overwrite or reapply blindly')
    shutil.copy2(source, backup_source)
    if file_hash(backup_source) != original_hash:
        raise RuntimeError('Source backup checksum mismatch')
    backup_units.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    meta = {'rule': rule, 'original_value': 0, 'normalized_value': 1,
            'semantics': ('One rental sleeping room by convention; separate bedroom not verified'
                          if kind == 'room' else
                          'Studio counted as one sleeping space by user convention; separate bedroom not verified'),
            'normalized_at': datetime.now(UTC).isoformat()}
    next_file = folder / 'housing-source-normalized.pending.jsonl'
    count = 0
    with source.open(encoding='utf-8-sig') as stream, next_file.open('x', encoding='utf-8', newline='\n') as output:
        for line in stream:
            if not line.strip():
                output.write(line)
                continue
            record = json.loads(line)
            if decision(record, kind) == accepted:
                record['unit']['bedrooms'] = 1
                record['unit'].setdefault('attributes', {})['bedroom_normalization'] = meta
                output.write(json.dumps(record, ensure_ascii=False) + '\n')
                count += 1
            else:
                output.write(line)
    if count != len(changes) or file_hash(source) != original_hash:
        raise RuntimeError('Source changed while preparing normalization')
    meta_sql = "'" + json.dumps(meta).replace("'", "''") + "'::jsonb"
    protected_literal = "'" + json.dumps(snapshot['protected']).replace("'", "''") + "'::jsonb"
    # The transaction checks the reviewed units and all tables outside scope before COMMIT.
    query = f"""BEGIN;
      SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='180s';
      DO $lock$ BEGIN PERFORM pg_advisory_xact_lock(1042026,12); END $lock$;
      LOCK TABLE housing.units IN SHARE ROW EXCLUSIVE MODE;
      LOCK TABLE housing.properties,housing.listings IN SHARE MODE;
      CREATE TEMP TABLE room_bedroom_targets AS SELECT u.id FROM housing.units u
        JOIN housing.properties p ON p.id=u.property_id WHERE {target_condition};
      DO $guard$ BEGIN
        IF (SELECT count(*) FROM room_bedroom_targets)<>{len(ids)} OR
           EXISTS(SELECT id FROM room_bedroom_targets EXCEPT SELECT jsonb_array_elements_text({ids_sql})::uuid)
        THEN RAISE EXCEPTION 'Reviewed room targets changed'; END IF;
      END $guard$;
      UPDATE housing.units u SET bedrooms=1,
        attributes=u.attributes || jsonb_build_object('bedroom_normalization',{meta_sql}),updated_at=now()
        WHERE u.id IN(SELECT id FROM room_bedroom_targets);
      DO $guard$ BEGIN
        IF jsonb_build_object({protection_sql}) <> {protected_literal} OR
          ({unchanged_units_query}) <> '{snapshot['unaffected_units_hash']}'
        THEN RAISE EXCEPTION 'Out-of-scope housing data changed'; END IF;
        IF EXISTS(SELECT 1 FROM housing.units WHERE id IN(SELECT id FROM room_bedroom_targets)
          AND (bedrooms<>1 OR attributes->'bedroom_normalization' <> {meta_sql}))
        THEN RAISE EXCEPTION 'Normalization verification failed'; END IF;
      END $guard$;
      SELECT json_build_object('updated_units',(SELECT count(*) FROM room_bedroom_targets),'protected_data_unchanged',true);
      COMMIT;"""
    applied = sql(query)
    shutil.copyfile(next_file, source)
    if file_hash(source) != file_hash(next_file):
        raise RuntimeError('DB applied; source copy needs recovery from pending file')
    report.update(applied)
    report['source_after_sha256'] = file_hash(source)
    report['source_rows_changed'] = count
    report['backup_source'] = str(backup_source)
    report['backup_units'] = str(backup_units)
    report['applied_at'] = meta['normalized_at']
    (folder / f'housing-{kind}-applied.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    next_file.unlink()
    print(json.dumps({k: v for k, v in report.items() if k not in ['preserved_review', 'protected']}, ensure_ascii=True))


if __name__ == '__main__':
    main()
