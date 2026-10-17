-- Meeting evidence is a tenant report made after a confirmed appointment is due.
-- Existing contact-only reviews remain visible, but cannot establish new eligibility.
ALTER TABLE housing.contact_requests ADD COLUMN visit_met_at timestamptz;
COMMENT ON COLUMN housing.contact_requests.visit_met_at IS
  'Tenant reported meeting the landlord after a confirmed appointment; not proof of tenancy.';
