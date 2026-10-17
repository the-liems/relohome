-- Revenue periods use [starts_on, ends_on): adjacent tenancies are legal,
-- empty periods earn nothing, and a NULL end has no upper bound.
-- Keep this separate from 029 so deployed migration checksums stay valid.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Never rewrite historical dates to make the constraint fit. Stop the release
-- with an actionable error if an older version has already recorded overlap.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM housing.rent_periods a
        JOIN housing.rent_periods b ON a.listing_id = b.listing_id AND a.id < b.id
        WHERE daterange(a.starts_on, a.ends_on, '[)') && daterange(b.starts_on, b.ends_on, '[)')
    ) THEN
        RAISE EXCEPTION 'Existing housing rent periods overlap; migration 030 cannot be applied'
            USING HINT = 'Review the recorded periods for each listing and correct them explicitly before retrying. No dates have been changed automatically.';
    END IF;
END $$;

-- A constraint, rather than a read-then-insert check, also protects concurrent
-- transactions and UPDATEs. Keep the existing one-open-period unique index.
ALTER TABLE housing.rent_periods
    ADD CONSTRAINT rent_periods_no_overlap
    EXCLUDE USING gist (listing_id WITH =, daterange(starts_on, ends_on, '[)') WITH &&);
