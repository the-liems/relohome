import type { FastifyInstance } from 'fastify'
import { hostReviewSummary, reviewSetting, type DatabasePool } from '@relohome/housing-query'
import { z } from 'zod'
import { actor, member, moderator, notOwnProperty, ManagementError } from './housing-management.js'
import { withTransaction } from './transaction.js'

type Db = Pick<DatabasePool, 'query'>
const Id = z.string().uuid()
const Page = z.object({
  sort: z.enum(['newest', 'highest', 'lowest']).default('newest'),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
})
// Anonymous unless the tenant chooses to show their account name.
const Rating = z.object({
  rating: z.number().int().min(1).max(5), body: z.string().trim().max(2000).default(''),
  is_anonymous: z.boolean().default(true),
  // Present only when the tenant records a completed meeting in the viewing flow.
  visit_slot: z.iso.datetime({ offset: true }).optional(),
})
const Body = z.object({ body: z.string().trim().min(1).max(2000) })
const Reason = z.object({ reason: z.string().trim().min(1).max(500) })

// Public reviews/replies must not disclose contact data. Moderation handles other disputed claims.
export function validateReviewText(text: string) {
  if (/(?:\+?84|0)(?:[ .()-]*\d){8,10}\b/.test(text) || /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/.test(text)) {
    throw new ManagementError(400, 'Không đưa số điện thoại hoặc email vào nội dung công khai.')
  }
  // Keep Vietnamese accents: normalizing "các"/"lớn" would reject ordinary, respectful reviews.
  if (/(?:^|[\s.,!?;:])(?:khốn\s+nạn|địt|đụ\s+má|cặc|lồn)(?=$|[\s.,!?;:])/iu.test(text)) {
    throw new ManagementError(400, 'Hãy mô tả trải nghiệm bằng ngôn ngữ tôn trọng.')
  }
}

async function listingContext(db: Db, listingId: string, user: string) {
  const result = await db.query(
    `SELECT l.property_id,p.name AS property_name,
      (SELECT mm.user_id FROM housing.management_members mm WHERE mm.property_id=l.property_id
         AND mm.role='owner' AND mm.status<>'revoked' ORDER BY mm.requested_at,mm.user_id LIMIT 1) AS host_user_id,
      EXISTS(SELECT 1 FROM housing.management_members mm WHERE mm.property_id=l.property_id
         AND mm.user_id=$2 AND mm.status<>'revoked') AS manages,
      EXISTS(SELECT 1 FROM housing.contact_requests cr JOIN housing.listings cl ON cl.id=cr.listing_id
         WHERE cl.property_id=l.property_id AND cr.tenant_user_id=$2) AS contacted,
      EXISTS(SELECT 1 FROM housing.contact_requests cr JOIN housing.listings cl ON cl.id=cr.listing_id
         WHERE cl.property_id=l.property_id AND cr.tenant_user_id=$2 AND cr.visit_met_at IS NOT NULL) AS viewed
     FROM housing.listings l JOIN housing.managed_listings ml ON ml.listing_id=l.id
     JOIN housing.properties p ON p.id=l.property_id WHERE l.id=$1`, [listingId, user],
  )
  const context = result.rows[0]
  if (!context?.host_user_id) throw new ManagementError(404, 'Nhà này không có chủ thể quản lý nhận đánh giá trên ReloHome.')
  return context
}

function visibleReview(row: Record<string, unknown>, mine = false) {
  return {
    id: row.id, property_id: row.property_id, property_name: row.property_name,
    rating: row.rating, body: row.body, stage: row.stage, created_at: row.created_at, updated_at: row.updated_at,
    reply_body: row.reply_body, reply_at: row.reply_at, author_label: 'Người thuê',
    is_anonymous: row.is_anonymous !== false,
    // Only a public review names its author; the gateway resolves this to an account name.
    ...(row.is_anonymous === false ? { author_user_id: row.author_user_id } : {}),
    ...(mine ? { status: row.status, hidden_reason: row.hidden_reason } : {}),
  }
}

async function reviewById(db: Db, id: string) {
  const result = await db.query('SELECT * FROM housing.reviews WHERE id=$1', [id])
  if (!result.rows[0]) throw new ManagementError(404, 'Không tìm thấy đánh giá.')
  return result.rows[0]
}

// Serialize rating mutations for one host; flags and review updates commit together.
function transaction<T>(pool: DatabasePool, host: string, work: (db: Db) => Promise<T>) {
  return withTransaction(pool, async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`housing-reviews:${host}`])
    return work(client)
  })
}

async function refreshFlag(db: Db, host: string) {
  const days = reviewSetting('HOUSING_REVIEW_PATTERN_DAYS', 90, 3650)
  const low = reviewSetting('HOUSING_REVIEW_LOW_STARS', 2, 5)
  const result = await db.query(
    `SELECT id,property_id,author_user_id FROM housing.reviews WHERE host_user_id=$1 AND status='published'
      AND rating <= $2 AND updated_at >= now()-make_interval(days => $3::int) ORDER BY id`, [host, low, days],
  )
  const byProperty: Record<string, number> = {}
  for (const row of result.rows) byProperty[row.property_id] = (byProperty[row.property_id] || 0)+1
  const authorCount = new Set(result.rows.map(r => r.author_user_id)).size
  const qualifies = Object.keys(byProperty).length >= reviewSetting('HOUSING_REVIEW_PATTERN_PROPERTIES', 2)
    && authorCount >= reviewSetting('HOUSING_REVIEW_PATTERN_AUTHORS', 3)
  const evidence = { qualifies, window_days: days, low_stars: low, computed_at: new Date().toISOString(),
    property_count: Object.keys(byProperty).length, author_count: authorCount, review_count: result.rows.length,
    properties: Object.entries(byProperty).map(([property_id, count]) => ({ property_id, count })),
    review_ids: result.rows.map(r => r.id) }
  if (qualifies) {
    await db.query(
      `INSERT INTO housing.host_flags(host_user_id,kind,evidence) VALUES($1,'repeated_low_ratings',$2)
       ON CONFLICT(host_user_id,kind) DO UPDATE SET evidence=$2,updated_at=now(),
         status=CASE WHEN housing.host_flags.evidence->'review_ids'=$2::jsonb->'review_ids'
           THEN housing.host_flags.status ELSE 'open' END`, [host, evidence],
    )
  } else {
    // Keep historical evidence visible to moderation, and mark that the current signal is no longer sufficient.
    await db.query(`UPDATE housing.host_flags SET evidence=$2,updated_at=now() WHERE host_user_id=$1`, [host, evidence])
  }
}

export function registerHousingReviews(app: FastifyInstance, pool: DatabasePool) {
  app.get('/v1/housing/:listingId/reviews', async request => {
    const user = actor(request), listing = Id.parse((request.params as { listingId: string }).listingId)
    const page = Page.parse(request.query), context = await listingContext(pool, listing, user)
    const order = { newest: 'r.created_at DESC', highest: 'r.rating DESC,r.created_at DESC', lowest: 'r.rating ASC,r.created_at DESC' }[page.sort]
    const [summary, propertySummary, items, own] = await Promise.all([
      hostReviewSummary(pool, context.host_user_id), hostReviewSummary(pool, context.host_user_id, context.property_id),
      pool.query(`SELECT r.*,p.name AS property_name FROM housing.reviews r JOIN housing.properties p ON p.id=r.property_id
        WHERE r.host_user_id=$1 AND r.status='published' ORDER BY (r.property_id=$2) DESC,${order},r.id
        LIMIT $3 OFFSET $4`, [context.host_user_id, context.property_id, page.limit, page.offset]),
      pool.query('SELECT r.*,p.name AS property_name FROM housing.reviews r JOIN housing.properties p ON p.id=r.property_id WHERE r.property_id=$1 AND r.author_user_id=$2', [context.property_id, user]),
    ])
    return { summary, property_summary: propertySummary, items: items.rows.map(r => visibleReview(r)),
      mine: own.rows[0] ? visibleReview(own.rows[0], true) : null, can_review: !context.manages && context.viewed,
      next_offset: page.offset+items.rows.length < summary.count ? page.offset+items.rows.length : null }
  })

  app.put('/v1/housing/:listingId/review', async request => {
    const user = actor(request), listing = Id.parse((request.params as { listingId: string }).listingId)
    const input = Rating.parse(request.body)
    validateReviewText(input.body)
    const context = await listingContext(pool, listing, user)
    if (context.manages || context.host_user_id===user) throw new ManagementError(403, 'Người quản lý không tự đánh giá nhà mình.')
    return transaction(pool, context.host_user_id, async db => {
      let met = context.viewed
      if (input.visit_slot) {
        const recorded = await db.query(
          `UPDATE housing.contact_requests SET visit_met_at=coalesce(visit_met_at,now())
           WHERE listing_id=$1 AND tenant_user_id=$2 AND viewing_status='confirmed'
             AND viewing_slot=$3::timestamptz AND viewing_slot<=now()
             AND status IN ('new','contacted','viewing') RETURNING id`, [listing, user, input.visit_slot],
        )
        if (!recorded.rowCount) throw new ManagementError(403, 'Chỉ ghi nhận đã gặp từ giờ hẹn được chủ nhà xác nhận trở đi.')
        met = true
      }
      if (!met) throw new ManagementError(403, 'Chỉ viết đánh giá sau khi bạn đã hẹn xem lịch và gặp chủ nhà.')
      const result = await db.query(
        `INSERT INTO housing.reviews(property_id,host_user_id,author_user_id,rating,body,stage,is_anonymous) VALUES($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT(property_id,author_user_id) DO UPDATE SET rating=$4,body=$5,is_anonymous=$7,
           stage=CASE WHEN housing.reviews.stage='viewed' THEN 'viewed' ELSE $6 END,
           status=CASE WHEN housing.reviews.hidden_reason IS NOT NULL THEN 'hidden' ELSE 'published' END,updated_at=now()
         RETURNING *`, [context.property_id, context.host_user_id, user, input.rating, input.body, 'viewed', input.is_anonymous],
      )
      // Ownership is snapshotted when first written, including subsequent edits.
      await refreshFlag(db, result.rows[0].host_user_id)
      return visibleReview({ ...result.rows[0], property_name: context.property_name }, true)
    })
  })

  app.delete('/v1/housing/:listingId/review', async request => {
    const user = actor(request), listing = Id.parse((request.params as { listingId: string }).listingId)
    const context = await listingContext(pool, listing, user)
    if (context.manages) throw new ManagementError(403, 'Chủ nhà không được rút đánh giá của người thuê.')
    return transaction(pool, context.host_user_id, async db => {
      const result = await db.query("UPDATE housing.reviews SET status='withdrawn',updated_at=now() WHERE property_id=$1 AND author_user_id=$2 RETURNING host_user_id", [context.property_id, user])
      if (result.rows[0]) await refreshFlag(db, result.rows[0].host_user_id)
      return { withdrawn: Boolean(result.rowCount) }
    })
  })

  app.get('/v1/landlord/reviews', async request => {
    const user = actor(request), page = Page.parse(request.query)
    const [summary, items] = await Promise.all([
      hostReviewSummary(pool, user),
      pool.query(`SELECT r.*,p.name AS property_name FROM housing.reviews r JOIN housing.properties p ON p.id=r.property_id
        JOIN housing.management_members mm ON mm.property_id=r.property_id AND mm.user_id=$1 AND mm.status='active'
        WHERE r.status='published' ORDER BY r.created_at DESC,r.id LIMIT $2 OFFSET $3`, [user, page.limit, page.offset]),
    ])
    return { summary, items: items.rows.map(r => visibleReview(r)), next_offset: items.rows.length===page.limit ? page.offset+page.limit : null }
  })

  app.post('/v1/landlord/reviews/:reviewId/reply', async request => {
    const user = actor(request), id = Id.parse((request.params as { reviewId: string }).reviewId), input = Body.parse(request.body)
    validateReviewText(input.body)
    const review = await reviewById(pool, id)
    await member(pool, user, review.property_id, true)
    const result = await pool.query("UPDATE housing.reviews SET reply_body=$2,reply_at=now() WHERE id=$1 AND status='published' RETURNING id,reply_body,reply_at", [id, input.body])
    if (!result.rowCount) throw new ManagementError(409, 'Đánh giá không còn hiển thị để trả lời.')
    return result.rows[0]
  })

  app.post('/v1/housing/reviews/:reviewId/report', async request => {
    const user = actor(request), id = Id.parse((request.params as { reviewId: string }).reviewId), input = Reason.parse(request.body)
    const review = await reviewById(pool, id)
    if (review.status!=='published') throw new ManagementError(404, 'Đánh giá không còn hiển thị.')
    if (review.author_user_id===user) throw new ManagementError(403, 'Bạn có thể sửa hoặc rút đánh giá của mình.')
    await pool.query(`INSERT INTO housing.review_reports(review_id,reporter_user_id,reason) VALUES($1,$2,$3)
      ON CONFLICT(review_id,reporter_user_id) DO UPDATE SET reason=$3,updated_at=now()`, [id, user, input.reason])
    return { reported: true }
  })

  app.get('/v1/moderation/housing/reviews', async request => {
    const user = actor(request)
    if (!moderator(user)) throw new ManagementError(403, 'Moderator permission is required.')
    const page = Page.parse(request.query)
    // Evidence may age out even without another write. Refresh the bounded open queue before showing it.
    const pendingFlags = await pool.query("SELECT host_user_id FROM housing.host_flags WHERE status='open' ORDER BY updated_at DESC LIMIT 100")
    for (let offset = 0; offset < pendingFlags.rows.length; offset += 4) {
      await Promise.all(pendingFlags.rows.slice(offset, offset+4).map(flag =>
        transaction(pool, flag.host_user_id, db => refreshFlag(db, flag.host_user_id))))
    }
    const [items, flags] = await Promise.all([
      pool.query(`SELECT r.*,p.name AS property_name,
        (SELECT count(*)::int FROM housing.review_reports rr WHERE rr.review_id=r.id AND rr.status='open') AS report_count,
        (SELECT jsonb_agg(jsonb_build_object('id',rr.id,'reason',rr.reason,'created_at',rr.created_at) ORDER BY rr.created_at)
          FROM housing.review_reports rr WHERE rr.review_id=r.id AND rr.status='open') AS reports
        FROM housing.reviews r JOIN housing.properties p ON p.id=r.property_id
        WHERE EXISTS(SELECT 1 FROM housing.review_reports rr WHERE rr.review_id=r.id AND rr.status='open')
          AND NOT EXISTS(SELECT 1 FROM housing.management_members mm WHERE mm.property_id=r.property_id AND mm.user_id=$1 AND mm.status<>'revoked')
          AND r.author_user_id<>$1 ORDER BY r.updated_at,r.id LIMIT $2 OFFSET $3`, [user, page.limit, page.offset]),
      pool.query(`SELECT f.*,hp.display_name AS host_name FROM housing.host_flags f JOIN housing.host_profiles hp ON hp.user_id=f.host_user_id
        WHERE f.status='open' AND f.host_user_id<>$1 AND NOT EXISTS(SELECT 1 FROM housing.reviews r JOIN housing.management_members mm ON mm.property_id=r.property_id
          WHERE r.host_user_id=f.host_user_id AND mm.user_id=$1 AND mm.status<>'revoked') ORDER BY f.updated_at DESC LIMIT 100`, [user]),
    ])
    return { items: items.rows.map(r => ({ ...visibleReview(r), status: r.status, report_count: r.report_count, reports: r.reports })), flags: flags.rows,
      next_offset: items.rows.length===page.limit ? page.offset+page.limit : null }
  })

  app.post('/v1/moderation/housing/reviews/:reviewId/decision', async request => {
    const user = actor(request), id = Id.parse((request.params as { reviewId: string }).reviewId)
    if (!moderator(user)) throw new ManagementError(403, 'Moderator permission is required.')
    const input = z.object({ decision: z.enum(['hide','keep']), reason: z.string().trim().max(500).default('') }).parse(request.body)
    if (input.decision==='hide' && !input.reason) throw new ManagementError(400, 'Nhập lý do ẩn đánh giá.')
    const review = await reviewById(pool, id)
    await notOwnProperty(pool, user, review.property_id)
    if (review.author_user_id===user) throw new ManagementError(403, 'Không tự kiểm duyệt đánh giá của mình.')
    return transaction(pool, review.host_user_id, async db => {
      const result = await db.query(`UPDATE housing.reviews SET
        status=CASE WHEN status='withdrawn' THEN status WHEN $2='hide' THEN 'hidden' ELSE 'published' END,
        hidden_reason=CASE WHEN $2='hide' THEN $3 ELSE NULL END,moderated_by=$4,moderated_at=now()
        WHERE id=$1 RETURNING id,status`, [id, input.decision, input.reason, user])
      await db.query("UPDATE housing.review_reports SET status=$2,decided_by=$3,decided_at=now() WHERE review_id=$1 AND status='open'", [id, input.decision==='hide' ? 'upheld' : 'dismissed', user])
      await refreshFlag(db, review.host_user_id)
      return result.rows[0]
    })
  })

  app.post('/v1/moderation/housing/flags/:flagId/review', async request => {
    const user = actor(request), id = Id.parse((request.params as { flagId: string }).flagId)
    if (!moderator(user)) throw new ManagementError(403, 'Moderator permission is required.')
    const flag = (await pool.query('SELECT * FROM housing.host_flags WHERE id=$1', [id])).rows[0]
    if (!flag) throw new ManagementError(404, 'Không tìm thấy cảnh báo.')
    const owned = await pool.query(`SELECT 1 FROM housing.reviews r JOIN housing.management_members mm ON mm.property_id=r.property_id
      WHERE r.host_user_id=$1 AND mm.user_id=$2 AND mm.status<>'revoked' LIMIT 1`, [flag.host_user_id, user])
    if (flag.host_user_id===user || owned.rowCount) throw new ManagementError(403, 'Không tự xử lý cảnh báo của mình.')
    await pool.query("UPDATE housing.host_flags SET status='reviewed',reviewed_by=$2,reviewed_at=now() WHERE id=$1", [id, user])
    return { reviewed: true }
  })
}
