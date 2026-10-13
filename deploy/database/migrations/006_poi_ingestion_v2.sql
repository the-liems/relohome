ALTER TABLE geo.import_runs
    ADD COLUMN IF NOT EXISTS staged_count integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS published_count integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS unchanged_count integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS source_version text;

ALTER TABLE catalog.places
    ADD COLUMN IF NOT EXISTS opening_hours text;

ALTER TABLE integration.source_records
    ADD COLUMN IF NOT EXISTS osm_type text,
    ADD COLUMN IF NOT EXISTS osm_id bigint,
    ADD COLUMN IF NOT EXISTS geom geometry(Geometry, 4326),
    ADD COLUMN IF NOT EXISTS first_seen_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS source_version text,
    ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'source_records_status_check'
    ) THEN
        ALTER TABLE integration.source_records
            ADD CONSTRAINT source_records_status_check
            CHECK (status IN ('active', 'stale', 'inactive'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS source_records_osm_identity_idx
    ON integration.source_records (osm_type, osm_id)
    WHERE source_type = 'osm';
CREATE INDEX IF NOT EXISTS source_records_geom_gix
    ON integration.source_records USING GIST (geom)
    WHERE geom IS NOT NULL;
CREATE INDEX IF NOT EXISTS source_records_last_seen_idx
    ON integration.source_records (source_type, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS geo.poi_staging (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    import_run_id uuid NOT NULL REFERENCES geo.import_runs(id) ON DELETE CASCADE,
    source_type text NOT NULL,
    source_id text NOT NULL,
    osm_type text,
    osm_id bigint,
    source_geom geometry(Geometry, 4326),
    representative_geom geometry(Point, 4326),
    raw_tags jsonb NOT NULL DEFAULT '{}'::jsonb,
    payload_hash text NOT NULL,
    category_slug text,
    name text,
    address jsonb NOT NULL DEFAULT '{}'::jsonb,
    phone text,
    website text,
    opening_hours text,
    validation_status text NOT NULL
        CHECK (validation_status IN ('accepted', 'rejected', 'duplicate')),
    validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
    canonical_place_id uuid,
    publish_action text NOT NULL DEFAULT 'pending'
        CHECK (publish_action IN (
            'pending', 'published', 'updated', 'matched_existing',
            'duplicate', 'rejected', 'protected'
        )),
    possible_duplicate boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS poi_staging_run_status_idx
    ON geo.poi_staging (import_run_id, validation_status);
CREATE INDEX IF NOT EXISTS poi_staging_source_idx
    ON geo.poi_staging (source_type, source_id);
CREATE INDEX IF NOT EXISTS poi_staging_category_idx
    ON geo.poi_staging (category_slug);
CREATE INDEX IF NOT EXISTS poi_staging_geom_gix
    ON geo.poi_staging USING GIST (representative_geom)
    WHERE representative_geom IS NOT NULL;

INSERT INTO catalog.place_categories (slug, name, parent_slug)
VALUES
    ('healthcare', 'Healthcare', NULL),
    ('hospital', 'Hospital', 'healthcare'),
    ('clinic', 'Clinic', 'healthcare'),
    ('pharmacy', 'Pharmacy', 'healthcare'),
    ('doctor', 'Doctor', 'healthcare'),
    ('dentist', 'Dentist', 'healthcare'),
    ('other_healthcare', 'Other healthcare', 'healthcare'),
    ('shopping', 'Shopping', NULL),
    ('supermarket', 'Supermarket', 'shopping'),
    ('convenience_store', 'Convenience store', 'shopping'),
    ('shopping_mall', 'Shopping mall', 'shopping'),
    ('marketplace', 'Marketplace', 'shopping'),
    ('shop_other', 'Other shop', 'shopping'),
    ('education', 'Education', NULL),
    ('school', 'School', 'education'),
    ('kindergarten', 'Kindergarten', 'education'),
    ('college', 'College', 'education'),
    ('university', 'University', 'education'),
    ('food', 'Food and drink', NULL),
    ('restaurant', 'Restaurant', 'food'),
    ('cafe', 'Cafe', 'food'),
    ('fast_food', 'Fast food', 'food'),
    ('food_court', 'Food court', 'food'),
    ('transport', 'Transport', NULL),
    ('bus_stop', 'Bus stop', 'transport'),
    ('bus_station', 'Bus station', 'transport'),
    ('rail_station', 'Rail station', 'transport'),
    ('airport', 'Airport', 'transport'),
    ('airport_terminal', 'Airport terminal', 'transport'),
    ('public_transport_other', 'Other public transport', 'transport'),
    ('utility', 'Financial and utility', NULL),
    ('bank', 'Bank', 'utility'),
    ('atm', 'ATM', 'utility'),
    ('fuel', 'Fuel station', 'utility'),
    ('parking', 'Parking', 'utility'),
    ('ev_charging', 'EV charging', 'utility'),
    ('lifestyle', 'Lifestyle', NULL),
    ('gym', 'Gym', 'lifestyle'),
    ('sports_centre', 'Sports centre', 'lifestyle'),
    ('park', 'Park', 'lifestyle'),
    ('swimming_pool', 'Swimming pool', 'lifestyle'),
    ('resort', 'Resort', 'accommodation'),
    ('camp_site', 'Camp site', 'accommodation'),
    ('chalet', 'Chalet', 'accommodation')
ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    parent_slug = EXCLUDED.parent_slug;
