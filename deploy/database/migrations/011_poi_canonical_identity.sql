-- Reversible POI projection. Existing places, sources, housing and pins are untouched.
CREATE TABLE IF NOT EXISTS catalog.poi_dedup_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    manifest_hash text NOT NULL,
    alias_count integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    rolled_back_at timestamptz
);

CREATE TABLE IF NOT EXISTS catalog.poi_aliases (
    alias_place_id uuid PRIMARY KEY REFERENCES catalog.places(id),
    canonical_place_id uuid NOT NULL REFERENCES catalog.places(id),
    run_id uuid NOT NULL REFERENCES catalog.poi_dedup_runs(id),
    osm_identity text NOT NULL,
    reason text NOT NULL CHECK (reason = 'same_osm_identity'),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (alias_place_id <> canonical_place_id)
);
CREATE INDEX IF NOT EXISTS poi_aliases_canonical_idx ON catalog.poi_aliases(canonical_place_id);
CREATE INDEX IF NOT EXISTS poi_aliases_run_idx ON catalog.poi_aliases(run_id);

CREATE OR REPLACE FUNCTION catalog.osm_object_identity(value text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT CASE
      WHEN value ~ '^(node|way|relation)/[0-9]{1,16}$' THEN value
      WHEN value ~ '^area/[0-9]{1,16}$' THEN
        CASE WHEN split_part(value, '/', 2)::bigint % 2 = 0 THEN 'way/' ELSE 'relation/' END
        || (split_part(value, '/', 2)::bigint / 2)::text
      ELSE NULL
    END
$$;
CREATE INDEX IF NOT EXISTS place_sources_osm_object_idx
    ON catalog.place_sources(catalog.osm_object_identity(source_id)) WHERE source_type = 'osm';
