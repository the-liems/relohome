import { randomUUID, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { DatabasePool } from '@lifeflow/housing-query'
import { z } from 'zod'

const Id = z.string().uuid()
const Revision = z.number().int().positive()
const Address = z.record(z.string(), z.unknown())
const PropertyInput = z.object({
  name: z.string().trim().min(2).max(160),
  property_type: z.enum(['apartment', 'house', 'room', 'studio', 'serviced_apartment', 'homestay', 'other']),
  address: Address,
  location: z.object({ lng: z.number().min(102).max(110), lat: z.number().min(8).max(24) }),
})
const UnitInput = z.object({
  unit_code: z.string().trim().min(1).max(80),
  bedrooms: z.number().nonnegative().max(100).nullable().default(null),
  bathrooms: z.number().nonnegative().max(100).nullable().default(null),
  area_m2: z.number().positive().max(100_000).nullable().default(null),
  amenities: z.array(z.string().trim().min(1).max(80)).max(100).default([]),
})
const FeeInput = z.object({
  code: z.string().trim().regex(/^[a-z0-9_]{1,40}$/),
  label: z.string().trim().min(1).max(100),
  amount: z.number().nonnegative().nullable(),
  billing_unit: z.enum(['month', 'one_time', 'kwh', 'm3', 'person_month', 'vehicle_month']),
  required: z.boolean().default(true),
  refundable: z.boolean().default(false),
})
const ListingInput = z.object({
  title: z.string().trim().min(5).max(240),
  description: z.string().trim().max(5_000).default(''),
  rent_vnd: z.number().int().positive().max(10_000_000_000),
  deposit_vnd: z.number().int().nonnegative().max(10_000_000_000).nullable().default(null),
  availability_from: z.iso.date().nullable().default(null),
  fees: z.array(FeeInput).max(30).default([]),
})
const ListingUpdate = ListingInput.partial().extend({ revision: Revision })
const PropertyUpdate = PropertyInput.partial().extend({ revision: Revision })
const UnitUpdate = UnitInput.partial()
const MediaInput = z.object({ url: z.url().max(2_000), alt: z.string().trim().max(300).nullable().default(null) })
const ContactInput = z.object({ message: z.string().trim().min(1).max(1_000) })
const ContactUpdate = z.object({
  status: z.enum(['contacted', 'viewing', 'resolved', 'declined']),
  revision: Revision,
})
const EventInput = z.object({
  event_type: z.enum(['impression', 'detail_view', 'save']),
  dedup_key: z.string().trim().min(8).max(160),
})

export class ManagementError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

function equalSecret(actual: string, expected: string) {
  const left = Buffer.from(actual)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

function actor(request: FastifyRequest) {
  const expected = process.env.AGENT_API_TOKEN || ''
  const authorization = String(request.headers.authorization || '')
  const user = String(request.headers['x-user-id'] || '').trim()
  if (!expected) throw new ManagementError(503, 'Housing management is not configured.')
  if (!equalSecret(authorization, `Bearer ${expected}`) || !user || user.length > 128) {
    throw new ManagementError(401, 'A trusted gateway identity is required.')
  }
  return user
}

function moderator(user: string) {
  return new Set((process.env.HOUSING_MODERATOR_IDS || '').split(',').map(v => v.trim()).filter(Boolean)).has(user)
}

async function member(pool: DatabasePool, user: string, property: string, active = false) {
  const result = await pool.query(
    `SELECT role,status FROM housing.management_members WHERE property_id=$1 AND user_id=$2`,
    [property, user],
  )
  const row = result.rows[0]
  if (!row || row.status === 'revoked' || (active && row.status !== 'active')) {
    throw new ManagementError(403, active ? 'Quyền quản lý chưa được duyệt.' : 'Bạn không quản lý địa điểm này.')
  }
  return row
}

async function listingProperty(pool: DatabasePool, listing: string) {
  const result = await pool.query('SELECT property_id FROM housing.listings WHERE id=$1', [listing])
  if (!result.rows[0]) throw new ManagementError(404, 'Không tìm thấy tin nhà.')
  return String(result.rows[0].property_id)
}

async function replaceFees(client: { query: DatabasePool['query'] }, listing: string, fees: z.infer<typeof FeeInput>[]) {
  await client.query('UPDATE housing.listing_fees SET valid_to=now() WHERE listing_id=$1 AND valid_to IS NULL', [listing])
  for (const fee of fees) {
    await client.query(
      `INSERT INTO housing.listing_fees(listing_id,code,label,amount,billing_unit,required,refundable)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [listing, fee.code, fee.label, fee.amount, fee.billing_unit, fee.required, fee.refundable],
    )
  }
}

export function registerHousingManagement(app: FastifyInstance, pool: DatabasePool) {
  app.get('/v1/landlord/overview', async request => {
    const user = actor(request)
    const result = await pool.query(
      `SELECT
        count(DISTINCT mm.property_id)::int AS properties,
        count(DISTINCT u.id)::int AS units,
        count(DISTINCT ml.listing_id) FILTER (WHERE ml.availability_status='vacant')::int AS vacant,
        count(DISTINCT cr.id) FILTER (WHERE cr.status='new')::int AS new_contacts,
        min(le.occurred_at) AS measured_since,
        count(DISTINCT le.id) FILTER (WHERE le.event_type='detail_view')::int AS detail_views,
        count(DISTINCT le.id) FILTER (WHERE le.event_type='save')::int AS saves,
        count(DISTINCT le.id) FILTER (WHERE le.event_type='contact_request')::int AS contact_requests
       FROM housing.management_members mm
       LEFT JOIN housing.units u ON u.property_id=mm.property_id AND u.deleted_at IS NULL
       LEFT JOIN housing.listings l ON l.property_id=mm.property_id AND l.deleted_at IS NULL
       LEFT JOIN housing.managed_listings ml ON ml.listing_id=l.id
       LEFT JOIN housing.contact_requests cr ON cr.listing_id=l.id
       LEFT JOIN housing.listing_events le ON le.listing_id=l.id
       WHERE mm.user_id=$1 AND mm.status <> 'revoked'`, [user],
    )
    return result.rows[0]
  })

  app.get('/v1/landlord/properties', async request => {
    const user = actor(request)
    const result = await pool.query(
      `SELECT p.id,p.name,p.property_type,cp.address,ST_X(cp.geom)::float AS lng,ST_Y(cp.geom)::float AS lat,
        mm.role,mm.status,mm.revision,
        count(DISTINCT u.id)::int AS unit_count,
        count(DISTINCT ml.listing_id) FILTER (WHERE ml.availability_status='vacant')::int AS vacant_count
       FROM housing.management_members mm JOIN housing.properties p ON p.id=mm.property_id
       JOIN catalog.places cp ON cp.id=p.place_id
       LEFT JOIN housing.units u ON u.property_id=p.id AND u.deleted_at IS NULL
       LEFT JOIN housing.listings l ON l.unit_id=u.id AND l.deleted_at IS NULL
       LEFT JOIN housing.managed_listings ml ON ml.listing_id=l.id
       WHERE mm.user_id=$1 AND mm.status <> 'revoked' AND p.deleted_at IS NULL
       GROUP BY p.id,cp.id,mm.role,mm.status,mm.revision ORDER BY p.created_at DESC`, [user],
    )
    return { items: result.rows }
  })

  app.post('/v1/landlord/properties', async (request, reply) => {
    const user = actor(request)
    const input = PropertyInput.parse(request.body)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const place = await client.query(
        `INSERT INTO catalog.places(category_id,name,geom,address,attributes)
         VALUES((SELECT id FROM catalog.place_categories WHERE slug='housing-self-service'),$1,
         ST_SetSRID(ST_MakePoint($2,$3),4326),$4,'{"source":"self_service"}'::jsonb) RETURNING id`,
        [input.name, input.location.lng, input.location.lat, input.address],
      )
      const property = await client.query(
        `INSERT INTO housing.properties(place_id,property_type,name,attributes)
         VALUES($1,$2,$3,'{"source":"self_service"}'::jsonb) RETURNING id`,
        [place.rows[0].id, input.property_type, input.name],
      )
      await client.query(
        `INSERT INTO housing.management_members(property_id,user_id,role,status) VALUES($1,$2,'owner','pending')`,
        [property.rows[0].id, user],
      )
      await client.query('COMMIT')
      return reply.status(201).send({ id: property.rows[0].id, management_status: 'pending' })
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  })

  app.get('/v1/landlord/properties/:propertyId', async request => {
    const user = actor(request)
    const propertyId = Id.parse((request.params as { propertyId: string }).propertyId)
    await member(pool, user, propertyId)
    const property = await pool.query(
      `SELECT p.id,p.name,p.property_type,cp.address,ST_X(cp.geom)::float AS lng,ST_Y(cp.geom)::float AS lat,
        mm.status AS management_status,mm.role
       FROM housing.properties p JOIN catalog.places cp ON cp.id=p.place_id
       JOIN housing.management_members mm ON mm.property_id=p.id AND mm.user_id=$2 WHERE p.id=$1`,
      [propertyId, user],
    )
    const units = await pool.query(
      `SELECT u.id,u.unit_code,u.bedrooms,u.bathrooms,u.area_m2,u.amenities,
        l.id AS listing_id,l.title,ml.publication_status,ml.availability_status,ml.revision
       FROM housing.units u LEFT JOIN housing.listings l ON l.unit_id=u.id AND l.deleted_at IS NULL
       LEFT JOIN housing.managed_listings ml ON ml.listing_id=l.id
       WHERE u.property_id=$1 AND u.deleted_at IS NULL ORDER BY u.unit_code`, [propertyId],
    )
    return { ...property.rows[0], units: units.rows }
  })

  app.patch('/v1/landlord/properties/:propertyId', async request => {
    const user = actor(request)
    const propertyId = Id.parse((request.params as { propertyId: string }).propertyId)
    const input = PropertyUpdate.parse(request.body)
    await member(pool, user, propertyId)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const membership = await client.query(
        `UPDATE housing.management_members SET revision=revision+1
         WHERE property_id=$1 AND user_id=$2 AND revision=$3 AND status <> 'revoked' RETURNING revision`,
        [propertyId, user, input.revision],
      )
      if (!membership.rowCount) throw new ManagementError(409, 'Thông tin nhà đã được cập nhật ở nơi khác.')
      if (input.name !== undefined || input.property_type !== undefined) {
        await client.query(
          `UPDATE housing.properties SET name=COALESCE($2,name),property_type=COALESCE($3,property_type),updated_at=now()
           WHERE id=$1`, [propertyId, input.name ?? null, input.property_type ?? null],
        )
      }
      if (input.name !== undefined || input.address !== undefined || input.location !== undefined) {
        await client.query(
          `UPDATE catalog.places cp SET name=COALESCE($2,cp.name),address=COALESCE($3,cp.address),
             geom=CASE WHEN $4::double precision IS NULL OR $5::double precision IS NULL THEN cp.geom
                       ELSE ST_SetSRID(ST_MakePoint($4,$5),4326) END,updated_at=now()
           FROM housing.properties p WHERE p.id=$1 AND p.place_id=cp.id`,
          [propertyId, input.name ?? null, input.address ?? null, input.location?.lng ?? null, input.location?.lat ?? null],
        )
      }
      await client.query('COMMIT')
      return { id: propertyId, revision: membership.rows[0].revision }
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  })

  app.post('/v1/landlord/properties/:propertyId/units', async (request, reply) => {
    const user = actor(request)
    const propertyId = Id.parse((request.params as { propertyId: string }).propertyId)
    await member(pool, user, propertyId)
    const input = UnitInput.parse(request.body)
    const result = await pool.query(
      `INSERT INTO housing.units(property_id,unit_code,bedrooms,bathrooms,area_m2,amenities,attributes)
       VALUES($1,$2,$3,$4,$5,$6,'{"source":"self_service"}'::jsonb) RETURNING *`,
      [propertyId, input.unit_code, input.bedrooms, input.bathrooms, input.area_m2, input.amenities],
    )
    return reply.status(201).send(result.rows[0])
  })

  app.patch('/v1/landlord/units/:unitId', async request => {
    const user = actor(request)
    const unitId = Id.parse((request.params as { unitId: string }).unitId)
    const input = UnitUpdate.parse(request.body)
    const owner = await pool.query('SELECT property_id FROM housing.units WHERE id=$1 AND deleted_at IS NULL', [unitId])
    if (!owner.rows[0]) throw new ManagementError(404, 'Không tìm thấy phòng.')
    await member(pool, user, String(owner.rows[0].property_id))
    const result = await pool.query(
      `UPDATE housing.units SET unit_code=COALESCE($2,unit_code),bedrooms=CASE WHEN $3 THEN $4 ELSE bedrooms END,
       bathrooms=CASE WHEN $5 THEN $6 ELSE bathrooms END,area_m2=CASE WHEN $7 THEN $8 ELSE area_m2 END,
       amenities=COALESCE($9,amenities),updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING *`,
      [unitId, input.unit_code ?? null,
        input.bedrooms !== undefined, input.bedrooms ?? null,
        input.bathrooms !== undefined, input.bathrooms ?? null,
        input.area_m2 !== undefined, input.area_m2 ?? null,
        input.amenities ?? null],
    )
    return result.rows[0]
  })

  app.post('/v1/landlord/units/:unitId/listing', async (request, reply) => {
    const user = actor(request)
    const unitId = Id.parse((request.params as { unitId: string }).unitId)
    const owner = await pool.query('SELECT property_id FROM housing.units WHERE id=$1 AND deleted_at IS NULL', [unitId])
    if (!owner.rows[0]) throw new ManagementError(404, 'Không tìm thấy phòng.')
    await member(pool, user, String(owner.rows[0].property_id))
    const input = ListingInput.parse(request.body)
    const client = await pool.connect()
    const listingId = randomUUID()
    try {
      await client.query('BEGIN')
      await client.query(
        `INSERT INTO housing.listings(id,property_id,unit_id,listing_type,title,description,source_type,source_listing_id,status,attributes)
         VALUES($1,$2,$3,'rent',$4,$5,'self_service',$6,'inactive','{"self_service":true}'::jsonb)`,
        [listingId, owner.rows[0].property_id, unitId, input.title, input.description, `self:${listingId}`],
      )
      await client.query(
        `INSERT INTO housing.offers(listing_id,price_amount,currency,price_period,deposit_amount,availability_from,is_active)
         VALUES($1,$2,'VND','month',$3,$4,true)`,
        [listingId, input.rent_vnd, input.deposit_vnd, input.availability_from],
      )
      await client.query('INSERT INTO housing.managed_listings(listing_id,created_by) VALUES($1,$2)', [listingId, user])
      await replaceFees(client, listingId, input.fees)
      await client.query('COMMIT')
      return reply.status(201).send({ id: listingId, publication_status: 'draft', revision: 1 })
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  })

  app.patch('/v1/landlord/listings/:listingId', async (request) => {
    const user = actor(request)
    const listingId = Id.parse((request.params as { listingId: string }).listingId)
    const propertyId = await listingProperty(pool, listingId)
    await member(pool, user, propertyId)
    const input = ListingUpdate.parse(request.body)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const locked = await client.query(
        `UPDATE housing.managed_listings SET revision=revision+1,updated_at=now()
         WHERE listing_id=$1 AND revision=$2 AND publication_status IN ('draft','rejected','hidden') RETURNING revision`,
        [listingId, input.revision],
      )
      if (!locked.rowCount) throw new ManagementError(409, 'Tin đã thay đổi hoặc không còn ở trạng thái có thể sửa.')
      if (input.title !== undefined || input.description !== undefined) {
        await client.query(
          `UPDATE housing.listings SET title=COALESCE($2,title),description=COALESCE($3,description),updated_at=now() WHERE id=$1`,
          [listingId, input.title ?? null, input.description ?? null],
        )
      }
      if (input.rent_vnd !== undefined || input.deposit_vnd !== undefined || input.availability_from !== undefined) {
        await client.query(
          `UPDATE housing.offers SET is_active=false,valid_to=now() WHERE listing_id=$1 AND is_active`, [listingId],
        )
        await client.query(
          `INSERT INTO housing.offers(listing_id,price_amount,currency,price_period,deposit_amount,availability_from,is_active)
           SELECT $1,CASE WHEN $2 THEN $3 ELSE price_amount END,'VND','month',
             CASE WHEN $4 THEN $5 ELSE deposit_amount END,CASE WHEN $6 THEN $7 ELSE availability_from END,true
           FROM housing.offers WHERE listing_id=$1 ORDER BY valid_from DESC LIMIT 1`,
          [listingId,
            input.rent_vnd !== undefined, input.rent_vnd ?? null,
            input.deposit_vnd !== undefined, input.deposit_vnd ?? null,
            input.availability_from !== undefined, input.availability_from ?? null],
        )
      }
      if (input.fees) await replaceFees(client, listingId, input.fees)
      await client.query('COMMIT')
      return { id: listingId, revision: locked.rows[0].revision }
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  })

  app.get('/v1/landlord/listings/:listingId', async request => {
    const user = actor(request)
    const listingId = Id.parse((request.params as { listingId: string }).listingId)
    await member(pool, user, await listingProperty(pool, listingId))
    const listing = await pool.query(
      `SELECT l.id,l.property_id,l.unit_id,l.title,l.description,l.status,o.price_amount::float AS rent_vnd,
       o.deposit_amount::float AS deposit_vnd,o.availability_from,ml.publication_status,ml.availability_status,
       ml.rejection_reason,ml.revision,ml.updated_at
       FROM housing.listings l JOIN housing.managed_listings ml ON ml.listing_id=l.id
       LEFT JOIN LATERAL (SELECT * FROM housing.offers WHERE listing_id=l.id AND is_active ORDER BY valid_from DESC LIMIT 1) o ON true
       WHERE l.id=$1 AND l.deleted_at IS NULL`, [listingId],
    )
    if (!listing.rows[0]) throw new ManagementError(404, 'Không tìm thấy tin nhà.')
    const [fees, media] = await Promise.all([
      pool.query(`SELECT id,code,label,amount::float,billing_unit,required,refundable FROM housing.listing_fees
        WHERE listing_id=$1 AND valid_to IS NULL ORDER BY required DESC,label`, [listingId]),
      pool.query(`SELECT id,url,alt_text,position,is_primary,moderation_status FROM housing.listing_media
        WHERE listing_id=$1 ORDER BY position,id`, [listingId]),
    ])
    return { ...listing.rows[0], fees: fees.rows, media: media.rows }
  })

  app.post('/v1/landlord/listings/:listingId/hide', async request => {
    const user = actor(request)
    const listingId = Id.parse((request.params as { listingId: string }).listingId)
    await member(pool, user, await listingProperty(pool, listingId), true)
    const input = z.object({ revision: Revision }).parse(request.body)
    const result = await pool.query(
      `UPDATE housing.managed_listings SET publication_status='hidden',revision=revision+1,updated_at=now()
       WHERE listing_id=$1 AND revision=$2 AND publication_status IN ('published','pending_review') RETURNING revision`,
      [listingId, input.revision],
    )
    if (!result.rowCount) throw new ManagementError(409, 'Tin đã thay đổi hoặc không còn có thể ẩn.')
    await pool.query(`UPDATE housing.listings SET status='inactive',updated_at=now() WHERE id=$1`, [listingId])
    return { id: listingId, publication_status: 'hidden', revision: result.rows[0].revision }
  })

  app.delete('/v1/landlord/listings/:listingId', async request => {
    const user = actor(request)
    const listingId = Id.parse((request.params as { listingId: string }).listingId)
    await member(pool, user, await listingProperty(pool, listingId), true)
    const input = z.object({ revision: Revision }).parse(request.body)
    const result = await pool.query(
      `UPDATE housing.managed_listings SET publication_status='deleted',revision=revision+1,updated_at=now()
       WHERE listing_id=$1 AND revision=$2 AND publication_status <> 'deleted' RETURNING revision`,
      [listingId, input.revision],
    )
    if (!result.rowCount) throw new ManagementError(409, 'Tin đã thay đổi hoặc đã được xóa.')
    await pool.query(`UPDATE housing.listings SET status='inactive',deleted_at=now(),updated_at=now() WHERE id=$1`, [listingId])
    return { id: listingId, publication_status: 'deleted', revision: result.rows[0].revision }
  })

  app.post('/v1/landlord/listings/:listingId/media', async (request, reply) => {
    const user = actor(request)
    const listingId = Id.parse((request.params as { listingId: string }).listingId)
    await member(pool, user, await listingProperty(pool, listingId))
    const input = MediaInput.parse(request.body)
    const result = await pool.query(
      `INSERT INTO housing.listing_media(listing_id,url,alt_text,source_type,position,moderation_status,uploaded_by)
       VALUES($1,$2,$3,'self_service',COALESCE((SELECT max(position)+1 FROM housing.listing_media WHERE listing_id=$1),0),'pending',$4)
       RETURNING id,url,alt_text,moderation_status`, [listingId, input.url, input.alt, user],
    )
    return reply.status(201).send(result.rows[0])
  })

  app.post('/v1/landlord/listings/:listingId/submit', async request => {
    const user = actor(request)
    const listingId = Id.parse((request.params as { listingId: string }).listingId)
    await member(pool, user, await listingProperty(pool, listingId), true)
    const result = await pool.query(
      `UPDATE housing.managed_listings SET publication_status='pending_review',revision=revision+1,updated_at=now()
       WHERE listing_id=$1 AND publication_status IN ('draft','rejected','hidden') RETURNING revision`, [listingId],
    )
    if (!result.rowCount) throw new ManagementError(409, 'Tin không thể gửi duyệt ở trạng thái hiện tại.')
    return { id: listingId, publication_status: 'pending_review', revision: result.rows[0].revision }
  })

  app.post('/v1/landlord/listings/:listingId/availability', async request => {
    const user = actor(request)
    const listingId = Id.parse((request.params as { listingId: string }).listingId)
    await member(pool, user, await listingProperty(pool, listingId), true)
    const input = z.object({ status: z.enum(['vacant', 'rented', 'paused']), revision: Revision }).parse(request.body)
    const result = await pool.query(
      `UPDATE housing.managed_listings SET availability_status=$2,availability_confirmed_at=now(),revision=revision+1,updated_at=now()
       WHERE listing_id=$1 AND revision=$3 RETURNING publication_status,revision`,
      [listingId, input.status, input.revision],
    )
    if (!result.rowCount) throw new ManagementError(409, 'Tin đã được cập nhật ở nơi khác.')
    await pool.query(
      `UPDATE housing.listings SET status=CASE WHEN $2='vacant' AND $3='published' THEN 'active' ELSE 'inactive' END,updated_at=now()
       WHERE id=$1`, [listingId, input.status, result.rows[0].publication_status],
    )
    return { id: listingId, availability_status: input.status, revision: result.rows[0].revision }
  })

  app.post('/v1/moderation/housing/properties/:propertyId/approve', async request => {
    const user = actor(request)
    if (!moderator(user)) throw new ManagementError(403, 'Moderator permission is required.')
    const propertyId = Id.parse((request.params as { propertyId: string }).propertyId)
    await pool.query(
      `UPDATE housing.management_members SET status='active',reviewed_at=now(),reviewed_by=$2,revision=revision+1
       WHERE property_id=$1 AND status='pending'`, [propertyId, user],
    )
    return { property_id: propertyId, status: 'active' }
  })

  app.get('/v1/moderation/housing/queue', async request => {
    const user = actor(request)
    if (!moderator(user)) throw new ManagementError(403, 'Moderator permission is required.')
    const properties = await pool.query(
      `SELECT p.id,p.name,p.property_type,cp.address,mm.user_id,mm.requested_at
       FROM housing.management_members mm JOIN housing.properties p ON p.id=mm.property_id
       JOIN catalog.places cp ON cp.id=p.place_id WHERE mm.status='pending' ORDER BY mm.requested_at`,
    )
    const listings = await pool.query(
      `SELECT l.id,l.title,p.name AS property_name,ml.created_by,ml.updated_at
       FROM housing.managed_listings ml JOIN housing.listings l ON l.id=ml.listing_id
       JOIN housing.properties p ON p.id=l.property_id WHERE ml.publication_status='pending_review' ORDER BY ml.updated_at`,
    )
    return { properties: properties.rows, listings: listings.rows }
  })

  app.post('/v1/moderation/housing/listings/:listingId/review', async request => {
    const user = actor(request)
    if (!moderator(user)) throw new ManagementError(403, 'Moderator permission is required.')
    const listingId = Id.parse((request.params as { listingId: string }).listingId)
    const input = z.object({ decision: z.enum(['approve', 'reject']), reason: z.string().trim().max(500).optional() }).parse(request.body)
    const approved = input.decision === 'approve'
    const result = await pool.query(
      `UPDATE housing.managed_listings SET publication_status=$2,reviewed_at=now(),reviewed_by=$3,rejection_reason=$4,
       availability_confirmed_at=CASE WHEN $2='published' THEN now() ELSE availability_confirmed_at END,
       revision=revision+1,updated_at=now() WHERE listing_id=$1 AND publication_status='pending_review' RETURNING revision`,
      [listingId, approved ? 'published' : 'rejected', user, approved ? null : input.reason || 'Cần bổ sung thông tin.'],
    )
    if (!result.rowCount) throw new ManagementError(409, 'Tin không còn chờ duyệt.')
    await pool.query(
      `UPDATE housing.listings l SET status=CASE WHEN $2 AND ml.availability_status='vacant' THEN 'active' ELSE 'inactive' END,
       verification_status=CASE WHEN $2 THEN 'lifeflow_verified' ELSE verification_status END,
       verified_at=CASE WHEN $2 THEN now() ELSE verified_at END,verified_by=CASE WHEN $2 THEN $3 ELSE verified_by END,
       published_at=CASE WHEN $2 THEN COALESCE(published_at,now()) ELSE published_at END,updated_at=now()
       FROM housing.managed_listings ml WHERE l.id=$1 AND ml.listing_id=l.id`,
      [listingId, approved, user],
    )
    if (approved) await pool.query(`UPDATE housing.listing_media SET moderation_status='approved' WHERE listing_id=$1 AND moderation_status='pending'`, [listingId])
    return { id: listingId, publication_status: approved ? 'published' : 'rejected', revision: result.rows[0].revision }
  })

  app.post('/v1/housing/:listingId/contact-requests', async (request, reply) => {
    const user = actor(request)
    const listingId = Id.parse((request.params as { listingId: string }).listingId)
    const input = ContactInput.parse(request.body)
    const eligible = await pool.query(
      `SELECT 1 FROM housing.managed_listings ml JOIN housing.listings l ON l.id=ml.listing_id
       WHERE ml.listing_id=$1 AND ml.publication_status='published' AND ml.availability_status='vacant' AND l.status='active'`,
      [listingId],
    )
    if (!eligible.rowCount) throw new ManagementError(409, 'Tin hiện không nhận yêu cầu liên hệ.')
    try {
      const result = await pool.query(
        `INSERT INTO housing.contact_requests(listing_id,tenant_user_id,message) VALUES($1,$2,$3)
         RETURNING id,status,revision,created_at`, [listingId, user, input.message],
      )
      await pool.query(
        `INSERT INTO housing.listing_events(listing_id,actor_id,event_type,dedup_key)
         VALUES($1,$2,'contact_request',$3) ON CONFLICT DO NOTHING`,
        [listingId, user, `contact:${result.rows[0].id}`],
      )
      return reply.status(201).send(result.rows[0])
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new ManagementError(409, 'Bạn đã có yêu cầu đang được xử lý cho tin này.')
      throw error
    }
  })

  app.get('/v1/landlord/contact-requests', async request => {
    const user = actor(request)
    const result = await pool.query(
      `SELECT cr.id,cr.listing_id,cr.tenant_user_id,cr.message,cr.status,cr.revision,cr.created_at,cr.updated_at,l.title,u.unit_code,p.name AS property_name
       FROM housing.contact_requests cr JOIN housing.listings l ON l.id=cr.listing_id
       LEFT JOIN housing.units u ON u.id=l.unit_id JOIN housing.properties p ON p.id=l.property_id
       JOIN housing.management_members mm ON mm.property_id=p.id AND mm.user_id=$1 AND mm.status='active'
       ORDER BY (cr.status='new') DESC,cr.created_at DESC`, [user],
    )
    return { items: result.rows }
  })

  app.get('/v1/housing/contact-requests/me', async request => {
    const user = actor(request)
    const result = await pool.query(
      `SELECT cr.id,cr.listing_id,cr.message,cr.status,cr.revision,cr.created_at,cr.updated_at,l.title
       FROM housing.contact_requests cr JOIN housing.listings l ON l.id=cr.listing_id
       WHERE cr.tenant_user_id=$1 ORDER BY cr.created_at DESC`, [user],
    )
    return { items: result.rows }
  })

  app.post('/v1/housing/contact-requests/:requestId/cancel', async request => {
    const user = actor(request)
    const requestId = Id.parse((request.params as { requestId: string }).requestId)
    const input = z.object({ revision: Revision }).parse(request.body)
    const result = await pool.query(
      `UPDATE housing.contact_requests SET status='declined',revision=revision+1,updated_at=now()
       WHERE id=$1 AND tenant_user_id=$2 AND revision=$3 AND status IN ('new','contacted')
       RETURNING id,status,revision,updated_at`, [requestId, user, input.revision],
    )
    if (!result.rowCount) throw new ManagementError(409, 'Yêu cầu không còn có thể hủy.')
    return result.rows[0]
  })

  app.patch('/v1/landlord/contact-requests/:requestId', async request => {
    const user = actor(request)
    const requestId = Id.parse((request.params as { requestId: string }).requestId)
    const input = ContactUpdate.parse(request.body)
    const result = await pool.query(
      `UPDATE housing.contact_requests cr SET status=$2,revision=revision+1,updated_at=now()
       FROM housing.listings l JOIN housing.management_members mm ON mm.property_id=l.property_id
       WHERE cr.id=$1 AND cr.listing_id=l.id AND mm.user_id=$3 AND mm.status='active' AND cr.revision=$4
       RETURNING cr.id,cr.status,cr.revision,cr.updated_at`, [requestId, input.status, user, input.revision],
    )
    if (!result.rowCount) throw new ManagementError(409, 'Yêu cầu đã thay đổi hoặc bạn không có quyền xử lý.')
    return result.rows[0]
  })

  app.post('/v1/housing/:listingId/events', async request => {
    const user = actor(request)
    const listingId = Id.parse((request.params as { listingId: string }).listingId)
    const input = EventInput.parse(request.body)
    await pool.query(
      `INSERT INTO housing.listing_events(listing_id,actor_id,event_type,dedup_key)
       SELECT $1,$2,$3,$4 WHERE EXISTS(SELECT 1 FROM housing.listings WHERE id=$1 AND status='active')
       ON CONFLICT DO NOTHING`, [listingId, user, input.event_type, input.dedup_key],
    )
    return { recorded: true }
  })

}

