-- Optional: run only AFTER deploying the old query code. Rolling back code
-- alone is sufficient; this removes only the additions from migrations 019-021.
BEGIN;
DROP TRIGGER IF EXISTS listings_map_points ON housing.listings;
DROP TRIGGER IF EXISTS properties_map_points ON housing.properties;
DROP TRIGGER IF EXISTS units_map_points ON housing.units;
DROP TRIGGER IF EXISTS places_map_points ON catalog.places;
DROP TABLE IF EXISTS housing.map_points;
DROP VIEW IF EXISTS housing.map_point_source;
DROP FUNCTION IF EXISTS housing.sync_map_display();
DROP FUNCTION IF EXISTS housing.sync_map_points_trigger();
DROP FUNCTION IF EXISTS housing.sync_map_points(uuid[]);
DROP INDEX IF EXISTS housing.offers_current_cover_idx;
DROP INDEX IF EXISTS housing.listing_media_thumbnail_idx;
DROP INDEX IF EXISTS housing.listings_description_trgm_gin;
DROP INDEX IF EXISTS catalog.places_address_raw_trgm_gin;
DROP INDEX IF EXISTS catalog.places_address_resolve_trgm_gin;
DELETE FROM public.lifeflow_schema_migrations WHERE name IN
    ('019_housing_map_points.sql','020_housing_map_display.sql','021_housing_text_indexes.sql');
COMMIT;
