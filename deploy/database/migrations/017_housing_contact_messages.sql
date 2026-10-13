-- In-app messages between a tenant and the landlord of one contact request (one conversation per
-- open request). Additive; phone numbers stay private (SPEC-021: contact through the in-app inbox).
CREATE TABLE IF NOT EXISTS housing.contact_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id uuid NOT NULL REFERENCES housing.contact_requests(id) ON DELETE CASCADE,
    sender_role text NOT NULL CHECK (sender_role IN ('tenant', 'landlord')),
    sender_user_id text NOT NULL,
    body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contact_messages_request_time_idx
    ON housing.contact_messages (request_id, created_at);

ALTER TABLE housing.contact_requests
    ADD COLUMN IF NOT EXISTS tenant_read_at timestamptz,
    ADD COLUMN IF NOT EXISTS landlord_read_at timestamptz;
