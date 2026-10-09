import type { DatabasePool } from './database.js'

export function reviewSetting(name: string, fallback: number, max = 10000) {
  const value = Number(process.env[name] || fallback)
  return Number.isInteger(value) && value >= 1 && value <= max ? value : fallback
}

export interface ReviewSummary {
  rating: number | null
  count: number
  property_count: number
  histogram: Record<string, number>
}

export async function hostReviewSummary(db: Pick<DatabasePool, 'query'>, host: string, property?: string): Promise<ReviewSummary> {
  const result = await db.query(
    `SELECT count(*)::int AS count,count(DISTINCT property_id)::int AS property_count,
       round(avg(rating),1)::float AS rating,
       count(*) FILTER (WHERE rating=1)::int AS one,count(*) FILTER (WHERE rating=2)::int AS two,
       count(*) FILTER (WHERE rating=3)::int AS three,count(*) FILTER (WHERE rating=4)::int AS four,
       count(*) FILTER (WHERE rating=5)::int AS five
     FROM housing.reviews WHERE host_user_id=$1 AND status='published'
       AND ($2::uuid IS NULL OR property_id=$2)`, [host, property ?? null],
  )
  const row = result.rows[0]
  return {
    rating: row.count >= reviewSetting('HOUSING_REVIEW_MIN_COUNT', 1) ? row.rating : null,
    count: row.count, property_count: row.property_count,
    histogram: { '1': row.one, '2': row.two, '3': row.three, '4': row.four, '5': row.five },
  }
}
