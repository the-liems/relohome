-- Poster profile behind the owner workspace (docs/review/host-mode-design.md). Additive only.
-- One row per account; identity checks are done by a moderator outside the app (pilot) and only
-- the outcome is stored here, never document images or numbers.
CREATE TABLE IF NOT EXISTS housing.host_profiles (
    user_id text PRIMARY KEY,
    poster_type text NOT NULL CHECK (poster_type IN ('owner', 'manager', 'broker', 'business')),
    display_name text NOT NULL,
    legal_name text NOT NULL,
    phone text NOT NULL,
    broker_license_no text,
    business_name text,
    tax_code text,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'needs_info')),
    verification_method text CHECK (verification_method IN ('phone_call', 'video_call', 'in_person')),
    review_note text,          -- moderator only
    info_request text,         -- shown to the poster when status = needs_info
    reviewed_at timestamptz,
    reviewed_by text,
    terms_version text,
    terms_accepted_at timestamptz,
    revision integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS host_profiles_status_idx ON housing.host_profiles (status, updated_at);
