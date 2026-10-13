ALTER TABLE housing.offers
    DROP CONSTRAINT IF EXISTS offers_price_period_check;

ALTER TABLE housing.offers
    ADD CONSTRAINT offers_price_period_check
    CHECK (price_period IN ('night', 'day', 'week', 'month', 'year', 'total'));

CREATE TABLE IF NOT EXISTS housing.listing_media (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id uuid NOT NULL REFERENCES housing.listings(id) ON DELETE CASCADE,
    url text NOT NULL,
    alt_text text,
    position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
    is_primary boolean NOT NULL DEFAULT false,
    source_type text NOT NULL,
    attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (listing_id, url)
);

CREATE INDEX IF NOT EXISTS listing_media_listing_position_idx
    ON housing.listing_media (listing_id, position, id);

ALTER TABLE integration.source_records
    DROP CONSTRAINT IF EXISTS source_records_validation_status_check;

ALTER TABLE integration.source_records
    ADD CONSTRAINT source_records_validation_status_check
    CHECK (validation_status IN ('accepted', 'rejected', 'duplicate', 'quarantined'));

CREATE TABLE IF NOT EXISTS integration.housing_staging (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    import_run_id uuid NOT NULL REFERENCES geo.import_runs(id) ON DELETE CASCADE,
    provider text NOT NULL,
    source_listing_id text NOT NULL,
    source_url text,
    observed_at timestamptz,
    longitude double precision,
    latitude double precision,
    payload jsonb NOT NULL,
    payload_hash text NOT NULL,
    validation_status text NOT NULL
        CHECK (validation_status IN ('accepted', 'rejected', 'duplicate', 'quarantined')),
    validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
    canonical_place_id uuid,
    canonical_property_id uuid,
    canonical_unit_id uuid,
    canonical_listing_id uuid,
    canonical_offer_id uuid,
    publish_action text NOT NULL DEFAULT 'pending'
        CHECK (publish_action IN ('pending', 'published', 'updated', 'protected', 'duplicate', 'rejected', 'quarantined')),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (import_run_id, provider, source_listing_id, payload_hash)
);

CREATE INDEX IF NOT EXISTS housing_staging_run_status_idx
    ON integration.housing_staging (import_run_id, validation_status);
CREATE INDEX IF NOT EXISTS housing_staging_source_idx
    ON integration.housing_staging (provider, source_listing_id);

CREATE INDEX IF NOT EXISTS listings_active_map_idx
    ON housing.listings (property_id, id)
    WHERE status = 'active' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS places_non_housing_map_idx
    ON catalog.places (id)
    WHERE status = 'active'
      AND deleted_at IS NULL
      AND COALESCE(attributes->>'entity_role', '') <> 'housing_anchor';
