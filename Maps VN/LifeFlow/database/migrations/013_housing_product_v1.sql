-- Additive owner-managed Housing product tables. Imported listings remain unchanged.
INSERT INTO catalog.place_categories (slug, name, attributes)
VALUES ('housing-self-service', 'Nhà cho thuê tự đăng', '{"internal":true}'::jsonb)
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS housing.management_members (
    property_id uuid NOT NULL REFERENCES housing.properties(id) ON DELETE CASCADE,
    user_id text NOT NULL,
    role text NOT NULL CHECK (role IN ('owner', 'manager')),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'revoked')),
    requested_at timestamptz NOT NULL DEFAULT now(),
    reviewed_at timestamptz,
    reviewed_by text,
    revision integer NOT NULL DEFAULT 1,
    PRIMARY KEY (property_id, user_id)
);
CREATE INDEX IF NOT EXISTS management_members_user_idx
    ON housing.management_members (user_id, status);

CREATE TABLE IF NOT EXISTS housing.managed_listings (
    listing_id uuid PRIMARY KEY REFERENCES housing.listings(id) ON DELETE CASCADE,
    created_by text NOT NULL,
    publication_status text NOT NULL DEFAULT 'draft'
        CHECK (publication_status IN ('draft', 'pending_review', 'published', 'hidden', 'rejected', 'deleted')),
    availability_status text NOT NULL DEFAULT 'vacant'
        CHECK (availability_status IN ('vacant', 'rented', 'paused')),
    availability_confirmed_at timestamptz,
    reviewed_at timestamptz,
    reviewed_by text,
    rejection_reason text,
    revision integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS managed_listings_publication_idx
    ON housing.managed_listings (publication_status, availability_status);

CREATE TABLE IF NOT EXISTS housing.listing_fees (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id uuid NOT NULL REFERENCES housing.listings(id) ON DELETE CASCADE,
    code text NOT NULL,
    label text NOT NULL,
    amount numeric(18,2) CHECK (amount IS NULL OR amount >= 0),
    billing_unit text NOT NULL CHECK (
        billing_unit IN ('month', 'one_time', 'kwh', 'm3', 'person_month', 'vehicle_month')
    ),
    required boolean NOT NULL DEFAULT true,
    refundable boolean NOT NULL DEFAULT false,
    valid_from timestamptz NOT NULL DEFAULT now(),
    valid_to timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (valid_to IS NULL OR valid_from <= valid_to),
    UNIQUE (listing_id, code, valid_from)
);
CREATE INDEX IF NOT EXISTS listing_fees_active_idx
    ON housing.listing_fees (listing_id, code) WHERE valid_to IS NULL;

CREATE TABLE IF NOT EXISTS housing.contact_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id uuid NOT NULL REFERENCES housing.listings(id) ON DELETE CASCADE,
    tenant_user_id text NOT NULL,
    message text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 1000),
    status text NOT NULL DEFAULT 'new'
        CHECK (status IN ('new', 'contacted', 'viewing', 'resolved', 'declined')),
    revision integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contact_requests_listing_idx
    ON housing.contact_requests (listing_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS contact_requests_tenant_idx
    ON housing.contact_requests (tenant_user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS contact_requests_one_open_idx
    ON housing.contact_requests (listing_id, tenant_user_id)
    WHERE status IN ('new', 'contacted', 'viewing');

CREATE TABLE IF NOT EXISTS housing.listing_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id uuid NOT NULL REFERENCES housing.listings(id) ON DELETE CASCADE,
    actor_id text,
    event_type text NOT NULL CHECK (event_type IN ('impression', 'detail_view', 'save', 'contact_request')),
    dedup_key text NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (listing_id, event_type, dedup_key)
);
CREATE INDEX IF NOT EXISTS listing_events_listing_time_idx
    ON housing.listing_events (listing_id, occurred_at DESC);

ALTER TABLE housing.listing_media
    ADD COLUMN IF NOT EXISTS moderation_status text NOT NULL DEFAULT 'approved'
        CHECK (moderation_status IN ('pending', 'approved', 'rejected')),
    ADD COLUMN IF NOT EXISTS uploaded_by text;

