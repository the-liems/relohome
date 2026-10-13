-- One physical POI per source identity; reuse the existing ingestion audit table.
INSERT INTO geo.import_runs(id,source_type,source_path,source_checksum,status,started_at,
    completed_at,input_count,accepted_count,duplicate_count,diagnostics)
SELECT id,'poi_cleanup','legacy-poi-projection',manifest_hash,'completed',created_at,
    COALESCE(rolled_back_at,created_at),alias_count,alias_count,alias_count,
    jsonb_build_object('operation','legacy_projection','rolled_back_at',rolled_back_at)
FROM catalog.poi_dedup_runs ON CONFLICT(id) DO NOTHING;

ALTER TABLE catalog.poi_aliases DROP CONSTRAINT poi_aliases_alias_place_id_fkey;
ALTER TABLE catalog.poi_aliases DROP CONSTRAINT poi_aliases_run_id_fkey;
ALTER TABLE catalog.poi_aliases ADD CONSTRAINT poi_aliases_run_id_fkey
    FOREIGN KEY(run_id) REFERENCES geo.import_runs(id);
-- Compatibility retains only the old name and point, not a second POI/source dataset.
ALTER TABLE catalog.poi_aliases ADD COLUMN legacy_name text;
ALTER TABLE catalog.poi_aliases ADD COLUMN legacy_geom geometry(Point,4326);
UPDATE catalog.poi_aliases a SET legacy_name=p.name,legacy_geom=p.geom
    FROM catalog.places p WHERE p.id=a.alias_place_id;
DROP TABLE catalog.poi_dedup_runs;

-- Separate floors, units and branches even when name and coordinate are identical.
CREATE FUNCTION catalog.poi_unit_signature(tags jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'level',NULLIF(btrim(COALESCE(tags->>'level',tags->>'floor',tags->>'addr:floor')),''),
    'unit',NULLIF(btrim(COALESCE(tags->>'addr:unit',tags->>'unit')),''),
    'branch',NULLIF(btrim(tags->>'branch'),'')))
$$;
