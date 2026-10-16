-- Tenants choose whether a review shows their account name. Existing reviews were
-- written under the anonymous rule, so they stay anonymous.
ALTER TABLE housing.reviews ADD COLUMN IF NOT EXISTS is_anonymous boolean NOT NULL DEFAULT true;
