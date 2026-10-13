CREATE TABLE IF NOT EXISTS geo.import_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type text NOT NULL,
    source_path text NOT NULL,
    source_checksum text,
    status text NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
    started_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    input_count integer NOT NULL DEFAULT 0,
    accepted_count integer NOT NULL DEFAULT 0,
    rejected_count integer NOT NULL DEFAULT 0,
    diagnostics jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS geo.administrative_areas (
    id text PRIMARY KEY,
    name text NOT NULL,
    level text NOT NULL,
    source text NOT NULL,
    source_id text NOT NULL,
    geom geometry(MultiPolygon, 4326) NOT NULL,
    attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source, source_id)
);

CREATE INDEX IF NOT EXISTS administrative_areas_geom_gix
    ON geo.administrative_areas USING GIST (geom);

CREATE TABLE IF NOT EXISTS catalog.place_categories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text NOT NULL UNIQUE,
    name text NOT NULL,
    parent_slug text,
    attributes jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS catalog.places (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id uuid NOT NULL REFERENCES catalog.place_categories(id),
    name text,
    geom geometry(Point, 4326) NOT NULL,
    geog geography(Point, 4326) GENERATED ALWAYS AS (geom::geography) STORED,
    address jsonb NOT NULL DEFAULT '{}'::jsonb,
    phone text,
    website text,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'stale')),
    verification_status text NOT NULL DEFAULT 'unverified'
        CHECK (verification_status IN ('unverified', 'source_verified', 'lifeflow_verified')),
    verified_at timestamptz,
    verified_by text,
    attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS places_geom_gix ON catalog.places USING GIST (geom);
CREATE INDEX IF NOT EXISTS places_geog_gix ON catalog.places USING GIST (geog);
CREATE INDEX IF NOT EXISTS places_name_trgm_gin
    ON catalog.places USING GIN (name gin_trgm_ops) WHERE name IS NOT NULL;
CREATE INDEX IF NOT EXISTS places_category_idx ON catalog.places (category_id);
CREATE INDEX IF NOT EXISTS places_status_idx ON catalog.places (status) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS catalog.place_sources (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    place_id uuid NOT NULL REFERENCES catalog.places(id) ON DELETE CASCADE,
    import_run_id uuid REFERENCES geo.import_runs(id),
    source_type text NOT NULL,
    source_id text NOT NULL,
    source_url text,
    source_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    observed_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source_type, source_id)
);

CREATE INDEX IF NOT EXISTS place_sources_place_idx ON catalog.place_sources (place_id);

CREATE TABLE IF NOT EXISTS catalog.place_media (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    place_id uuid NOT NULL REFERENCES catalog.places(id) ON DELETE CASCADE,
    url text NOT NULL,
    media_type text NOT NULL DEFAULT 'image',
    alt_text text,
    source_type text NOT NULL,
    attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS housing.properties (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    place_id uuid NOT NULL REFERENCES catalog.places(id),
    property_type text NOT NULL CHECK (
        property_type IN ('apartment', 'house', 'room', 'studio', 'serviced_apartment', 'homestay', 'other')
    ),
    name text,
    attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS properties_place_idx ON housing.properties (place_id);
CREATE INDEX IF NOT EXISTS properties_type_idx ON housing.properties (property_type);

CREATE TABLE IF NOT EXISTS housing.units (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id uuid NOT NULL REFERENCES housing.properties(id),
    unit_code text,
    bedrooms numeric(6,2) CHECK (bedrooms IS NULL OR bedrooms >= 0),
    bathrooms numeric(6,2) CHECK (bathrooms IS NULL OR bathrooms >= 0),
    area_m2 numeric(12,2) CHECK (area_m2 IS NULL OR area_m2 > 0),
    amenities text[] NOT NULL DEFAULT '{}',
    attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    UNIQUE NULLS NOT DISTINCT (property_id, unit_code)
);

CREATE INDEX IF NOT EXISTS units_property_idx ON housing.units (property_id);
CREATE INDEX IF NOT EXISTS units_bedrooms_idx ON housing.units (bedrooms);
CREATE INDEX IF NOT EXISTS units_area_idx ON housing.units (area_m2);
CREATE INDEX IF NOT EXISTS units_amenities_gin ON housing.units USING GIN (amenities);

CREATE TABLE IF NOT EXISTS housing.listings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id uuid NOT NULL REFERENCES housing.properties(id),
    unit_id uuid REFERENCES housing.units(id),
    listing_type text NOT NULL CHECK (listing_type IN ('rent', 'sale', 'short_stay')),
    title text NOT NULL,
    description text,
    source_type text NOT NULL,
    source_listing_id text NOT NULL,
    source_url text,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'stale')),
    verification_status text NOT NULL DEFAULT 'unverified'
        CHECK (verification_status IN ('unverified', 'source_verified', 'lifeflow_verified')),
    verified_at timestamptz,
    verified_by text,
    attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
    published_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    UNIQUE (source_type, source_listing_id)
);

CREATE INDEX IF NOT EXISTS listings_property_idx ON housing.listings (property_id);
CREATE INDEX IF NOT EXISTS listings_unit_idx ON housing.listings (unit_id);
CREATE INDEX IF NOT EXISTS listings_type_status_idx ON housing.listings (listing_type, status);
CREATE INDEX IF NOT EXISTS listings_title_trgm_gin ON housing.listings USING GIN (title gin_trgm_ops);

CREATE TABLE IF NOT EXISTS housing.offers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id uuid NOT NULL REFERENCES housing.listings(id) ON DELETE CASCADE,
    price_amount numeric(18,2) NOT NULL CHECK (price_amount >= 0),
    currency text NOT NULL CHECK (currency IN ('VND', 'USD')),
    price_period text NOT NULL CHECK (price_period IN ('day', 'week', 'month', 'year', 'total')),
    deposit_amount numeric(18,2) CHECK (deposit_amount IS NULL OR deposit_amount >= 0),
    availability_from date,
    availability_to date,
    valid_from timestamptz NOT NULL DEFAULT now(),
    valid_to timestamptz,
    is_active boolean NOT NULL DEFAULT true,
    attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (availability_to IS NULL OR availability_from IS NULL OR availability_from <= availability_to),
    CHECK (valid_to IS NULL OR valid_from <= valid_to)
);

CREATE INDEX IF NOT EXISTS offers_listing_active_idx
    ON housing.offers (listing_id, is_active, valid_from DESC);
CREATE INDEX IF NOT EXISTS offers_price_idx
    ON housing.offers (currency, price_period, price_amount) WHERE is_active;

CREATE TABLE IF NOT EXISTS integration.source_records (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    import_run_id uuid REFERENCES geo.import_runs(id),
    entity_type text NOT NULL,
    entity_id uuid,
    source_type text NOT NULL,
    source_id text NOT NULL,
    payload jsonb NOT NULL,
    payload_hash text NOT NULL,
    validation_status text NOT NULL CHECK (validation_status IN ('accepted', 'rejected', 'duplicate')),
    validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
    observed_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source_type, source_id, payload_hash)
);

CREATE INDEX IF NOT EXISTS source_records_entity_idx
    ON integration.source_records (entity_type, entity_id);

CREATE TABLE IF NOT EXISTS audit.tool_calls (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tool_name text NOT NULL,
    actor_id text,
    request_id text,
    input_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
    result_status text NOT NULL CHECK (result_status IN ('success', 'error')),
    duration_ms integer NOT NULL CHECK (duration_ms >= 0),
    error_code text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tool_calls_created_idx ON audit.tool_calls (created_at DESC);

CREATE OR REPLACE VIEW housing.current_offers AS
SELECT DISTINCT ON (o.listing_id)
    o.*
FROM housing.offers o
WHERE o.is_active
  AND o.valid_from <= now()
  AND (o.valid_to IS NULL OR o.valid_to > now())
ORDER BY o.listing_id, o.valid_from DESC, o.created_at DESC, o.id DESC;
