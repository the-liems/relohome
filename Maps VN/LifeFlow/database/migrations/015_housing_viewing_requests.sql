-- Viewing times booked in the tenant's "Xem nhà" tab reach the landlord inbox
-- (docs/review/viewing-landlord-confirmation.md). Additive: one optional slot per open request.
ALTER TABLE housing.contact_requests
    ADD COLUMN IF NOT EXISTS viewing_slot timestamptz,
    ADD COLUMN IF NOT EXISTS viewing_status text
        CHECK (viewing_status IN ('requested', 'confirmed', 'declined', 'cancelled')),
    ADD COLUMN IF NOT EXISTS viewing_updated_at timestamptz,
    ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'contact'
        CHECK (source IN ('contact', 'viewing'));
