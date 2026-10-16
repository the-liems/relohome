-- Additive tenant/landlord handoff. Keep messages and payment evidence when an inbox is cleared.
ALTER TABLE housing.contact_requests
    ADD COLUMN IF NOT EXISTS viewing_options jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS tenant_activity_at timestamptz,
    ADD COLUMN IF NOT EXISTS landlord_activity_at timestamptz,
    ADD COLUMN IF NOT EXISTS tenant_activity_read_at timestamptz,
    ADD COLUMN IF NOT EXISTS landlord_activity_read_at timestamptz;

CREATE TABLE IF NOT EXISTS housing.contact_archives (
    request_id uuid NOT NULL REFERENCES housing.contact_requests(id) ON DELETE CASCADE,
    user_id text NOT NULL,
    archived_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(request_id, user_id)
);

CREATE TABLE IF NOT EXISTS housing.rent_payment_reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id uuid NOT NULL REFERENCES housing.contact_requests(id) ON DELETE CASCADE,
    tenant_user_id text NOT NULL,
    report_key text NOT NULL CHECK (char_length(report_key) BETWEEN 8 AND 160),
    amount_vnd bigint NOT NULL CHECK (amount_vnd BETWEEN 1 AND 10000000000),
    paid_on date NOT NULL,
    agreement jsonb NOT NULL DEFAULT '{}'::jsonb,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected')),
    revision integer NOT NULL DEFAULT 1,
    reason text,
    reviewed_by text,
    reviewed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(tenant_user_id, report_key),
    CHECK (status <> 'rejected' OR (reason IS NOT NULL AND char_length(btrim(reason)) > 0))
);
CREATE UNIQUE INDEX IF NOT EXISTS rent_payment_one_pending_idx
    ON housing.rent_payment_reports(request_id) WHERE status='pending';
CREATE INDEX IF NOT EXISTS rent_payment_request_time_idx
    ON housing.rent_payment_reports(request_id, created_at DESC);
