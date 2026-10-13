-- Compact live read model. Prices deliberately remain in offers: time can change
-- the winning offer without any write or refresh. No crawl payload is duplicated.
CREATE TABLE housing.map_points (
    id uuid PRIMARY KEY REFERENCES housing.listings(id) ON DELETE CASCADE,
    property_id uuid NOT NULL,
    unit_id uuid,
    place_id uuid NOT NULL,
    geom geometry(Point,4326) NOT NULL,
    geog geography(Point,4326) GENERATED ALWAYS AS (geom::geography) STORED,
    address jsonb NOT NULL,
    property_type text NOT NULL,
    listing_type text NOT NULL,
    bedrooms numeric(6,2),
    bathrooms numeric(6,2),
    area_m2 numeric(12,2),
    amenities text[] NOT NULL,
    verification_status text NOT NULL,
    source_type text NOT NULL,
    created_at timestamptz NOT NULL,
    verified_at timestamptz,
    updated_at timestamptz NOT NULL
);
CREATE INDEX map_points_geom_gix ON housing.map_points USING gist(geom);
CREATE INDEX map_points_geog_gix ON housing.map_points USING gist(geog);

CREATE VIEW housing.map_point_source AS
SELECT l.id,l.property_id,u.id AS unit_id,p.place_id,cp.geom,cp.address,
       p.property_type,l.listing_type,u.bedrooms,u.bathrooms,u.area_m2,
       COALESCE(u.amenities,'{}'::text[]) AS amenities,l.verification_status,
       l.source_type,l.created_at,l.verified_at,l.updated_at
FROM housing.listings l
JOIN housing.properties p ON p.id=l.property_id AND p.deleted_at IS NULL
LEFT JOIN housing.units u ON u.id=l.unit_id AND u.deleted_at IS NULL
JOIN catalog.places cp ON cp.id=p.place_id AND cp.deleted_at IS NULL AND cp.status='active'
WHERE l.status='active' AND l.deleted_at IS NULL;

CREATE FUNCTION housing.sync_map_points(listing_ids uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
    IF listing_ids IS NULL OR cardinality(listing_ids)=0 THEN RETURN; END IF;
    -- Serialize changes to the same derived row. The following statements read
    -- a fresh READ COMMITTED snapshot after waiting for an overlapping writer.
    PERFORM 1 FROM housing.listings WHERE id=ANY(listing_ids) ORDER BY id FOR NO KEY UPDATE;
    INSERT INTO housing.map_points
        (id,property_id,unit_id,place_id,geom,address,property_type,listing_type,
         bedrooms,bathrooms,area_m2,amenities,verification_status,source_type,created_at,verified_at,updated_at)
    SELECT * FROM housing.map_point_source WHERE id=ANY(listing_ids)
    ON CONFLICT(id) DO UPDATE SET
        property_id=EXCLUDED.property_id,unit_id=EXCLUDED.unit_id,place_id=EXCLUDED.place_id,
        geom=EXCLUDED.geom,address=EXCLUDED.address,property_type=EXCLUDED.property_type,
        listing_type=EXCLUDED.listing_type,bedrooms=EXCLUDED.bedrooms,bathrooms=EXCLUDED.bathrooms,
        area_m2=EXCLUDED.area_m2,amenities=EXCLUDED.amenities,
        verification_status=EXCLUDED.verification_status,source_type=EXCLUDED.source_type,
        created_at=EXCLUDED.created_at,verified_at=EXCLUDED.verified_at,updated_at=EXCLUDED.updated_at;
    DELETE FROM housing.map_points m WHERE m.id=ANY(listing_ids)
        AND NOT EXISTS(SELECT 1 FROM housing.map_point_source s WHERE s.id=m.id);
END;
$$;
REVOKE ALL ON FUNCTION housing.sync_map_points(uuid[]) FROM PUBLIC;

CREATE FUNCTION housing.sync_map_points_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE changed_id uuid; listing_ids uuid[];
BEGIN
    IF TG_OP='DELETE' THEN changed_id=OLD.id; ELSE changed_id=NEW.id; END IF;
    IF TG_TABLE_NAME='listings' THEN
        IF TG_OP='DELETE' OR NEW.status<>'active' OR NEW.deleted_at IS NOT NULL THEN
            DELETE FROM housing.map_points WHERE id=changed_id;
            RETURN NULL;
        END IF;
        listing_ids=ARRAY[changed_id];
    ELSIF TG_TABLE_NAME='properties' THEN
        SELECT array_agg(id ORDER BY id) INTO listing_ids FROM housing.listings WHERE property_id=changed_id;
    ELSIF TG_TABLE_NAME='units' THEN
        SELECT array_agg(id ORDER BY id) INTO listing_ids FROM housing.listings WHERE unit_id=changed_id;
    ELSE
        SELECT array_agg(l.id ORDER BY l.id) INTO listing_ids FROM housing.listings l
        JOIN housing.properties p ON p.id=l.property_id WHERE p.place_id=changed_id;
    END IF;
    PERFORM housing.sync_map_points(listing_ids);
    RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION housing.sync_map_points_trigger() FROM PUBLIC;

CREATE TRIGGER listings_map_points AFTER INSERT OR UPDATE OR DELETE ON housing.listings
    FOR EACH ROW EXECUTE FUNCTION housing.sync_map_points_trigger();
CREATE TRIGGER properties_map_points AFTER UPDATE OR DELETE ON housing.properties
    FOR EACH ROW EXECUTE FUNCTION housing.sync_map_points_trigger();
CREATE TRIGGER units_map_points AFTER UPDATE OR DELETE ON housing.units
    FOR EACH ROW EXECUTE FUNCTION housing.sync_map_points_trigger();
CREATE TRIGGER places_map_points AFTER UPDATE OR DELETE ON catalog.places
    FOR EACH ROW EXECUTE FUNCTION housing.sync_map_points_trigger();

INSERT INTO housing.map_points
    (id,property_id,unit_id,place_id,geom,address,property_type,listing_type,
     bedrooms,bathrooms,area_m2,amenities,verification_status,source_type,created_at,verified_at,updated_at)
SELECT * FROM housing.map_point_source;
ANALYZE housing.map_points;

-- Exact order of current_offers, with all candidate price fields covered. Future
-- and expired rows stay indexed and are evaluated at the query's now().
CREATE INDEX offers_current_cover_idx ON housing.offers
    (listing_id,valid_from DESC,created_at DESC,id DESC)
    INCLUDE(valid_to,price_amount,deposit_amount,currency,price_period,availability_from,availability_to)
    WHERE is_active;
