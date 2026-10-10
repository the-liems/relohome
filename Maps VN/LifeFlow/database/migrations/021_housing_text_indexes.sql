-- Match the existing raw ILIKE semantics; normalizing or using full text would
-- change which listings match. The title trigram index already exists.
CREATE INDEX listings_description_trgm_gin ON housing.listings USING gin(description gin_trgm_ops)
    WHERE status='active' AND deleted_at IS NULL;
CREATE INDEX places_address_raw_trgm_gin ON catalog.places USING gin((address::text) gin_trgm_ops)
    WHERE deleted_at IS NULL;
-- The earlier normalized-address index excludes '{}'; resolve's OR cannot
-- imply that partial predicate. Index all non-deleted addresses instead, so
-- '{}' and punctuation queries retain exactly the old behavior as well.
CREATE INDEX places_address_resolve_trgm_gin ON catalog.places
    USING gin(geo.normalize_search(address::text) gin_trgm_ops) WHERE deleted_at IS NULL;
ANALYZE housing.listings;
ANALYZE catalog.places;
