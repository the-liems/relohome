-- Additive publication guards. Imported inventory and canonical identities are retained.
ALTER TABLE housing.properties ADD COLUMN revision integer NOT NULL DEFAULT 1,
    ADD COLUMN location_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN location_confirmed_at timestamptz;
ALTER TABLE housing.units ADD COLUMN revision integer NOT NULL DEFAULT 1;
ALTER TABLE housing.managed_listings ADD COLUMN approved_revision integer;
ALTER TABLE housing.listing_media ADD COLUMN deleted_at timestamptz, ADD COLUMN storage_key text,
    ADD COLUMN content_sha256 text CHECK (content_sha256 IS NULL OR content_sha256 ~ '^[a-f0-9]{64}$');
UPDATE housing.listing_media SET storage_key=substring(url from '/web/media/housing/([a-f0-9]{40}\.png)$') WHERE source_type='self_service';
CREATE INDEX listing_media_storage_idx ON housing.listing_media(storage_key) WHERE storage_key IS NOT NULL;
CREATE UNIQUE INDEX listing_media_content_idx ON housing.listing_media(listing_id,content_sha256)
    WHERE deleted_at IS NULL AND content_sha256 IS NOT NULL;
CREATE INDEX managed_listing_creator_idx ON housing.managed_listings(created_by,updated_at DESC);
CREATE INDEX listing_events_actor_time_idx ON housing.listing_events(listing_id,occurred_at,event_type);
CREATE TABLE housing.listing_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 listing_id uuid NOT NULL REFERENCES housing.listings(id),
 actor_id text NOT NULL,
 decision text NOT NULL CHECK(decision IN ('approve','reject')),
 reason text,
 reviewed_revision integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(decision<>'reject' OR (reason IS NOT NULL AND length(trim(reason))>0))
);
CREATE INDEX listing_reviews_listing_idx ON housing.listing_reviews(listing_id,created_at DESC);

-- Preserve previously reviewed records; do not claim geocoding or independent verification.
UPDATE housing.properties p SET revision=q.revision,
    location_confirmed_at=q.reviewed_at,
    location_metadata=CASE WHEN q.reviewed_at IS NOT NULL THEN '{"source":"legacy_review"}'::jsonb ELSE '{}'::jsonb END
FROM (SELECT property_id,max(revision) AS revision,max(reviewed_at) FILTER(WHERE status='active') AS reviewed_at
      FROM housing.management_members GROUP BY property_id) q WHERE q.property_id=p.id;
UPDATE housing.managed_listings SET approved_revision=revision WHERE publication_status='published';

CREATE VIEW housing.managed_listing_visibility AS
SELECT ml.listing_id,
    (ml.publication_status='published' AND ml.availability_status='vacant'
     AND ml.approved_revision=ml.revision AND p.location_confirmed_at IS NOT NULL
     AND (hp.status='verified' OR (hp.user_id IS NULL AND p.location_metadata->>'source'='legacy_review'))
     AND EXISTS(SELECT 1 FROM housing.management_members mm
                WHERE mm.property_id=l.property_id AND mm.user_id=ml.created_by AND mm.status='active')) IS TRUE AS is_public
FROM housing.managed_listings ml JOIN housing.listings l ON l.id=ml.listing_id
JOIN housing.properties p ON p.id=l.property_id
LEFT JOIN housing.host_profiles hp ON hp.user_id=ml.created_by;

CREATE OR REPLACE VIEW housing.map_point_source AS
SELECT l.id,l.property_id,u.id AS unit_id,p.place_id,cp.geom,cp.address,
       p.property_type,l.listing_type,u.bedrooms,u.bathrooms,u.area_m2,
       COALESCE(u.amenities,'{}'::text[]) AS amenities,l.verification_status,
       l.source_type,l.created_at,l.verified_at,l.updated_at
FROM housing.listings l JOIN housing.properties p ON p.id=l.property_id AND p.deleted_at IS NULL
LEFT JOIN housing.units u ON u.id=l.unit_id AND u.deleted_at IS NULL
JOIN catalog.places cp ON cp.id=p.place_id AND cp.deleted_at IS NULL AND cp.status='active'
WHERE l.status='active' AND l.deleted_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM housing.managed_listing_visibility v WHERE v.listing_id=l.id AND NOT v.is_public);

CREATE FUNCTION housing.invalidate_managed_content(ids uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 UPDATE housing.managed_listings SET
   publication_status=CASE WHEN publication_status IN ('hidden','deleted') THEN publication_status ELSE 'draft' END,
   approved_revision=NULL,revision=revision+1,updated_at=now()
 WHERE listing_id=ANY(ids) AND publication_status<>'deleted';
END;
$$;
REVOKE ALL ON FUNCTION housing.invalidate_managed_content(uuid[]) FROM PUBLIC;

CREATE FUNCTION housing.invalidate_content_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE ids uuid[];
BEGIN
 IF TG_TABLE_NAME='listings' THEN
   IF (OLD.title,OLD.description,OLD.property_id,OLD.unit_id,OLD.listing_type)
      IS NOT DISTINCT FROM (NEW.title,NEW.description,NEW.property_id,NEW.unit_id,NEW.listing_type) THEN RETURN NULL; END IF;
   ids=ARRAY[NEW.id];
 ELSIF TG_TABLE_NAME='properties' THEN
   IF (OLD.name,OLD.property_type,OLD.location_metadata,OLD.location_confirmed_at)
      IS NOT DISTINCT FROM (NEW.name,NEW.property_type,NEW.location_metadata,NEW.location_confirmed_at) THEN RETURN NULL; END IF;
   SELECT array_agg(id) INTO ids FROM housing.listings WHERE property_id=NEW.id;
 ELSIF TG_TABLE_NAME='units' THEN
   IF (OLD.unit_code,OLD.area_m2,OLD.bedrooms,OLD.bathrooms,OLD.amenities)
      IS NOT DISTINCT FROM (NEW.unit_code,NEW.area_m2,NEW.bedrooms,NEW.bathrooms,NEW.amenities) THEN RETURN NULL; END IF;
   SELECT array_agg(id) INTO ids FROM housing.listings WHERE unit_id=NEW.id;
 ELSIF TG_TABLE_NAME='places' THEN
   IF (OLD.address,OLD.geom::text) IS NOT DISTINCT FROM (NEW.address,NEW.geom::text) THEN RETURN NULL; END IF;
   SELECT array_agg(l.id) INTO ids FROM housing.listings l JOIN housing.properties p ON p.id=l.property_id WHERE p.place_id=NEW.id;
 ELSE
   IF TG_OP='DELETE' THEN ids=ARRAY[OLD.listing_id]; ELSE ids=ARRAY[NEW.listing_id]; END IF;
   IF TG_OP='UPDATE' AND TG_TABLE_NAME='listing_media' THEN
     -- Moderation alone does not edit content or invalidate the approval being committed.
     IF (OLD.url,OLD.alt_text,OLD.position,OLD.is_primary,OLD.deleted_at)
        IS NOT DISTINCT FROM (NEW.url,NEW.alt_text,NEW.position,NEW.is_primary,NEW.deleted_at) THEN RETURN NULL; END IF;
   END IF;
 END IF;
 PERFORM housing.invalidate_managed_content(ids);
 RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION housing.invalidate_content_trigger() FROM PUBLIC;
CREATE TRIGGER managed_listing_content AFTER UPDATE OF title,description,property_id,unit_id,listing_type ON housing.listings
 FOR EACH ROW EXECUTE FUNCTION housing.invalidate_content_trigger();
CREATE TRIGGER managed_property_content AFTER UPDATE ON housing.properties FOR EACH ROW EXECUTE FUNCTION housing.invalidate_content_trigger();
CREATE TRIGGER managed_unit_content AFTER UPDATE ON housing.units FOR EACH ROW EXECUTE FUNCTION housing.invalidate_content_trigger();
CREATE TRIGGER managed_place_content AFTER UPDATE OF address,geom ON catalog.places FOR EACH ROW EXECUTE FUNCTION housing.invalidate_content_trigger();
CREATE TRIGGER managed_offer_content AFTER INSERT OR UPDATE OR DELETE ON housing.offers FOR EACH ROW EXECUTE FUNCTION housing.invalidate_content_trigger();
CREATE TRIGGER managed_fee_content AFTER INSERT OR UPDATE OR DELETE ON housing.listing_fees FOR EACH ROW EXECUTE FUNCTION housing.invalidate_content_trigger();
CREATE TRIGGER managed_media_content AFTER INSERT OR UPDATE OR DELETE ON housing.listing_media FOR EACH ROW EXECUTE FUNCTION housing.invalidate_content_trigger();

CREATE FUNCTION housing.carry_publication_approval() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.publication_status='published' AND NEW.publication_status='published'
    AND OLD.approved_revision=OLD.revision AND NEW.approved_revision=OLD.approved_revision THEN
   NEW.approved_revision=NEW.revision;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER managed_carry_approval BEFORE UPDATE ON housing.managed_listings
 FOR EACH ROW EXECUTE FUNCTION housing.carry_publication_approval();

CREATE FUNCTION housing.sync_managed_publication() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 UPDATE housing.listings l SET status=CASE WHEN v.is_public THEN 'active' ELSE 'inactive' END,updated_at=now()
 FROM housing.managed_listing_visibility v WHERE v.listing_id=NEW.listing_id AND l.id=v.listing_id;
 RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION housing.sync_managed_publication() FROM PUBLIC;
CREATE TRIGGER managed_publication_sync AFTER INSERT OR UPDATE ON housing.managed_listings
 FOR EACH ROW EXECUTE FUNCTION housing.sync_managed_publication();

CREATE FUNCTION housing.sync_host_visibility() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 UPDATE housing.listings l SET status=CASE WHEN v.is_public THEN 'active' ELSE 'inactive' END,updated_at=now()
 FROM housing.managed_listing_visibility v JOIN housing.managed_listings ml ON ml.listing_id=v.listing_id
 WHERE l.id=v.listing_id AND ml.created_by=NEW.user_id;
 RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION housing.sync_host_visibility() FROM PUBLIC;
CREATE TRIGGER host_visibility_sync AFTER UPDATE OF status ON housing.host_profiles FOR EACH ROW EXECUTE FUNCTION housing.sync_host_visibility();
CREATE TRIGGER member_visibility_sync AFTER UPDATE OF status ON housing.management_members FOR EACH ROW EXECUTE FUNCTION housing.sync_host_visibility();

UPDATE housing.listings l SET status=CASE WHEN v.is_public THEN 'active' ELSE 'inactive' END
FROM housing.managed_listing_visibility v WHERE v.listing_id=l.id;
DELETE FROM housing.map_points m WHERE NOT EXISTS(SELECT 1 FROM housing.map_point_source s WHERE s.id=m.id);
