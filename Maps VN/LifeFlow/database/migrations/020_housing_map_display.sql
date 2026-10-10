-- Marker rendering must not read crawl JSON or join properties/units/places for
-- hundreds of listings. The live point already contains their public fields.
ALTER TABLE housing.map_points ADD COLUMN title text NOT NULL DEFAULT '',
    ADD COLUMN source_url text, ADD COLUMN location_accuracy text NOT NULL DEFAULT 'unknown';
CREATE FUNCTION housing.sync_map_display() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
    SELECT l.title,l.source_url,COALESCE(l.attributes->>'location_accuracy','unknown')
    INTO NEW.title,NEW.source_url,NEW.location_accuracy FROM housing.listings l WHERE l.id=NEW.id;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION housing.sync_map_display() FROM PUBLIC;
CREATE TRIGGER map_points_display BEFORE INSERT OR UPDATE ON housing.map_points
    FOR EACH ROW EXECUTE FUNCTION housing.sync_map_display();
UPDATE housing.map_points SET title=''; -- trigger backfills only public marker metadata
CREATE INDEX listing_media_thumbnail_idx ON housing.listing_media(listing_id,is_primary DESC,position,id);
ANALYZE housing.map_points;
