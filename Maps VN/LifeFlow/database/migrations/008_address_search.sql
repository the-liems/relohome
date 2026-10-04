CREATE INDEX IF NOT EXISTS places_address_normalized_trgm_gin
    ON catalog.places USING GIN (geo.normalize_search(address::text) gin_trgm_ops)
    WHERE address <> '{}'::jsonb AND deleted_at IS NULL;
