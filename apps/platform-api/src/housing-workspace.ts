import type { FastifyInstance } from 'fastify'
import type { DatabasePool } from '@relohome/housing-query'
import { z } from 'zod'
import { actor, moderator, member, ManagementError } from './housing-management.js'
import { listingIssues, lockedListing, revisionOf } from './housing-policy.js'
import { searchHousingAddress, resolveHousingAddress } from './housing-location.js'
import { withTransaction } from './transaction.js'

const Id = z.string().uuid(),
  Revision = z.number().int().positive()
const Filter = z.object({
  status: z.enum(['draft', 'pending_review', 'published', 'rejected', 'hidden', 'deleted']).optional(),
  availability: z.enum(['vacant', 'rented', 'paused']).optional(),
  property_id: Id.optional(),
  search: z.string().trim().max(160).default(''),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().nonnegative().max(100000).default(0),
})

async function privateListing(pool: DatabasePool, id: string) {
  const result = await pool.query(
    `SELECT l.id,l.title,l.description,l.property_id,l.unit_id,l.deleted_at,
    ml.publication_status,ml.availability_status,ml.revision,ml.rejection_reason,ml.created_by,
    p.name AS property_name,p.property_type,p.location_metadata,p.location_confirmed_at,cp.address,
    ST_X(cp.geom)::float AS lng,ST_Y(cp.geom)::float AS lat,u.unit_code,u.area_m2::float,u.bedrooms,u.bathrooms,u.amenities,
    o.price_amount::float AS rent_vnd,o.deposit_amount::float AS deposit_vnd,o.availability_from,
    hp.display_name AS host_name,hp.legal_name,hp.phone,hp.poster_type,hp.status AS host_status,
    (SELECT status FROM housing.management_members WHERE property_id=l.property_id AND user_id=ml.created_by) AS property_status
    FROM housing.listings l JOIN housing.managed_listings ml ON ml.listing_id=l.id
    JOIN housing.properties p ON p.id=l.property_id JOIN catalog.places cp ON cp.id=p.place_id
    LEFT JOIN housing.units u ON u.id=l.unit_id LEFT JOIN housing.host_profiles hp ON hp.user_id=ml.created_by
    LEFT JOIN housing.current_offers o ON o.listing_id=l.id WHERE l.id=$1`,
    [id],
  )
  if (!result.rows[0]) throw new ManagementError(404, 'Không tìm thấy tin nhà.')
  const [media, fees, reviews, issues] = await Promise.all([
    pool.query(
      `SELECT id,url,alt_text,position,is_primary,moderation_status FROM housing.listing_media WHERE listing_id=$1 AND deleted_at IS NULL ORDER BY position,id`,
      [id],
    ),
    pool.query(
      `SELECT code,label,amount::float,billing_unit,required,refundable FROM housing.listing_fees WHERE listing_id=$1 AND valid_to IS NULL ORDER BY code`,
      [id],
    ),
    pool.query(
      `SELECT actor_id,decision,reason,reviewed_revision,created_at FROM housing.listing_reviews WHERE listing_id=$1 ORDER BY created_at DESC`,
      [id],
    ),
    listingIssues(pool, id),
  ])
  return {
    ...result.rows[0],
    media: media.rows,
    fees: fees.rows,
    review_history: reviews.rows,
    issues,
  }
}

async function listingPage(pool: DatabasePool, user: string, input: z.infer<typeof Filter>, admin: boolean) {
  const values: unknown[] = [],
    conditions: string[] = []
  const param = (value: unknown) => {
    values.push(value)
    return '$' + values.length
  }
  if (!admin)
    conditions.push(
      `EXISTS(SELECT 1 FROM housing.management_members mm WHERE mm.property_id=l.property_id AND mm.user_id=${param(user)} AND mm.status<>'revoked')`,
    )
  if (input.status) conditions.push(`ml.publication_status=${param(input.status)}`)
  else conditions.push("ml.publication_status<>'deleted'")
  if (input.availability) conditions.push(`ml.availability_status=${param(input.availability)}`)
  if (input.property_id) conditions.push(`l.property_id=${param(input.property_id)}`)
  if (input.search) {
    const text = param('%' + input.search + '%')
    conditions.push(`(l.title ILIKE ${text} OR p.name ILIKE ${text} OR u.unit_code ILIKE ${text})`)
  }
  const from = `FROM housing.managed_listings ml JOIN housing.listings l ON l.id=ml.listing_id
    JOIN housing.properties p ON p.id=l.property_id JOIN catalog.places cp ON cp.id=p.place_id
    LEFT JOIN housing.units u ON u.id=l.unit_id LEFT JOIN housing.current_offers o ON o.listing_id=l.id
    LEFT JOIN housing.host_profiles hp ON hp.user_id=ml.created_by WHERE ${conditions.join(' AND ')}`
  const total = await pool.query(`SELECT count(*)::int AS total ${from}`, values)
  const items = await pool.query(
    `SELECT l.id,l.title,l.property_id,l.unit_id,p.name AS property_name,u.unit_code,u.area_m2::float,
    cp.address,ml.publication_status,ml.availability_status,ml.revision,ml.rejection_reason,ml.updated_at,
    o.price_amount::float AS rent_vnd,hp.display_name AS host_name,hp.status AS host_status,
    (SELECT url FROM housing.listing_media WHERE listing_id=l.id AND deleted_at IS NULL ORDER BY is_primary DESC,position,id LIMIT 1) AS thumbnail_url
    ${from} ORDER BY ml.updated_at DESC,l.id LIMIT ${param(input.limit)} OFFSET ${param(input.offset)}`,
    values,
  )
  return {
    items: items.rows,
    total: total.rows[0].total,
    limit: input.limit,
    offset: input.offset,
  }
}

export function registerHousingWorkspace(app: FastifyInstance, pool: DatabasePool) {
  app.get('/v1/admin/session', async (request) => {
    const user = actor(request)
    if (!moderator(user)) throw new ManagementError(403, 'Tài khoản này không có quyền Admin.')
    return { can_moderate_housing: true }
  })
  app.get('/v1/landlord/locations/search', async request => {
    const user = actor(request),
      input = z.object({ text: z.string() }).parse(request.query)
    return searchHousingAddress(user, input.text)
  })
  app.post('/v1/landlord/locations/resolve', async request => {
    const user = actor(request),
      input = z.object({ ref_id: z.string() }).parse(request.body)
    return resolveHousingAddress(user, input.ref_id)
  })
  app.get('/v1/landlord/listings', async (request) =>
    listingPage(pool, actor(request), Filter.parse(request.query), false),
  )
  app.get('/v1/moderation/housing/listings', async request => {
    const user = actor(request)
    if (!moderator(user)) throw new ManagementError(403, 'Tài khoản này không có quyền Admin.')
    return listingPage(pool, user, Filter.parse(request.query), true)
  })
  app.get('/v1/moderation/housing/listings/:listingId', async request => {
    const user = actor(request)
    if (!moderator(user)) throw new ManagementError(403, 'Tài khoản này không có quyền Admin.')
    return privateListing(pool, Id.parse((request.params as { listingId: string }).listingId))
  })
  app.get('/v1/landlord/listings/:listingId/preview', async request => {
    const user = actor(request),
      id = Id.parse((request.params as { listingId: string }).listingId)
    const property = await pool.query('SELECT property_id FROM housing.listings WHERE id=$1', [id])
    if (!property.rows[0]) throw new ManagementError(404, 'Không tìm thấy tin nhà.')
    await member(pool, user, String(property.rows[0].property_id))
    const result = await privateListing(pool, id)
    const { legal_name, phone, review_history, ...ownerPreview } = result
    return ownerPreview
  })

  app.get('/v1/landlord/stats', async request => {
    const user = actor(request)
    const input = z
      .object({
        days: z.coerce
          .number()
          .refine(v => v === 7 || v === 30)
          .default(30),
        property_id: Id.optional(),
        listing_id: Id.optional(),
      })
      .parse(request.query)
    if (input.property_id) await member(pool, user, input.property_id)
    const owned = `SELECT l.id,l.unit_id,ml.publication_status,ml.availability_status FROM housing.listings l
      JOIN housing.managed_listings ml ON ml.listing_id=l.id WHERE l.deleted_at IS NULL AND $2::int IN(7,30)
      AND EXISTS(SELECT 1 FROM housing.management_members mm WHERE mm.property_id=l.property_id AND mm.user_id=$1 AND mm.status<>'revoked')
      AND ($3::uuid IS NULL OR l.property_id=$3) AND ($4::uuid IS NULL OR l.id=$4)`
    const values = [user, input.days, input.property_id ?? null, input.listing_id ?? null]
    const inventory = await pool.query(
      `WITH owned AS (${owned}) SELECT
      (SELECT count(*)::int FROM housing.management_members mm JOIN housing.properties p ON p.id=mm.property_id
        WHERE mm.user_id=$1 AND mm.status<>'revoked' AND p.deleted_at IS NULL AND ($3::uuid IS NULL OR p.id=$3)) AS properties,
      (SELECT count(*)::int FROM housing.units u WHERE u.deleted_at IS NULL AND ($3::uuid IS NULL OR u.property_id=$3)
        AND EXISTS(SELECT 1 FROM housing.management_members mm WHERE mm.property_id=u.property_id AND mm.user_id=$1 AND mm.status<>'revoked')) AS units,
      count(*)::int AS listings,count(*) FILTER(WHERE publication_status='published')::int AS published,
      count(*) FILTER(WHERE publication_status='pending_review')::int AS pending_review,
      count(*) FILTER(WHERE publication_status='rejected')::int AS rejected,count(*) FILTER(WHERE publication_status='draft')::int AS draft,
      count(*) FILTER(WHERE publication_status='hidden')::int AS hidden,
      count(DISTINCT unit_id) FILTER(WHERE availability_status='vacant')::int AS vacant,
      count(DISTINCT unit_id) FILTER(WHERE availability_status='rented')::int AS rented,
      count(DISTINCT unit_id) FILTER(WHERE availability_status='paused')::int AS paused
      FROM owned`,
      values,
    )
    const daily = await pool.query(
      `WITH owned AS (${owned}) SELECT
      (le.occurred_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::text AS day,
      count(*) FILTER(WHERE event_type='detail_view')::int AS detail_views,
      count(*) FILTER(WHERE event_type='save')::int AS saves,
      count(*) FILTER(WHERE event_type='contact_request')::int AS contacts
      FROM housing.listing_events le JOIN owned ON owned.id=le.listing_id
      WHERE le.occurred_at >= (date_trunc('day',now() AT TIME ZONE 'Asia/Ho_Chi_Minh')-($2::int-1)*interval '1 day') AT TIME ZONE 'Asia/Ho_Chi_Minh'
      GROUP BY day ORDER BY day`,
      values,
    )
    const measured = await pool.query(
      `WITH owned AS (${owned}) SELECT min(occurred_at) AS measured_since FROM housing.listing_events e JOIN owned ON owned.id=e.listing_id`,
      values,
    )
    const contacts = await pool.query(
      `WITH owned AS (${owned}) SELECT count(*) FILTER(WHERE cr.status='new')::int AS new_contacts,
      count(*) FILTER(WHERE cr.viewing_status='requested')::int AS pending_viewings
      FROM housing.contact_requests cr JOIN owned ON owned.id=cr.listing_id`,
      values,
    )
    return {
      days: input.days,
      timezone: 'Asia/Ho_Chi_Minh',
      inventory: inventory.rows[0],
      contacts: contacts.rows[0],
      daily: daily.rows,
      measured_since: measured.rows[0].measured_since,
      definitions: {
        detail_views: 'Một lượt theo phiên và tin.',
        saves: 'Lượt lưu được ghi nhận theo tài khoản và tin; không phải số người hiện còn lưu.',
        contacts: 'Yêu cầu liên hệ hoặc lịch xem mới được ghi nhận.',
      },
    }
  })

  app.patch('/v1/landlord/listings/:listingId/media', async request => {
    const user = actor(request),
      id = Id.parse((request.params as { listingId: string }).listingId)
    const input = z
      .object({
        revision: Revision,
        order: z.array(Id).max(30),
        cover_id: Id.optional(),
      })
      .parse(request.body)
    return withTransaction(pool, async client => {
      await lockedListing(client, user, id, input.revision)
      const media = await client.query(
        'SELECT id FROM housing.listing_media WHERE listing_id=$1 AND deleted_at IS NULL ORDER BY id',
        [id],
      )
      const ids = media.rows.map(r => String(r.id))
      if (
        ids.length !== input.order.length ||
        new Set(input.order).size !== ids.length ||
        input.order.some(v => !ids.includes(v)) ||
        (input.cover_id && !ids.includes(input.cover_id))
      )
        throw new ManagementError(409, 'Bộ ảnh đã thay đổi. Hãy tải lại.')
      for (const [position, mediaId] of input.order.entries())
        await client.query(
          'UPDATE housing.listing_media SET position=$3,is_primary=(id=$4::uuid) WHERE listing_id=$1 AND id=$2',
          [id, mediaId, position, input.cover_id ?? input.order[0] ?? null],
        )
      const result = await revisionOf(client, id)
      return result
    })
  })
  app.delete('/v1/landlord/listings/:listingId/media/:mediaId', async request => {
    const user = actor(request),
      params = z.object({ listingId: Id, mediaId: Id }).parse(request.params)
    const input = z.object({ revision: Revision }).parse(request.body)
    return withTransaction(pool, async client => {
      await lockedListing(client, user, params.listingId, input.revision)
      const removed = await client.query(
        `UPDATE housing.listing_media SET deleted_at=now(),is_primary=false
        WHERE listing_id=$1 AND id=$2 AND deleted_at IS NULL RETURNING id`,
        [params.listingId, params.mediaId],
      )
      if (!removed.rowCount) throw new ManagementError(404, 'Không tìm thấy ảnh.')
      await client.query(
        `UPDATE housing.listing_media SET is_primary=true WHERE id=(SELECT id FROM housing.listing_media
        WHERE listing_id=$1 AND deleted_at IS NULL ORDER BY is_primary DESC,position,id LIMIT 1)`,
        [params.listingId],
      )
      const result = await revisionOf(client, params.listingId)
      return result
    })
  })
  app.get('/v1/housing-media/:filename/access', async request => {
    const user = actor(request),
      filename = z
        .string()
        .regex(/^[a-f0-9]{40}\.png$/)
        .parse((request.params as { filename: string }).filename)
    const result = await pool.query(
      `SELECT m.moderation_status,l.property_id,
      (m.moderation_status='approved' AND l.status='active' AND l.deleted_at IS NULL AND v.is_public) AS public
      FROM housing.listing_media m JOIN housing.listings l ON l.id=m.listing_id
      LEFT JOIN housing.managed_listing_visibility v ON v.listing_id=l.id
      WHERE m.storage_key=$1 AND m.deleted_at IS NULL`,
      [filename],
    )
    const row = result.rows[0]
    if (!row) throw new ManagementError(404, 'Không tìm thấy ảnh.')
    if (!row.public && !moderator(user)) await member(pool, user, String(row.property_id))
    return { public: Boolean(row.public) }
  })
}
