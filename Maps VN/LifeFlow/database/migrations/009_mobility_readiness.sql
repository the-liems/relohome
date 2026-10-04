CREATE SCHEMA IF NOT EXISTS mobility;

CREATE TABLE mobility.service_areas (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider text NOT NULL CHECK (provider IN ('lifeflow', 'ahamove', 'grab')),
    city text NOT NULL CHECK (city IN ('hcm', 'hanoi', 'danang')),
    service_code text NOT NULL,
    source_type text NOT NULL,
    source_ref text NOT NULL,
    geom geometry(MultiPolygon, 4326) NOT NULL,
    observed_at timestamptz NOT NULL,
    expires_at timestamptz,
    enabled boolean NOT NULL DEFAULT true,
    CHECK (expires_at IS NULL OR expires_at > observed_at),
    UNIQUE (provider, city, service_code, source_type, source_ref)
);
CREATE INDEX service_areas_geom_gix ON mobility.service_areas USING GIST (geom);
CREATE INDEX service_areas_lookup_idx ON mobility.service_areas (provider, city, enabled, expires_at);

CREATE TABLE mobility.pricing_rules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider text NOT NULL DEFAULT 'lifeflow' CHECK (provider = 'lifeflow'),
    city text NOT NULL CHECK (city IN ('hcm', 'hanoi', 'danang')),
    service_code text NOT NULL,
    profile text NOT NULL CHECK (profile IN ('driving', 'motorcycle', 'walking')),
    version integer NOT NULL CHECK (version > 0),
    base_vnd numeric(18,2) NOT NULL CHECK (base_vnd >= 0),
    per_km_vnd numeric(18,2) NOT NULL CHECK (per_km_vnd >= 0),
    minimum_vnd numeric(18,2) NOT NULL CHECK (minimum_vnd >= 0),
    valid_from timestamptz NOT NULL,
    valid_to timestamptz,
    enabled boolean NOT NULL DEFAULT true,
    CHECK (valid_to IS NULL OR valid_to > valid_from),
    UNIQUE (provider, city, service_code, profile, version)
);
CREATE INDEX pricing_rules_lookup_idx ON mobility.pricing_rules (city, service_code, profile, enabled, valid_from DESC);

INSERT INTO catalog.place_categories (slug, name, parent_slug)
VALUES ('moving_service', 'Moving service', NULL)
ON CONFLICT (slug) DO NOTHING;
