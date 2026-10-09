import { randomUUID, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { DatabasePool } from '@lifeflow/housing-query'
import { z } from 'zod'

const Id = z.string().uuid()
const Revision = z.number().int().positive()
// Owners type one address line; readers (agent, search text) use the importer's `raw` key.
const Address = z.record(z.string(), z.unknown()).transform(address =>
  typeof address.full_address === 'string' && address.raw === undefined
    ? { ...address, raw: address.full_address.trim() }
    : address,
)
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
const MessageInput = z.object({ body: z.string().trim().min(1).max(2_000) })
const ViewingInput = z.object({ slot: z.iso.datetime({ offset: true }) })
const ViewingDecision = z.object({ decision: z.enum(['confirm', 'decline']), revision: Revision })
const ContactUpdate = z.object({
  status: z.enum(['contacted', 'viewing', 'resolved', 'declined']),
  revision: Revision,
})
const EventInput = z.object({
  event_type: z.enum(['impression', 'detail_view', 'save']),
  dedup_key: z.string().trim().min(8).max(160),
})

const Text = (max: number) => z.string().trim().min(1).max(max)
const Optional = (max: number) => z.string().trim().max(max).nullable().optional().transform(v => v || null)
const HostProfileInput = z.object({
  poster_type: z.enum(['owner', 'manager', 'broker', 'business']),
  display_name: Text(80),
  legal_name: Text(160),
  phone: z.string().trim().regex(/^\+?[0-9 .-]{8,20}$/),
  broker_license_no: Optional(80),
  business_name: Optional(200),
  tax_code: Optional(20),
  accept_terms_version: z.string().trim().max(40).optional(),
  revision: Revision.optional(),
})
const HostReview = z.object({
  decision: z.enum(['verify', 'needs_info']),
  method: z.enum(['phone_call', 'video_call', 'in_person']).optional(),
  note: z.string().trim().max(500).optional(),
  reason: z.string().trim().max(500).optional(),
})
// Changing any of these after verification sends the profile back to the moderator.
const IDENTITY_FIELDS = ['poster_type', 'legal_name', 'phone', 'broker_license_no', 'business_name', 'tax_code'] as const

export class ManagementError extends Error {
  constructor(readonly status: number, message: string, readonly code = 'HOUSING_MANAGEMENT_ERROR') { super(message) }
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

// SPEC-021: a moderator never reviews a property they manage, even when they also own listings.
async function notOwnProperty(pool: DatabasePool, user: string, property: string) {
  const result = await pool.query(
    `SELECT 1 FROM housing.management_members WHERE property_id=$1 AND user_id=$2 AND status <> 'revoked'`,
    [property, user],
  )
  if (result.rowCount) throw new ManagementError(403, 'Không thể tự duyệt địa điểm hoặc tin mình quản lý.')
}

async function listingProperty(pool: DatabasePool, listing: string) {
  const result = await pool.query('SELECT property_id FROM housing.listings WHERE id=$1', [listing])
  if (!result.rows[0]) throw new ManagementError(404, 'Không tìm thấy tin nhà.')
  return String(result.rows[0].property_id)
}

// Team-owned terms are optional: an empty HOST_TERMS_VERSION means no acceptance step (host-mode-design H5).
function termsVersion() {
  return (process.env.HOST_TERMS_VERSION || '').trim() || null
}

async function hostProfile(pool: DatabasePool, user: string) {
  const result = await pool.query('SELECT * FROM housing.host_profiles WHERE user_id=$1', [user])
  return result.rows[0] as Record<string, unknown> | undefined
}

async function requireHostProfile(pool: DatabasePool, user: string) {
  const profile = await hostProfile(pool, user)
  if (!profile) throw new ManagementError(409, 'Hãy hoàn tất hồ sơ người đăng trước.', 'host_profile_required')
  const terms = termsVersion()
  if (terms && profile.terms_version !== terms) {
    throw new ManagementError(409, 'Hãy đồng ý điều khoản người đăng mới nhất.', 'host_terms_required')
  }
  return profile
}

async function requireVerifiedHosts(pool: DatabasePool, users: string[]) {
  if (!users.length) return
  const result = await pool.query(
    `SELECT count(*)::int AS verified FROM housing.host_profiles WHERE user_id = ANY($1::text[]) AND status='verified'`,
    [users],
  )
  if (result.rows[0].verified !== new Set(users).size) {
    throw new ManagementError(409, 'Người đăng chưa được xác minh.', 'host_not_verified')
  }
}

// Messages one sender may post per minute in a conversation; configuration, not a fixed rule.
function messageRate() {
  const value = Number(process.env.HOUSING_MESSAGE_RATE_PER_MINUTE || 10)
  return Number.isFinite(value) && value > 0 ? value : 10
}

// Who may read a conversation: the tenant who sent the request, or an active manager of the property.
// Anyone else gets 404 so request IDs cannot be probed.
async function conversationRole(pool: DatabasePool, user: string, requestId: string) {
  const result = await pool.query(
    `SELECT cr.*,l.title,
       CASE WHEN cr.tenant_user_id=$2 THEN 'tenant'
            WHEN EXISTS(SELECT 1 FROM housing.management_members mm WHERE mm.property_id=l.property_id
                        AND mm.user_id=$2 AND mm.status='active') THEN 'landlord' END AS role
     FROM housing.contact_requests cr JOIN housing.listings l ON l.id=cr.listing_id WHERE cr.id=$1`,
    [requestId, user],
  )
  const row = result.rows[0]
  if (!row?.role) throw new ManagementError(404, 'Không tìm thấy cuộc trò chuyện.')
  return row as Record<string, unknown> & { role: 'tenant' | 'landlord' }
}

// Unread messages for one side of a conversation (SQL fragment over alias `cr`).
const unreadFor = (side: 'tenant' | 'landlord') =>
  `(SELECT count(*)::int FROM housing.contact_messages m WHERE m.request_id=cr.id AND m.sender_role<>'${side}'
     AND m.created_at > COALESCE(cr.${side}_read_at,'epoch'::timestamptz)) AS unread`

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
  // Poster profile (host-mode-design §5): who is behind a property; only moderators see identity fields.
  app.get('/v1/host/profile', async request => {
    const user = actor(request)
    return { profile: (await hostProfile(pool, user)) ?? null, terms_version: termsVersion() }
  })

  app.put('/v1/host/profile', async request => {
    const user = actor(request)
    const input = HostProfileInput.parse(request.body)
    const terms = termsVersion()
    if (terms && input.accept_terms_version !== undefined && input.accept_terms_version !== terms) {
      throw new ManagementError(409, 'Điều khoản đã có phiên bản mới; hãy tải lại trang.', 'host_terms_required')
    }
    const accepted = terms && input.accept_terms_version === terms ? terms : null
    const current = await hostProfile(pool, user)
    if (!current) {
      if (terms && !accepted) throw new ManagementError(409, 'Hãy đồng ý điều khoản người đăng.', 'host_terms_required')
      const created = await pool.query(
        `INSERT INTO housing.host_profiles(user_id,poster_type,display_name,legal_name,phone,broker_license_no,
           business_name,tax_code,terms_version,terms_accepted_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,CASE WHEN $9::text IS NULL THEN NULL ELSE now() END)
         ON CONFLICT (user_id) DO NOTHING RETURNING *`,
        [user, input.poster_type, input.display_name, input.legal_name, input.phone, input.broker_license_no,
          input.business_name, input.tax_code, accepted],
      )
      if (!created.rowCount) throw new ManagementError(409, 'Hồ sơ đã được tạo ở nơi khác.')
      return { profile: created.rows[0], terms_version: terms }
    }
    if (input.revision === undefined) throw new ManagementError(409, 'Hồ sơ đã tồn tại; hãy tải lại trang.')
    const identityChanged = IDENTITY_FIELDS.some(field => (current[field] ?? null) !== input[field])
    const updated = await pool.query(
      `UPDATE housing.host_profiles SET poster_type=$3,display_name=$4,legal_name=$5,phone=$6,broker_license_no=$7,
         business_name=$8,tax_code=$9,
         terms_version=COALESCE($10,terms_version),
         terms_accepted_at=CASE WHEN $10::text IS NULL THEN terms_accepted_at ELSE now() END,
         status=CASE WHEN $11 OR status='needs_info' THEN 'pending' ELSE status END,
         verification_method=CASE WHEN $11 THEN NULL ELSE verification_method END,
         reviewed_at=CASE WHEN $11 THEN NULL ELSE reviewed_at END,
         reviewed_by=CASE WHEN $11 THEN NULL ELSE reviewed_by END,
         revision=revision+1,updated_at=now()
       WHERE user_id=$1 AND revision=$2 RETURNING *`,
      [user, input.revision, input.poster_type, input.display_name, input.legal_name, input.phone,
        input.broker_license_no, input.business_name, input.tax_code, accepted, identityChanged],
    )
    if (!updated.rowCount) throw new ManagementError(409, 'Hồ sơ đã được cập nhật ở nơi khác.')
    return { profile: updated.rows[0], terms_version: terms }
  })

  app.post('/v1/moderation/host/:userId/review', async request => {
    const user = actor(request)
    if (!moderator(user)) throw new ManagementError(403, 'Moderator permission is required.')
    const target = z.string().trim().min(1).max(128).parse((request.params as { userId: string }).userId)
    if (target === user) throw new ManagementError(403, 'Không thể tự xác minh hồ sơ của mình.')
    const input = HostReview.parse(request.body)
    if (input.decision === 'verify' && !input.method) throw new ManagementError(400, 'Chọn cách đã xác minh.')
    const verified = input.decision === 'verify'
    const result = await pool.query(
      `UPDATE housing.host_profiles SET status=$2,verification_method=$3,review_note=$4,info_request=$5,
         reviewed_at=now(),reviewed_by=$6,revision=revision+1,updated_at=now()
       WHERE user_id=$1 AND status='pending' RETURNING user_id,status,revision`,
      [target, verified ? 'verified' : 'needs_info', verified ? input.method : null, input.note || null,
        verified ? null : input.reason || 'Cần bổ sung thông tin.', user],
    )
    if (!result.rowCount) throw new ManagementError(409, 'Hồ sơ không còn chờ xác minh.')
    return result.rows[0]
  })

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
    await requireHostProfile(pool, user)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const place = await client.query(
        `INSERT INTO catalog.places(category_id,name,geom,address,attributes)
         VALUES((SELECT id FROM catalog.place_categories WHERE slug='housing-self-service'),$1,
         ST_SetSRID(ST_MakePoint($2,$3),4326),$4,'{"source":"self_service","entity_role":"housing_anchor"}'::jsonb) RETURNING id`,
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
        mm.status AS management_status,mm.role,mm.revision
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
      // source_type 'user' is the read contract's value for user-submitted listings; the
      // self_service attribute marks owner-managed rows. Other values break public detail parsing.
      await client.query(
        `INSERT INTO housing.listings(id,property_id,unit_id,listing_type,title,description,source_type,source_listing_id,status,attributes)
         VALUES($1,$2,$3,'rent',$4,$5,'user',$6,'inactive','{"self_service":true}'::jsonb)`,
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
    await requireHostProfile(pool, user)
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
    await notOwnProperty(pool, user, propertyId)
    const pending = await pool.query(
      `SELECT user_id FROM housing.management_members WHERE property_id=$1 AND status='pending'`, [propertyId],
    )
    await requireVerifiedHosts(pool, pending.rows.map(r => String(r.user_id)))
    const result = await pool.query(
      `UPDATE housing.management_members SET status='active',reviewed_at=now(),reviewed_by=$2,revision=revision+1
       WHERE property_id=$1 AND status='pending'`, [propertyId, user],
    )
    if (!result.rowCount) throw new ManagementError(409, 'Địa điểm không còn chờ duyệt.')
    return { property_id: propertyId, status: 'active' }
  })

  app.get('/v1/moderation/housing/queue', async request => {
    const user = actor(request)
    if (!moderator(user)) throw new ManagementError(403, 'Moderator permission is required.')
    const properties = await pool.query(
      `SELECT p.id,p.name,p.property_type,cp.address,mm.user_id,mm.requested_at,
         hp.status AS host_status,hp.display_name AS host_name,hp.poster_type
       FROM housing.management_members mm JOIN housing.properties p ON p.id=mm.property_id
       JOIN catalog.places cp ON cp.id=p.place_id LEFT JOIN housing.host_profiles hp ON hp.user_id=mm.user_id
       WHERE mm.status='pending' ORDER BY mm.requested_at`,
    )
    const listings = await pool.query(
      `SELECT l.id,l.title,l.description,p.name AS property_name,cp.address,u.unit_code,ml.created_by,ml.updated_at,
         o.price_amount::float AS rent_vnd,o.deposit_amount::float AS deposit_vnd,
         (SELECT count(*)::int FROM housing.listing_fees f WHERE f.listing_id=l.id AND f.valid_to IS NULL) AS fee_count,
         (SELECT coalesce(json_agg(json_build_object('url',m.url,'alt',m.alt_text) ORDER BY m.position),'[]'::json)
            FROM housing.listing_media m WHERE m.listing_id=l.id AND m.moderation_status='pending') AS pending_media,
         (SELECT mm.status FROM housing.management_members mm WHERE mm.property_id=p.id AND mm.role='owner' LIMIT 1) AS property_status,
         hp.status AS host_status,hp.display_name AS host_name,hp.poster_type
       FROM housing.managed_listings ml JOIN housing.listings l ON l.id=ml.listing_id
       LEFT JOIN housing.host_profiles hp ON hp.user_id=ml.created_by
       JOIN housing.properties p ON p.id=l.property_id JOIN catalog.places cp ON cp.id=p.place_id
       LEFT JOIN housing.units u ON u.id=l.unit_id
       LEFT JOIN LATERAL (SELECT * FROM housing.offers WHERE listing_id=l.id AND is_active ORDER BY valid_from DESC LIMIT 1) o ON true
       WHERE ml.publication_status='pending_review' ORDER BY ml.updated_at`,
    )
    const hosts = await pool.query(
      `SELECT hp.user_id,hp.poster_type,hp.display_name,hp.legal_name,hp.phone,hp.broker_license_no,hp.business_name,
         hp.tax_code,hp.updated_at,
         (SELECT count(*)::int FROM housing.management_members mm WHERE mm.user_id=hp.user_id AND mm.status='pending') AS pending_properties,
         (SELECT count(*)::int FROM housing.managed_listings ml WHERE ml.created_by=hp.user_id AND ml.publication_status='pending_review') AS pending_listings
       FROM housing.host_profiles hp WHERE hp.status='pending' AND hp.user_id <> $1 ORDER BY hp.updated_at`, [user],
    )
    return { hosts: hosts.rows, properties: properties.rows, listings: listings.rows }
  })

  app.post('/v1/moderation/housing/listings/:listingId/review', async request => {
    const user = actor(request)
    if (!moderator(user)) throw new ManagementError(403, 'Moderator permission is required.')
    const listingId = Id.parse((request.params as { listingId: string }).listingId)
    await notOwnProperty(pool, user, await listingProperty(pool, listingId))
    const input = z.object({ decision: z.enum(['approve', 'reject']), reason: z.string().trim().max(500).optional() }).parse(request.body)
    const approved = input.decision === 'approve'
    if (approved) {
      const author = await pool.query('SELECT created_by FROM housing.managed_listings WHERE listing_id=$1', [listingId])
      await requireVerifiedHosts(pool, author.rows.map(r => String(r.created_by)))
    }
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
      `SELECT cr.id,cr.listing_id,cr.tenant_user_id,cr.message,cr.status,cr.revision,cr.created_at,cr.updated_at,l.title,u.unit_code,p.name AS property_name,
         cr.viewing_slot,cr.viewing_status,cr.source,${unreadFor('landlord')}
       FROM housing.contact_requests cr JOIN housing.listings l ON l.id=cr.listing_id
       LEFT JOIN housing.units u ON u.id=l.unit_id JOIN housing.properties p ON p.id=l.property_id
       JOIN housing.management_members mm ON mm.property_id=p.id AND mm.user_id=$1 AND mm.status='active'
       ORDER BY (cr.viewing_status='requested') DESC,(cr.status='new') DESC,cr.created_at DESC`, [user],
    )
    return { items: result.rows }
  })

  app.get('/v1/housing/contact-requests/me', async request => {
    const user = actor(request)
    const result = await pool.query(
      `SELECT cr.id,cr.listing_id,cr.message,cr.status,cr.revision,cr.created_at,cr.updated_at,l.title,
         cr.viewing_slot,cr.viewing_status,cr.source,${unreadFor('tenant')}
       FROM housing.contact_requests cr JOIN housing.listings l ON l.id=cr.listing_id
       WHERE cr.tenant_user_id=$1 ORDER BY cr.created_at DESC`, [user],
    )
    return { items: result.rows }
  })

  // Viewing time from the tenant's "Xem nhà" tab (viewing-landlord-confirmation §3). Idempotent: the
  // gateway re-sends the current slot after every viewing step; an unchanged slot changes nothing.
  app.put('/v1/housing/:listingId/viewing', async (request, reply) => {
    const user = actor(request)
    const listingId = Id.parse((request.params as { listingId: string }).listingId)
    const input = ViewingInput.parse(request.body)
    const slot = new Date(input.slot)
    if (slot.getTime() <= Date.now()) throw new ManagementError(422, 'Giờ xem đã qua.')
    const eligible = await pool.query(
      `SELECT 1 FROM housing.managed_listings ml JOIN housing.listings l ON l.id=ml.listing_id
       WHERE ml.listing_id=$1 AND ml.publication_status='published' AND ml.availability_status='vacant' AND l.status='active'`,
      [listingId],
    )
    if (!eligible.rowCount) throw new ManagementError(409, 'Tin này không nhận lịch xem qua ReloHome.', 'not_managed')
    const open = await pool.query(
      `SELECT id,viewing_slot,viewing_status FROM housing.contact_requests
       WHERE listing_id=$1 AND tenant_user_id=$2 AND status IN ('new','contacted','viewing')`, [listingId, user],
    )
    const current = open.rows[0]
    const sameSlot = current?.viewing_slot && new Date(current.viewing_slot).getTime() === slot.getTime()
    // A slot the landlord already answered stays answered; the tenant has to pick a different time.
    if (current && sameSlot && ['requested', 'confirmed', 'declined'].includes(current.viewing_status)) {
      return { id: current.id, viewing_status: current.viewing_status, changed: false }
    }
    if (current) {
      const updated = await pool.query(
        `UPDATE housing.contact_requests SET viewing_slot=$2,viewing_status='requested',viewing_updated_at=now(),
           revision=revision+1,updated_at=now() WHERE id=$1 RETURNING id,viewing_status`, [current.id, slot],
      )
      return { ...updated.rows[0], changed: true }
    }
    try {
      const created = await pool.query(
        `INSERT INTO housing.contact_requests(listing_id,tenant_user_id,message,viewing_slot,viewing_status,viewing_updated_at,source)
         VALUES($1,$2,'Người thuê đặt lịch xem nhà qua ReloHome.',$3,'requested',now(),'viewing') RETURNING id,viewing_status`,
        [listingId, user, slot],
      )
      await pool.query(
        `INSERT INTO housing.listing_events(listing_id,actor_id,event_type,dedup_key)
         VALUES($1,$2,'contact_request',$3) ON CONFLICT DO NOTHING`,
        [listingId, user, `contact:${created.rows[0].id}`],
      )
      return reply.status(201).send({ ...created.rows[0], changed: true })
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new ManagementError(409, 'Yêu cầu vừa được tạo ở nơi khác; hãy thử lại.')
      throw error
    }
  })

  app.delete('/v1/housing/:listingId/viewing', async request => {
    const user = actor(request)
    const listingId = Id.parse((request.params as { listingId: string }).listingId)
    // A request that only existed for this viewing and was never handled closes with it.
    const result = await pool.query(
      `UPDATE housing.contact_requests SET viewing_status='cancelled',viewing_updated_at=now(),
         status=CASE WHEN source='viewing' AND status='new' THEN 'declined' ELSE status END,
         revision=revision+1,updated_at=now()
       WHERE listing_id=$1 AND tenant_user_id=$2 AND status IN ('new','contacted','viewing')
         AND viewing_status IN ('requested','confirmed')
       RETURNING id,status,viewing_status`, [listingId, user],
    )
    return { changed: Boolean(result.rowCount), ...(result.rows[0] || {}) }
  })

  app.post('/v1/landlord/contact-requests/:requestId/viewing', async request => {
    const user = actor(request)
    const requestId = Id.parse((request.params as { requestId: string }).requestId)
    const input = ViewingDecision.parse(request.body)
    const confirmed = input.decision === 'confirm'
    const result = await pool.query(
      `UPDATE housing.contact_requests cr SET viewing_status=$2,viewing_updated_at=now(),
         status=CASE WHEN $2='confirmed' THEN 'viewing' ELSE cr.status END,revision=cr.revision+1,updated_at=now()
       FROM housing.listings l JOIN housing.management_members mm ON mm.property_id=l.property_id
       WHERE cr.id=$1 AND cr.listing_id=l.id AND mm.user_id=$3 AND mm.status='active' AND cr.revision=$4
         AND cr.viewing_status='requested' AND cr.status IN ('new','contacted','viewing')
       RETURNING cr.id,cr.status,cr.viewing_status,cr.revision`,
      [requestId, confirmed ? 'confirmed' : 'declined', user, input.revision],
    )
    if (!result.rowCount) throw new ManagementError(409, 'Lịch xem đã thay đổi hoặc bạn không có quyền xử lý.')
    return result.rows[0]
  })

  // Conversation of one contact request (tenant <-> landlord); reading marks it read for the caller's side.
  app.get('/v1/housing/contact-requests/:requestId/messages', async request => {
    const user = actor(request)
    const requestId = Id.parse((request.params as { requestId: string }).requestId)
    const conversation = await conversationRole(pool, user, requestId)
    const messages = await pool.query(
      `SELECT id,sender_role,body,created_at FROM housing.contact_messages WHERE request_id=$1 ORDER BY created_at,id`,
      [requestId],
    )
    await pool.query(`UPDATE housing.contact_requests SET ${conversation.role}_read_at=now() WHERE id=$1`, [requestId])
    return {
      role: conversation.role,
      request: {
        id: conversation.id, listing_id: conversation.listing_id, title: conversation.title,
        status: conversation.status, message: conversation.message, created_at: conversation.created_at,
        viewing_slot: conversation.viewing_slot, viewing_status: conversation.viewing_status,
        open: ['new', 'contacted', 'viewing'].includes(String(conversation.status)),
      },
      messages: messages.rows,
    }
  })

  app.post('/v1/housing/contact-requests/:requestId/messages', async (request, reply) => {
    const user = actor(request)
    const requestId = Id.parse((request.params as { requestId: string }).requestId)
    const input = MessageInput.parse(request.body)
    const conversation = await conversationRole(pool, user, requestId)
    if (!['new', 'contacted', 'viewing'].includes(String(conversation.status))) {
      throw new ManagementError(409, 'Yêu cầu đã đóng; không gửi thêm tin nhắn được.')
    }
    const recent = await pool.query(
      `SELECT count(*)::int AS n FROM housing.contact_messages
       WHERE request_id=$1 AND sender_user_id=$2 AND created_at > now() - interval '1 minute'`, [requestId, user],
    )
    if (recent.rows[0].n >= messageRate()) throw new ManagementError(429, 'Bạn gửi hơi nhanh; chờ một chút rồi gửi tiếp.')
    const created = await pool.query(
      `INSERT INTO housing.contact_messages(request_id,sender_role,sender_user_id,body) VALUES($1,$2,$3,$4)
       RETURNING id,sender_role,body,created_at`, [requestId, conversation.role, user, input.body],
    )
    // The landlord's first reply means the request has been answered.
    await pool.query(
      `UPDATE housing.contact_requests SET ${conversation.role}_read_at=now(),updated_at=now(),
         status=CASE WHEN $2='landlord' AND status='new' THEN 'contacted' ELSE status END,
         revision=CASE WHEN $2='landlord' AND status='new' THEN revision+1 ELSE revision END
       WHERE id=$1`, [requestId, conversation.role],
    )
    return reply.status(201).send(created.rows[0])
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
      `UPDATE housing.contact_requests cr SET status=$2,revision=cr.revision+1,updated_at=now()
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

