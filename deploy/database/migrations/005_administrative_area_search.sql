CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION geo.normalize_search(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $$
    SELECT lower(regexp_replace(unaccent(value), '\s+', ' ', 'g'));
$$;

CREATE INDEX IF NOT EXISTS administrative_areas_name_normalized_trgm_gin
    ON geo.administrative_areas
    USING GIN (geo.normalize_search(name) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS administrative_areas_level_idx
    ON geo.administrative_areas (level);

CREATE INDEX IF NOT EXISTS administrative_areas_source_id_idx
    ON geo.administrative_areas (source, source_id);

CREATE INDEX IF NOT EXISTS places_name_normalized_trgm_gin
    ON catalog.places
    USING GIN (geo.normalize_search(name) gin_trgm_ops)
    WHERE name IS NOT NULL AND deleted_at IS NULL;
