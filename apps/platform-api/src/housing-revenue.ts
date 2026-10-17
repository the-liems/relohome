import type { FastifyInstance } from 'fastify'
import type { DatabasePool } from '@relohome/housing-query'
import { z } from 'zod'
import { actor, member } from './housing-management.js'
import type { HousingClient } from './housing-policy.js'

// Estimated landlord revenue: monthly rent x days a listing was rented, from
// housing.rent_periods. Rent after the first month never passes through ReloHome,
// so this is an estimate. Deposits are never counted.

const TODAY = `(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`
const ACTIVE_RENT = `(SELECT price_amount FROM housing.offers WHERE listing_id=$1 AND is_active ORDER BY valid_from DESC LIMIT 1)`

/** Accepts only a real calendar date (older reports allowed text such as 2026-02-31). */
export function calendarDate(value: unknown): string | null {
  // JavaScript accepts year zero, but PostgreSQL dates do not.
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return null
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : value
}
const RENT_LIMIT = 10_000_000_000
export function plausibleRent(value: unknown): number | null {
  const rent = Number(value)
  return Number.isFinite(rent) && rent >= 1 && rent <= RENT_LIMIT ? Math.round(rent) : null
}

/** Caller owns the transaction: an overlap constraint failure rolls back both writes. */
export async function startRentPeriod(
  client: HousingClient,
  listingId: string,
  options: { source: 'payment' | 'manual'; startsOn?: string | null; rentVnd?: number | null; reportId?: string },
) {
  const startsOn = calendarDate(options.startsOn)
  const rent = plausibleRent(options.rentVnd)
  await client.query(
    `UPDATE housing.rent_periods SET ends_on=GREATEST(starts_on,COALESCE($2::date,${TODAY}))
    WHERE listing_id=$1 AND ends_on IS NULL`,
    [listingId, startsOn],
  )
  await client.query(
    `INSERT INTO housing.rent_periods(listing_id,monthly_rent_vnd,starts_on,source,payment_report_id)
    SELECT $1,rent::bigint,COALESCE($2::date,${TODAY}),$4,$5
    FROM (SELECT round(COALESCE($3::numeric,${ACTIVE_RENT})) AS rent) r
    WHERE rent BETWEEN 1 AND ${RENT_LIMIT}`,
    [listingId, startsOn, rent, options.source, options.reportId ?? null],
  )
}

export async function endRentPeriod(client: HousingClient, listingId: string) {
  await client.query(
    `UPDATE housing.rent_periods SET ends_on=GREATEST(starts_on,${TODAY}) WHERE listing_id=$1 AND ends_on IS NULL`,
    [listingId],
  )
}

const Query = z.object({
  months: z.coerce
    .number()
    .refine(v => v === 3 || v === 6 || v === 12)
    .default(6),
  property_id: z.string().uuid().optional(),
})

export function registerHousingRevenue(app: FastifyInstance, pool: DatabasePool) {
  app.get('/v1/landlord/revenue', async request => {
    const user = actor(request),
      input = Query.parse(request.query)
    if (input.property_id) await member(pool, user, input.property_id)
    const values = [user, input.months, input.property_id ?? null]
    const owned = `SELECT p.id,p.name,p.created_at FROM housing.properties p
      JOIN housing.management_members mm ON mm.property_id=p.id AND mm.user_id=$1 AND mm.status<>'revoked'
      WHERE p.deleted_at IS NULL AND $2::int>0 AND ($3::uuid IS NULL OR p.id=$3)`
    // Periods end before ends_on, today+1 for open ones, or when the listing was deleted.
    // Each month earns rent x overlapping days / days in that month; the current month runs to today.
    // A period that has not started yet (future move-in) or is empty earns nothing.
    const [amounts, properties, today] = await Promise.all([
      pool.query(
        `WITH owned AS (${owned}),
        months AS (
          SELECT m::date AS month_start,(m+interval '1 month')::date AS next_month
          FROM generate_series(date_trunc('month',${TODAY})-(2*$2::int-1)*interval '1 month',date_trunc('month',${TODAY}),interval '1 month') m
        ),
        periods AS (
          SELECT l.property_id,rp.monthly_rent_vnd,rp.starts_on,
          LEAST(COALESCE(rp.ends_on,${TODAY}+1),${TODAY}+1,COALESCE((l.deleted_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,${TODAY}+1)) AS ends_before
          FROM housing.rent_periods rp JOIN housing.listings l ON l.id=rp.listing_id JOIN owned ON owned.id=l.property_id
        )
        SELECT to_char(m.month_start,'YYYY-MM') AS month,p.property_id,
        round(sum(p.monthly_rent_vnd*(LEAST(p.ends_before,m.next_month)-GREATEST(p.starts_on,m.month_start))::numeric
          /(m.next_month-m.month_start)))::float AS amount
        FROM months m JOIN periods p ON p.starts_on<m.next_month AND p.ends_before>m.month_start AND p.ends_before>p.starts_on
        GROUP BY 1,2`,
        values,
      ),
      pool.query(
        `WITH owned AS (${owned}) SELECT o.id,o.name,
        (SELECT count(*)::int FROM housing.units u WHERE u.property_id=o.id AND u.deleted_at IS NULL) AS units,
        (SELECT count(DISTINCT l.unit_id)::int FROM housing.listings l JOIN housing.managed_listings ml ON ml.listing_id=l.id
          WHERE l.property_id=o.id AND l.deleted_at IS NULL AND ml.availability_status='rented') AS rented_units
        FROM owned o ORDER BY o.created_at,o.id`,
        values,
      ),
      pool.query(`SELECT to_char(${TODAY},'YYYY-MM-DD') AS today`),
    ])
    const asOf = String(today.rows[0].today)
    const month = (offset: number) => {
      const date = new Date(Date.UTC(Number(asOf.slice(0, 4)), Number(asOf.slice(5, 7)) - 1 - offset, 1))
      return date.toISOString().slice(0, 7)
    }
    const amount = new Map<string, number>()
    for (const row of amounts.rows) amount.set(`${row.month}|${row.property_id}`, Number(row.amount))
    const ids = properties.rows.map(row => String(row.id))
    const sum = (keys: string[], scope = ids) =>
      keys.reduce((total, key) => total + scope.reduce((s, id) => s + (amount.get(`${key}|${id}`) ?? 0), 0), 0)
    const current = Array.from({ length: input.months }, (_, i) => month(input.months - 1 - i))
    const previous = Array.from({ length: input.months }, (_, i) => month(2 * input.months - 1 - i))
    const total = sum(current)
    return {
      months: input.months,
      timezone: 'Asia/Ho_Chi_Minh',
      as_of: asOf,
      estimated: true,
      series: current.map(key => ({
        month: key,
        total: sum([key]),
        by_property: Object.fromEntries(ids.map(id => [id, amount.get(`${key}|${id}`) ?? 0])),
      })),
      properties: properties.rows.map(row => ({
        id: String(row.id),
        name: row.name,
        units: row.units,
        rented_units: row.rented_units,
        period_total: sum(current, [String(row.id)]),
        current_month: amount.get(`${month(0)}|${row.id}`) ?? 0,
        previous_month: amount.get(`${month(1)}|${row.id}`) ?? 0,
      })),
      total,
      previous_total: sum(previous),
      average_monthly: Math.round(total / input.months),
      definitions: {
        revenue:
          'Ước tính: giá thuê hằng tháng × số ngày phòng ở trạng thái đã thuê. Không gồm tiền cọc và các khoản thu hộ.',
      },
    }
  })
}
