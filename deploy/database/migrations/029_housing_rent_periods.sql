-- Estimated landlord revenue. One row per stretch of time a listing is rented,
-- opened when it becomes rented and closed when it stops. The monthly rent is a
-- snapshot taken at the start; deposits are never stored here. Revenue built
-- from these rows is an estimate, not a record of money received.
CREATE TABLE IF NOT EXISTS housing.rent_periods (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id uuid NOT NULL REFERENCES housing.listings(id) ON DELETE CASCADE,
    monthly_rent_vnd bigint NOT NULL CHECK (monthly_rent_vnd BETWEEN 1 AND 10000000000),
    starts_on date NOT NULL,
    ends_on date,
    source text NOT NULL CHECK (source IN ('payment', 'manual', 'backfill')),
    payment_report_id uuid REFERENCES housing.rent_payment_reports(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (ends_on IS NULL OR ends_on >= starts_on)
);
CREATE UNIQUE INDEX IF NOT EXISTS rent_periods_one_open_idx
    ON housing.rent_periods(listing_id) WHERE ends_on IS NULL;
CREATE INDEX IF NOT EXISTS rent_periods_listing_time_idx
    ON housing.rent_periods(listing_id, starts_on);
COMMENT ON TABLE housing.rent_periods IS
    'Rented stretches of a listing for estimated revenue (rent x days rented); excludes deposits.';

-- Older transfer reports kept the move-in date and rents as the tenant typed them,
-- so the backfill must read them defensively: text such as 2026-02-31 or an
-- absurd amount may not be cast without raising and must not stop the migration.
CREATE OR REPLACE FUNCTION pg_temp.safe_date(value text) RETURNS date
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
    IF value IS NULL OR value !~ '^\d{4}-\d{2}-\d{2}$' THEN RETURN NULL; END IF;
    RETURN value::date;
EXCEPTION WHEN others THEN
    RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.safe_rent(value text) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE parsed numeric;
BEGIN
    IF value IS NULL OR value !~ '^\d{1,12}(\.\d+)?$' THEN RETURN NULL; END IF;
    parsed := round(value::numeric);
    RETURN CASE WHEN parsed BETWEEN 1 AND 10000000000 THEN parsed END;
EXCEPTION WHEN others THEN
    RETURN NULL;
END $$;

-- Backfill from the latest confirmed transfer report per listing, else from the
-- moment a still-rented listing was last marked rented. A listing that is no
-- longer rented closes on its last availability change.
WITH confirmed AS (
    SELECT DISTINCT ON (cr.listing_id)
        cr.listing_id, r.id AS report_id,
        COALESCE(pg_temp.safe_date(r.agreement->>'move_in'), r.paid_on) AS starts_on,
        COALESCE(
            pg_temp.safe_rent(r.agreement->>'rent_vnd'),
            pg_temp.safe_rent(r.agreement->>'first_month_vnd')
        ) AS rent
    FROM housing.rent_payment_reports r
    JOIN housing.contact_requests cr ON cr.id = r.request_id
    WHERE r.status = 'confirmed'
    ORDER BY cr.listing_id, r.reviewed_at DESC NULLS LAST, r.created_at DESC
), candidates AS (
    SELECT
        ml.listing_id,
        c.report_id,
        COALESCE(
            c.starts_on,
            (COALESCE(ml.availability_confirmed_at, ml.updated_at) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
        ) AS starts_on,
        CASE WHEN ml.availability_status = 'rented' THEN NULL
             ELSE (COALESCE(ml.availability_confirmed_at, ml.updated_at) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date END AS ends_on,
        COALESCE(c.rent, round(o.price_amount)) AS rent
    FROM housing.managed_listings ml
    LEFT JOIN confirmed c ON c.listing_id = ml.listing_id
    LEFT JOIN LATERAL (
        SELECT price_amount FROM housing.offers
        WHERE listing_id = ml.listing_id AND is_active ORDER BY valid_from DESC LIMIT 1
    ) o ON true
    WHERE ml.availability_status = 'rented' OR c.report_id IS NOT NULL
)
INSERT INTO housing.rent_periods(listing_id, monthly_rent_vnd, starts_on, ends_on, source, payment_report_id)
SELECT listing_id,
       CASE WHEN rent BETWEEN 1 AND 10000000000 THEN rent::bigint END,
       starts_on, ends_on,
       CASE WHEN report_id IS NULL THEN 'backfill' ELSE 'payment' END, report_id
FROM candidates
WHERE rent BETWEEN 1 AND 10000000000
  AND (ends_on IS NULL OR ends_on >= starts_on)
  AND NOT EXISTS (SELECT 1 FROM housing.rent_periods p WHERE p.listing_id = candidates.listing_id);
