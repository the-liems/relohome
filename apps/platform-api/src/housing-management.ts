import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { DatabasePool } from '@relohome/housing-query'
import { z } from 'zod'
import { isDeepStrictEqual } from 'node:util'

import { verifyLocation } from './housing-location.js'
import { lockedListing, requireCompleteListing, revisionOf } from './housing-policy.js'
import { endRentPeriod, startRentPeriod } from './housing-revenue.js'
import { withTransaction } from './transaction.js'

const Id = z.string().uuid()
const Revision = z.number().int().positive()
// Owners type one address line; readers (agent, search text) use the importer's `raw` key.
const Address = z
  .record(z.string(), z.unknown())
  .transform(address =>
    typeof address.full_address === 'string' && address.raw === undefined
      ? { ...address, raw: address.full_address.trim() }
      : address,
  )
const PropertyInput = z.object({
  name: z.string().trim().min(2).max(160),
  property_type: z.enum(['apartment', 'house', 'room', 'studio', 'serviced_apartment', 'homestay', 'other']),
  address: Address,
  location_token: z.string().max(8000).optional(),
  location_confirmed: z.boolean().default(false),
  location: z.object({
    lng: z.number().min(102).max(110),
    lat: z.number().min(8).max(24),
  }),
})
const UnitInput = z.object({
  unit_code: z.string().trim().min(1).max(80),
  bedrooms: z.number().nonnegative().max(100).nullable().default(null),
  bathrooms: z.number().nonnegative().max(100).nullable().default(null),
  area_m2: z.number().positive().max(100_000).nullable().default(null),
  amenities: z.array(z.string().trim().min(1).max(80)).max(100).default([]),
})
const FeeInput = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]{1,40}$/),
  label: z.string().trim().min(1).max(100),
  amount: z.number().nonnegative().nullable(),
  billing_unit: z.enum(['month', 'one_time', 'kwh', 'm3', 'person_month', 'vehicle_month']),
  required: z.boolean().default(true),
  refundable: z.boolean().default(false),
})
const ListingInput = z.object({
  request_id: z.string().uuid().optional(),
  title: z.string().trim().max(240).default(''),
  description: z.string().trim().max(5_000).default(''),
  rent_vnd: z.number().int().nonnegative().max(10_000_000_000).default(0),
  deposit_vnd: z.number().int().nonnegative().max(10_000_000_000).nullable().default(null),
  availability_from: z.iso.date().nullable().default(null),
  fees: z.array(FeeInput).max(30).default([]),
})
const ListingUpdate = ListingInput.extend({
  title: ListingInput.shape.title.removeDefault(),
  description: ListingInput.shape.description.removeDefault(),
  rent_vnd: ListingInput.shape.rent_vnd.removeDefault(),
  deposit_vnd: ListingInput.shape.deposit_vnd.removeDefault(),
  availability_from: ListingInput.shape.availability_from.removeDefault(),
  fees: ListingInput.shape.fees.removeDefault(),
})
  .partial()
  .extend({ revision: Revision })
const PropertyUpdate = PropertyInput.extend({
  location_confirmed: PropertyInput.shape.location_confirmed.removeDefault(),
})
  .partial()
  .extend({ revision: Revision })
const UnitUpdate = UnitInput.extend({
  bedrooms: UnitInput.shape.bedrooms.removeDefault(),
  bathrooms: UnitInput.shape.bathrooms.removeDefault(),
  area_m2: UnitInput.shape.area_m2.removeDefault(),
  amenities: UnitInput.shape.amenities.removeDefault(),
})
  .partial()
  .extend({ revision: Revision })
const MediaInput = z.object({
  content_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  url: z.url().max(2_000),
  alt: z.string().trim().max(300).nullable().default(null),
})
const ContactInput = z.object({ message: z.string().trim().min(1).max(1_000) })
const MessageInput = z.object({ body: z.string().trim().min(1).max(2_000) })
const ViewingInput = z.object({ slot: z.iso.datetime({ offset: true }) })
const ViewingDecision = z.object({
  decision: z.enum(['confirm', 'decline']),
  revision: Revision,
})
const ContactUpdate = z.object({
  status: z.enum(['contacted', 'viewing', 'resolved', 'declined']),
  revision: Revision,
})
const EventInput = z.object({
  event_type: z.enum(['impression', 'detail_view', 'save']),
  dedup_key: z.string().trim().min(8).max(160),
})

const Text = (max: number) => z.string().trim().min(1).max(max)
const Optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform(v => v || null)
const HostProfileInput = z.object({
  poster_type: z.enum(['owner', 'manager', 'broker', 'business']),
  display_name: Text(80),
  legal_name: Text(160),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 .-]{8,20}$/),
  broker_license_no: Optional(80),
  business_name: Optional(200),
  tax_code: Optional(20),
  accept_terms_version: z.string().trim().max(40).optional(),
  revision: Revision.optional(),
})
const HostReview = z.object({
  revision: Revision,
  decision: z.enum(['verify', 'needs_info']),
  method: z.enum(['phone_call', 'video_call', 'in_person']).optional(),
  note: z.string().trim().max(500).optional(),
  reason: z.string().trim().max(500).optional(),
})
// Changing any of these after verification sends the profile back to the moderator.
const IDENTITY_FIELDS = [
  'poster_type',
  'legal_name',
  'phone',
  'broker_license_no',
  'business_name',
  'tax_code',
] as const

export class ManagementError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = 'HOUSING_MANAGEMENT_ERROR',
    readonly fields?: Record<string, string>,
  ) {
    super(message)
  }
}

function equalSecret(actual: string, expected: string) {
  const left = Buffer.from(actual)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

export function actor(request: FastifyRequest) {
  const expected = process.env.AGENT_API_TOKEN || ''
  const authorization = String(request.headers.authorization || '')
  const user = String(request.headers['x-user-id'] || '').trim()
  if (!expected) throw new ManagementError(503, 'Housing management is not configured.')
  if (!equalSecret(authorization, `Bearer ${expected}`) || !user || user.length > 128) {
    throw new ManagementError(401, 'A trusted gateway identity is required.')
  }
  return user
}

export function moderator(user: string) {
  return new Set(
    (process.env.HOUSING_MODERATOR_IDS || '')
      .split(',')
      .map(v => v.trim())
      .filter(Boolean),
  ).has(user)
}

export async function member(pool: Pick<DatabasePool, 'query'>, user: string, property: string, active = false) {
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
export async function notOwnProperty(pool: Pick<DatabasePool, 'query'>, user: string, property: string) {
  const result = await pool.query(
    `SELECT 1 FROM housing.management_members WHERE property_id=$1 AND user_id=$2 AND status <> 'revoked'`,
    [property, user],
  )
  if (result.rowCount) throw new ManagementError(403, 'Không thể tự duyệt địa điểm hoặc tin mình quản lý.')
}

async function listingProperty(pool: Pick<DatabasePool, 'query'>, listing: string) {
  const result = await pool.query('SELECT property_id FROM housing.listings WHERE id=$1', [listing])
  if (!result.rows[0]) throw new ManagementError(404, 'Không tìm thấy tin nhà.')
  return String(result.rows[0].property_id)
}

// Team-owned terms are optional: an empty HOST_TERMS_VERSION means no acceptance step (host-mode-design H5).
function termsVersion() {
  return (process.env.HOST_TERMS_VERSION || '').trim() || null
}

async function hostProfile(pool: Pick<DatabasePool, 'query'>, user: string) {
  const result = await pool.query('SELECT * FROM housing.host_profiles WHERE user_id=$1', [user])
  return result.rows[0] as Record<string, unknown> | undefined
}

async function requireHostProfile(pool: Pick<DatabasePool, 'query'>, user: string) {
  const profile = await hostProfile(pool, user)
  if (!profile) throw new ManagementError(409, 'Hãy hoàn tất hồ sơ người đăng trước.', 'host_profile_required')
  const terms = termsVersion()
  if (terms && profile.terms_version !== terms) {
    throw new ManagementError(409, 'Hãy đồng ý điều khoản người đăng mới nhất.', 'host_terms_required')
  }
  return profile
}

async function requireVerifiedHosts(pool: Pick<DatabasePool, 'query'>, users: string[]) {
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
// Resolve only the other participant of an authorized contact, never a client-supplied account.
export const contactCounterpartySql = (userParameter: '$1' | '$2') => `
  CASE WHEN cr.tenant_user_id<>${userParameter} THEN cr.tenant_user_id ELSE coalesce(
    (SELECT m.sender_user_id FROM housing.contact_messages m
      WHERE m.request_id=cr.id AND m.sender_role='landlord'
      ORDER BY m.created_at DESC,m.id DESC LIMIT 1),
    (SELECT mm.user_id FROM housing.management_members mm
      WHERE mm.property_id=l.property_id AND mm.status='active'
      ORDER BY (mm.role='owner') DESC,mm.requested_at,mm.user_id LIMIT 1)) END`

export async function conversationRole(pool: Pick<DatabasePool, 'query'>, user: string, requestId: string) {
  const result = await pool.query(
    `SELECT cr.*,l.title,${contactCounterpartySql('$2')} AS counterparty_user_id,
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

async function notOwnContact(pool: DatabasePool, user: string, listing: string) {
  const result = await pool.query(
    `SELECT 1 FROM housing.listings l JOIN housing.management_members mm
    ON mm.property_id=l.property_id WHERE l.id=$1 AND mm.user_id=$2 AND mm.status<>'revoked'`,
    [listing, user],
  )
  if (result.rowCount)
    throw new ManagementError(409, 'Hãy dùng tài khoản người thuê khác để liên hệ nhà bạn quản lý.', 'self_contact')
}

// Unread messages for one side of a conversation (SQL fragment over alias `cr`).
const unreadFor = (side: 'tenant' | 'landlord') =>
  `(SELECT count(*)::int FROM housing.contact_messages m WHERE m.request_id=cr.id AND m.sender_role<>'${side}'
     AND m.created_at > COALESCE(cr.${side}_read_at,'epoch'::timestamptz)) AS unread`

async function replaceFees(
  client: { query: DatabasePool['query'] },
  listing: string,
  fees: z.infer<typeof FeeInput>[],
) {
  await client.query('UPDATE housing.listing_fees SET valid_to=now() WHERE listing_id=$1 AND valid_to IS NULL', [
    listing,
  ])
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
    const profile = (await hostProfile(pool, user)) ?? null
    if (profile) delete profile.review_note
    return {
      profile,
      terms_version: termsVersion(),
      capabilities: { can_moderate_housing: moderator(user) },
    }
  })

  app.put('/v1/host/profile', async request => {
    const user = actor(request)
    const input = HostProfileInput.parse(request.body)
    const terms = termsVersion()
    if (terms && input.accept_terms_version !== undefined && input.accept_terms_version !== terms) {
      throw new ManagementError(
        409,
        'Điều khoản đã có phiên bản mới; hãy tải lại trang.',
        'host_terms_required',
      )
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
        [
          user,
          input.poster_type,
          input.display_name,
          input.legal_name,
          input.phone,
          input.broker_license_no,
          input.business_name,
          input.tax_code,
          accepted,
        ],
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
      [
        user,
        input.revision,
        input.poster_type,
        input.display_name,
        input.legal_name,
        input.phone,
        input.broker_license_no,
        input.business_name,
        input.tax_code,
        accepted,
        identityChanged,
      ],
    )
    if (!updated.rowCount) throw new ManagementError(409, 'Hồ sơ đã được cập nhật ở nơi khác.')
    return { profile: updated.rows[0], terms_version: terms }
  })

  app.post('/v1/moderation/host/:userId/review', async request => {
    const user = actor(request)
    if (!moderator(user)) throw new ManagementError(403, 'Moderator permission is required.')
    const target = z
      .string()
      .trim()
      .min(1)
      .max(128)
      .parse((request.params as { userId: string }).userId)
    if (target === user) throw new ManagementError(403, 'Không thể tự xác minh hồ sơ của mình.')
    const input = HostReview.parse(request.body)
    if (input.decision === 'verify' && !input.method) throw new ManagementError(400, 'Chọn cách đã xác minh.')
    const verified = input.decision === 'verify'
    const result = await pool.query(
      `UPDATE housing.host_profiles SET status=$2,verification_method=$3,review_note=$4,info_request=$5,
         reviewed_at=now(),reviewed_by=$6,revision=revision+1,updated_at=now()
       WHERE user_id=$1 AND status='pending' AND revision=$7 RETURNING user_id,status,revision`,
      [
        target,
        verified ? 'verified' : 'needs_info',
        verified ? input.method : null,
        input.note || null,
        verified ? null : input.reason || 'Cần bổ sung thông tin.',
        user,
        input.revision,
      ],
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
        count(DISTINCT u.id) FILTER (WHERE ml.availability_status='vacant')::int AS vacant,
        count(DISTINCT cr.id) FILTER (WHERE cr.status='new')::int AS new_contacts,
        min(le.occurred_at) AS measured_since,
        count(DISTINCT le.id) FILTER (WHERE le.event_type='detail_view')::int AS detail_views,
        count(DISTINCT le.id) FILTER (WHERE le.event_type='save')::int AS saves,
        count(DISTINCT le.id) FILTER (WHERE le.event_type='contact_request')::int AS contact_requests
       FROM housing.management_members mm
       LEFT JOIN housing.units u ON u.property_id=mm.property_id AND u.deleted_at IS NULL
       LEFT JOIN housing.listings l ON l.unit_id=u.id AND l.deleted_at IS NULL
       LEFT JOIN housing.managed_listings ml ON ml.listing_id=l.id
       LEFT JOIN housing.contact_requests cr ON cr.listing_id=l.id
       LEFT JOIN housing.listing_events le ON le.listing_id=l.id
       WHERE mm.user_id=$1 AND mm.status <> 'revoked'`,
      [user],
    )
    return result.rows[0]
  })

  app.get('/v1/landlord/properties', async request => {
    const user = actor(request)
    const result = await pool.query(
      `SELECT p.id,p.name,p.property_type,cp.address,ST_X(cp.geom)::float AS lng,ST_Y(cp.geom)::float AS lat,
        mm.role,mm.status,p.revision,
        count(DISTINCT u.id)::int AS unit_count,
        count(DISTINCT u.id) FILTER (WHERE ml.availability_status='vacant')::int AS vacant_count
       FROM housing.management_members mm JOIN housing.properties p ON p.id=mm.property_id
       JOIN catalog.places cp ON cp.id=p.place_id
       LEFT JOIN housing.units u ON u.property_id=p.id AND u.deleted_at IS NULL
       LEFT JOIN housing.listings l ON l.unit_id=u.id AND l.deleted_at IS NULL
       LEFT JOIN housing.managed_listings ml ON ml.listing_id=l.id
       WHERE mm.user_id=$1 AND mm.status <> 'revoked' AND p.deleted_at IS NULL
       GROUP BY p.id,cp.id,mm.role,mm.status,mm.revision ORDER BY p.created_at DESC`,
      [user],
    )
    return { items: result.rows }
  })

  app.post('/v1/landlord/properties', async (request, reply) => {
    const user = actor(request)
    const input = PropertyInput.parse(request.body)
    await requireHostProfile(pool, user)
    const mapping = input.location_token
      ? verifyLocation(
          input.location_token,
          user,
          String(input.address.full_address || input.address.raw || ''),
          input.location,
        )
      : null
    const created = await withTransaction(pool, async client => {
      const place = await client.query(
        `INSERT INTO catalog.places(category_id,name,geom,address,attributes)
         VALUES((SELECT id FROM catalog.place_categories WHERE slug='housing-self-service'),$1,
         ST_SetSRID(ST_MakePoint($2,$3),4326),$4,'{"source":"self_service","entity_role":"housing_anchor"}'::jsonb) RETURNING id`,
        [input.name, input.location.lng, input.location.lat, input.address],
      )
      const property = await client.query(
        `INSERT INTO housing.properties(place_id,property_type,name,attributes,location_metadata,location_confirmed_at)
         VALUES($1,$2,$3,'{"source":"self_service"}'::jsonb,$4,CASE WHEN $5 THEN now() ELSE NULL END) RETURNING id`,
        [
          place.rows[0].id,
          input.property_type,
          input.name,
          mapping
            ? {
                source: mapping.source,
                ref_id: mapping.ref_id,
                address: mapping.address,
                location: mapping.location,
                accuracy: 'approximate',
              }
            : {},
          Boolean(mapping) && input.location_confirmed,
        ],
      )
      await client.query(
        `INSERT INTO housing.management_members(property_id,user_id,role,status) VALUES($1,$2,'owner','pending')`,
        [property.rows[0].id, user],
      )
      return { id: property.rows[0].id, management_status: 'pending' }
    })
    return reply.status(201).send(created)
  })

  app.get('/v1/landlord/properties/:propertyId', async request => {
    const user = actor(request)
    const propertyId = Id.parse((request.params as { propertyId: string }).propertyId)
    await member(pool, user, propertyId)
    const property = await pool.query(
      `SELECT p.id,p.name,p.property_type,cp.address,ST_X(cp.geom)::float AS lng,ST_Y(cp.geom)::float AS lat,
        mm.status AS management_status,mm.role,p.revision,p.location_metadata,p.location_confirmed_at
       FROM housing.properties p JOIN catalog.places cp ON cp.id=p.place_id
       JOIN housing.management_members mm ON mm.property_id=p.id AND mm.user_id=$2 WHERE p.id=$1`,
      [propertyId, user],
    )
    const units = await pool.query(
      `SELECT u.id,u.unit_code,u.bedrooms,u.bathrooms,u.area_m2,u.amenities,u.revision AS unit_revision,
        u.attributes->>'bathroom_type' AS bathroom_type,
        l.id AS listing_id,l.title,ml.publication_status,ml.availability_status,ml.revision
       FROM housing.units u LEFT JOIN housing.listings l ON l.unit_id=u.id AND l.deleted_at IS NULL
       LEFT JOIN housing.managed_listings ml ON ml.listing_id=l.id
       WHERE u.property_id=$1 AND u.deleted_at IS NULL ORDER BY u.unit_code`,
      [propertyId],
    )
    return { ...property.rows[0], units: units.rows }
  })

  app.patch('/v1/landlord/properties/:propertyId', async request => {
    const user = actor(request),
      propertyId = Id.parse((request.params as { propertyId: string }).propertyId)
    const input = PropertyUpdate.parse(request.body)
    return withTransaction(pool, async client => {
      await member(client, user, propertyId)
      const current = (
        await client.query(
          `SELECT p.*,cp.address,ST_X(cp.geom)::float AS lng,ST_Y(cp.geom)::float AS lat
        FROM housing.properties p JOIN catalog.places cp ON cp.id=p.place_id WHERE p.id=$1 FOR UPDATE OF p`,
          [propertyId],
        )
      ).rows[0]
      if (!current || current.revision !== input.revision)
        throw new ManagementError(409, 'Thông tin nhà đã được cập nhật ở nơi khác.', 'revision_conflict')
      const address = input.address ?? current.address
      const location = input.location ?? { lat: current.lat, lng: current.lng }
      const addressChanged = !isDeepStrictEqual(address, current.address)
      const pointChanged = location.lat !== current.lat || location.lng !== current.lng
      const mapping = input.location_token
        ? verifyLocation(input.location_token, user, String(address.full_address || address.raw || ''), location)
        : null
      const reset = addressChanged || pointChanged
      await client.query(
        `UPDATE housing.properties SET name=COALESCE($2,name),property_type=COALESCE($3,property_type),
        location_metadata=CASE WHEN $4 THEN $5 ELSE location_metadata END,
        location_confirmed_at=CASE WHEN $4 THEN CASE WHEN $6 THEN now() ELSE NULL END ELSE location_confirmed_at END,
        revision=revision+1,updated_at=now() WHERE id=$1`,
        [
          propertyId,
          input.name ?? null,
          input.property_type ?? null,
          reset || Boolean(mapping),
          mapping
            ? {
                source: mapping.source,
                ref_id: mapping.ref_id,
                address: mapping.address,
                location: mapping.location,
                accuracy: 'approximate',
              }
            : {},
          Boolean(mapping) && input.location_confirmed,
        ],
      )
      if (input.name !== undefined || input.address !== undefined || input.location !== undefined) {
        await client.query(
          `UPDATE catalog.places SET name=COALESCE($2,name),address=$3,
          geom=ST_SetSRID(ST_MakePoint($4,$5),4326),updated_at=now() WHERE id=$1`,
          [current.place_id, input.name ?? null, address, location.lng, location.lat],
        )
      }
      return { id: propertyId, revision: current.revision + 1 }
    })
  })

  // One transaction for room details, listing content and costs. Photos use the
  // existing validated uploader; publication still uses the existing review gate.
  const RoomListingInput = z.object({
    request_id: Id,
    unit: UnitInput.extend({
      area_m2: z.number().positive().max(100000),
      bedrooms: z.number().min(0).max(100),
      bathrooms: z.number().min(0).max(100),
      // Shared or en-suite toilet; kept in unit attributes, no column of its own.
      bathroom_type: z.enum(['shared', 'private']).nullable().default(null),
    }),
    listing: ListingInput.extend({
      title: z.string().trim().min(5).max(240),
      description: z.string().trim().min(1).max(5000),
      rent_vnd: z.number().int().positive().max(10000000000),
    }),
    unit_revision: Revision.optional(),
    listing_revision: Revision.optional(),
  })
  const saveRoomListing = async (request: FastifyRequest, reply: import('fastify').FastifyReply) => {
    const user = actor(request),
      input = RoomListingInput.parse(request.body)
    const params = request.params as { propertyId?: string; unitId?: string }
    const outcome = await withTransaction(pool, async client => {
      let room: Record<string, any> | undefined
      let propertyId = params.propertyId ? Id.parse(params.propertyId) : undefined
      if (params.unitId) {
        room = (
          await client.query('SELECT * FROM housing.units WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [
            Id.parse(params.unitId),
          ])
        ).rows[0]
        if (!room) throw new ManagementError(404, 'Không tìm thấy phòng.')
        propertyId = room.property_id
      }
      if (!propertyId) throw new ManagementError(404, 'Không tìm thấy nhà.')
      await member(client, user, propertyId)
      await requireHostProfile(client, user)
      if (!room) {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          user + ':room:' + propertyId + ':' + input.request_id,
        ])
        const fingerprint = createHash('sha256')
          .update(JSON.stringify({ unit: input.unit, listing: input.listing }))
          .digest('hex')
        const previous = (
          await client.query(
            `SELECT u.id,u.revision AS unit_revision,u.attributes,l.id AS listing_id,ml.revision
          FROM housing.units u JOIN housing.listings l ON l.unit_id=u.id JOIN housing.managed_listings ml ON ml.listing_id=l.id
          WHERE u.property_id=$1 AND u.attributes->>'create_request_id'=$2 AND u.attributes->>'create_actor_id'=$3`,
            [propertyId, input.request_id, user],
          )
        ).rows[0]
        if (previous) {
          if (previous.attributes.create_payload_sha256 !== fingerprint)
            throw new ManagementError(409, 'Yêu cầu tạo phòng đã được dùng với nội dung khác.')
          return {
            status: 200,
            body: {
              id: previous.listing_id,
              unit_id: previous.id,
              unit_revision: previous.unit_revision,
              revision: previous.revision,
              reused: true,
            },
          }
        }
        room = (
          await client.query(
            `INSERT INTO housing.units(property_id,unit_code,bedrooms,bathrooms,area_m2,amenities,attributes)
          VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
            [
              propertyId,
              input.unit.unit_code,
              input.unit.bedrooms,
              input.unit.bathrooms,
              input.unit.area_m2,
              input.unit.amenities,
              {
                source: 'self_service',
                create_request_id: input.request_id,
                create_actor_id: user,
                create_payload_sha256: fingerprint,
                ...(input.unit.bathroom_type ? { bathroom_type: input.unit.bathroom_type } : {}),
              },
            ],
          )
        ).rows[0]
      }
      const existing = (
        await client.query(
          `SELECT l.id,l.title,l.description,ml.revision,ml.publication_status FROM housing.listings l JOIN housing.managed_listings ml ON ml.listing_id=l.id WHERE l.unit_id=$1 AND l.deleted_at IS NULL FOR UPDATE OF l,ml`,
          [room!.id],
        )
      ).rows[0]
      // Saving an unchanged form keeps the revisions, so a rejected listing still
      // counts as unchanged when it is sent back for review.
      let changed = !existing
      if (params.unitId) {
        if (
          input.unit_revision !== room!.revision ||
          (existing && input.listing_revision !== existing.revision)
        )
          throw new ManagementError(409, 'Phòng hoặc tin đã thay đổi. Hãy tải lại.', 'revision_conflict')
        if (existing?.publication_status === 'deleted') throw new ManagementError(409, 'Tin đã được xóa.')
        const value = (v: unknown) => (v == null ? null : Number(v))
        const unitChanged =
          room!.unit_code !== input.unit.unit_code ||
          value(room!.bedrooms) !== input.unit.bedrooms ||
          value(room!.bathrooms) !== input.unit.bathrooms ||
          value(room!.area_m2) !== input.unit.area_m2 ||
          !isDeepStrictEqual(room!.amenities || [], input.unit.amenities) ||
          (room!.attributes?.bathroom_type ?? null) !== input.unit.bathroom_type
        if (unitChanged) {
          changed = true
          room = (
            await client.query(
              `UPDATE housing.units SET unit_code=$2,bedrooms=$3,bathrooms=$4,area_m2=$5,amenities=$6,
              attributes=CASE WHEN $7::text IS NULL THEN attributes - 'bathroom_type'
                ELSE attributes || jsonb_build_object('bathroom_type',$7::text) END,
              revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *`,
              [
                room!.id,
                input.unit.unit_code,
                input.unit.bedrooms,
                input.unit.bathrooms,
                input.unit.area_m2,
                input.unit.amenities,
                input.unit.bathroom_type,
              ],
            )
          ).rows[0]
        }
      }
      const listingId = existing?.id || randomUUID(),
        content = input.listing
      if (existing) {
        if (existing.title !== content.title || existing.description !== content.description) {
          changed = true
          await client.query(
            'UPDATE housing.listings SET title=$2,description=$3,updated_at=now() WHERE id=$1',
            [listingId, content.title, content.description],
          )
        }
      } else {
        await client.query(
          `INSERT INTO housing.listings(id,property_id,unit_id,listing_type,title,description,source_type,source_listing_id,status,attributes)
          VALUES($1,$2,$3,'rent',$4,$5,'user',$6,'inactive',$7)`,
          [
            listingId,
            propertyId,
            room!.id,
            content.title,
            content.description,
            'self:' + listingId,
            { self_service: true, create_request_id: input.request_id },
          ],
        )
        await client.query('INSERT INTO housing.managed_listings(listing_id,created_by) VALUES($1,$2)', [
          listingId,
          user,
        ])
      }
      const offer = (
        await client.query(
          'SELECT * FROM housing.offers WHERE listing_id=$1 AND is_active ORDER BY valid_from DESC LIMIT 1',
          [listingId],
        )
      ).rows[0]
      const date = offer?.availability_from
        ? new Date(offer.availability_from).toISOString().slice(0, 10)
        : null
      if (
        !offer ||
        Number(offer.price_amount) !== content.rent_vnd ||
        (offer.deposit_amount === null ? null : Number(offer.deposit_amount)) !== content.deposit_vnd ||
        date !== content.availability_from
      ) {
        changed = true
        await client.query(
          'UPDATE housing.offers SET is_active=false,valid_to=now() WHERE listing_id=$1 AND is_active',
          [listingId],
        )
        await client.query(
          `INSERT INTO housing.offers(listing_id,price_amount,currency,price_period,deposit_amount,availability_from,is_active) VALUES($1,$2,'VND','month',$3,$4,true)`,
          [listingId, content.rent_vnd, content.deposit_vnd, content.availability_from],
        )
      }
      const oldFees = (
        await client.query(
          'SELECT code,label,amount::float,billing_unit,required,refundable FROM housing.listing_fees WHERE listing_id=$1 AND valid_to IS NULL ORDER BY code',
          [listingId],
        )
      ).rows
      const fees = [...content.fees].sort((a, b) => a.code.localeCompare(b.code))
      if (!isDeepStrictEqual(oldFees, fees)) {
        changed = true
        await replaceFees(client, listingId, content.fees)
      }
      if (changed)
        await client.query(
          'UPDATE housing.managed_listings SET revision=revision+1,updated_at=now() WHERE listing_id=$1',
          [listingId],
        )
      const result = await revisionOf(client, listingId)
      return {
        status: existing ? 200 : 201,
        body: { id: listingId, unit_id: room!.id, unit_revision: room!.revision, ...result },
      }
    }).catch((error: { code?: string }) => {
      if (error.code === '23505') throw new ManagementError(409, 'Mã phòng đã tồn tại trong nhà này.')
      throw error
    })
    return reply.status(outcome.status).send(outcome.body)
  }
  app.post('/v1/landlord/properties/:propertyId/room-listing', saveRoomListing)
  app.put('/v1/landlord/units/:unitId/room-listing', saveRoomListing)

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
    const user = actor(request),
      unitId = Id.parse((request.params as { unitId: string }).unitId)
    const input = UnitUpdate.parse(request.body)
    return withTransaction(pool, async client => {
      const current = (
        await client.query(
          'SELECT property_id,revision FROM housing.units WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',
          [unitId],
        )
      ).rows[0]
      if (!current) throw new ManagementError(404, 'Không tìm thấy phòng.')
      await member(client, user, String(current.property_id))
      if (current.revision !== input.revision)
        throw new ManagementError(409, 'Phòng đã được cập nhật. Hãy tải lại.', 'revision_conflict')
      const result = await client.query(
        `UPDATE housing.units SET unit_code=COALESCE($2,unit_code),
        bedrooms=CASE WHEN $3 THEN $4 ELSE bedrooms END,bathrooms=CASE WHEN $5 THEN $6 ELSE bathrooms END,
        area_m2=CASE WHEN $7 THEN $8 ELSE area_m2 END,amenities=COALESCE($9,amenities),revision=revision+1,updated_at=now()
        WHERE id=$1 RETURNING *`,
        [
          unitId,
          input.unit_code ?? null,
          input.bedrooms !== undefined,
          input.bedrooms ?? null,
          input.bathrooms !== undefined,
          input.bathrooms ?? null,
          input.area_m2 !== undefined,
          input.area_m2 ?? null,
          input.amenities ?? null,
        ],
      )
      return result.rows[0]
    })
  })

  app.post('/v1/landlord/units/:unitId/listing', async (request, reply) => {
    const user = actor(request)
    const unitId = Id.parse((request.params as { unitId: string }).unitId)
    const owner = await pool.query(
      'SELECT property_id FROM housing.units WHERE id=$1 AND deleted_at IS NULL',
      [unitId],
    )
    if (!owner.rows[0]) throw new ManagementError(404, 'Không tìm thấy phòng.')
    await member(pool, user, String(owner.rows[0].property_id))
    const input = ListingInput.parse(request.body)
    const listingId = randomUUID()
    const outcome = await withTransaction(pool, async client => {
      await client.query('SELECT id FROM housing.units WHERE id=$1 FOR UPDATE', [unitId])
      const prior = await client.query(
        `SELECT l.id,l.attributes,ml.publication_status,ml.revision FROM housing.listings l
        JOIN housing.managed_listings ml ON ml.listing_id=l.id WHERE l.unit_id=$1 AND l.deleted_at IS NULL`,
        [unitId],
      )
      if (prior.rows[0]) {
        if (input.request_id && prior.rows[0].attributes.create_request_id === input.request_id) {
          return {
            status: 200,
            body: {
              id: prior.rows[0].id,
              publication_status: prior.rows[0].publication_status,
              revision: prior.rows[0].revision,
              reused: true,
            },
          }
        }
        throw new ManagementError(409, 'Phòng này đã có tin. Hãy mở tin hiện có để chỉnh sửa.')
      }
      // source_type 'user' is the read contract's value for user-submitted listings; the
      // self_service attribute marks owner-managed rows. Other values break public detail parsing.
      await client.query(
        `INSERT INTO housing.listings(id,property_id,unit_id,listing_type,title,description,source_type,source_listing_id,status,attributes)
         VALUES($1,$2,$3,'rent',$4,$5,'user',$6,'inactive',$7)`,
        [
          listingId,
          owner.rows[0].property_id,
          unitId,
          input.title,
          input.description,
          `self:${listingId}`,
          { self_service: true, create_request_id: input.request_id ?? null },
        ],
      )
      await client.query(
        `INSERT INTO housing.offers(listing_id,price_amount,currency,price_period,deposit_amount,availability_from,is_active)
         VALUES($1,$2,'VND','month',$3,$4,true)`,
        [listingId, input.rent_vnd, input.deposit_vnd, input.availability_from],
      )
      await client.query('INSERT INTO housing.managed_listings(listing_id,created_by) VALUES($1,$2)', [
        listingId,
        user,
      ])
      await replaceFees(client, listingId, input.fees)
      const result = await revisionOf(client, listingId)
      return { status: 201, body: { id: listingId, ...result } }
    })
    return reply.status(outcome.status).send(outcome.body)
  })

  app.patch('/v1/landlord/listings/:listingId', async request => {
    const user = actor(request),
      listingId = Id.parse((request.params as { listingId: string }).listingId)
    const input = ListingUpdate.parse(request.body)
    return withTransaction(pool, async client => {
      const row = await lockedListing(client, user, listingId, input.revision)
      if (row.publication_status === 'deleted') throw new ManagementError(409, 'Tin đã được xóa.')
      if (input.title !== undefined || input.description !== undefined)
        await client.query(
          `UPDATE housing.listings SET title=COALESCE($2,title),description=COALESCE($3,description),updated_at=now() WHERE id=$1`,
          [listingId, input.title ?? null, input.description ?? null],
        )
      if (input.rent_vnd !== undefined || input.deposit_vnd !== undefined || input.availability_from !== undefined) {
        const prior = (
          await client.query(
            `SELECT * FROM housing.offers WHERE listing_id=$1 AND is_active ORDER BY valid_from DESC LIMIT 1`,
            [listingId],
          )
        ).rows[0]
        const rent = input.rent_vnd ?? Number(prior?.price_amount ?? 0)
        const deposit = input.deposit_vnd === undefined ? (prior?.deposit_amount ?? null) : input.deposit_vnd
        const available =
          input.availability_from === undefined ? (prior?.availability_from ?? null) : input.availability_from
        const oldDate = prior?.availability_from ? new Date(prior.availability_from).toISOString().slice(0, 10) : null
        if (
          !prior ||
          rent !== Number(prior.price_amount) ||
          Number(deposit ?? 0) !== Number(prior.deposit_amount ?? 0) ||
          (deposit === null) !== (prior.deposit_amount === null) ||
          available !== oldDate
        ) {
          await client.query(
            'UPDATE housing.offers SET is_active=false,valid_to=now() WHERE listing_id=$1 AND is_active',
            [listingId],
          )
          await client.query(
            `INSERT INTO housing.offers(listing_id,price_amount,currency,price_period,deposit_amount,availability_from,is_active)
            VALUES($1,$2,'VND','month',$3,$4,true)`,
            [listingId, rent, deposit, available],
          )
        }
      }
      if (input.fees) {
        const old = await client.query(
          `SELECT code,label,amount::float,billing_unit,required,refundable FROM housing.listing_fees
          WHERE listing_id=$1 AND valid_to IS NULL ORDER BY code`,
          [listingId],
        )
        const fees = [...input.fees].sort((a, b) => a.code.localeCompare(b.code))
        if (JSON.stringify(old.rows) !== JSON.stringify(fees)) await replaceFees(client, listingId, input.fees)
      }
      await client.query(
        'UPDATE housing.managed_listings SET revision=revision+1,updated_at=now() WHERE listing_id=$1',
        [listingId],
      )
      const result = await revisionOf(client, listingId)
      return { id: listingId, ...result }
    })
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
       WHERE l.id=$1 AND l.deleted_at IS NULL`,
      [listingId],
    )
    if (!listing.rows[0]) throw new ManagementError(404, 'Không tìm thấy tin nhà.')
    const [fees, media] = await Promise.all([
      pool.query(
        `SELECT id,code,label,amount::float,billing_unit,required,refundable FROM housing.listing_fees
        WHERE listing_id=$1 AND valid_to IS NULL ORDER BY required DESC,label`,
        [listingId],
      ),
      pool.query(
        `SELECT id,url,alt_text,position,is_primary,moderation_status FROM housing.listing_media
        WHERE listing_id=$1 AND deleted_at IS NULL ORDER BY position,id`,
        [listingId],
      ),
    ])
    const issues = await import('./housing-policy.js').then(policy => policy.listingIssues(pool, listingId))
    return { ...listing.rows[0], fees: fees.rows, media: media.rows, issues }
  })

  app.post('/v1/landlord/listings/:listingId/hide', async request => {
    const user = actor(request),
      listingId = Id.parse((request.params as { listingId: string }).listingId)
    const input = z.object({ revision: Revision }).parse(request.body)
    return withTransaction(pool, async client => {
      const row = await lockedListing(client, user, listingId, input.revision)
      await member(client, user, String(row.property_id), true)
      if (!['published', 'pending_review'].includes(row.publication_status))
        throw new ManagementError(409, 'Tin không còn có thể ẩn.')
      await client.query(
        `UPDATE housing.managed_listings SET publication_status='hidden',revision=revision+1,updated_at=now() WHERE listing_id=$1`,
        [listingId],
      )
      const result = await revisionOf(client, listingId)
      return { id: listingId, ...result }
    })
  })

  app.delete('/v1/landlord/listings/:listingId', async request => {
    const user = actor(request),
      listingId = Id.parse((request.params as { listingId: string }).listingId)
    const input = z.object({ revision: Revision }).parse(request.body)
    return withTransaction(pool, async client => {
      const row = await lockedListing(client, user, listingId, input.revision)
      await member(client, user, String(row.property_id), true)
      await client.query(
        `UPDATE housing.managed_listings SET publication_status='deleted',revision=revision+1,updated_at=now() WHERE listing_id=$1`,
        [listingId],
      )
      await client.query(
        `UPDATE housing.listings SET status='inactive',deleted_at=now(),updated_at=now() WHERE id=$1`,
        [listingId],
      )
      const result = await revisionOf(client, listingId)
      return { id: listingId, ...result }
    })
  })

  app.post('/v1/landlord/listings/:listingId/media', async (request, reply) => {
    const user = actor(request),
      listingId = Id.parse((request.params as { listingId: string }).listingId)
    const input = MediaInput.parse(request.body)
    const mediaUrl = new URL(input.url)
    if (
      !['http:', 'https:'].includes(mediaUrl.protocol) ||
      !/^\/web\/media\/housing\/[a-f0-9]{40}\.png$/.test(mediaUrl.pathname) ||
      mediaUrl.search ||
      mediaUrl.hash
    )
      throw new ManagementError(422, 'Đường dẫn ảnh không hợp lệ.')
    const expected = createHmac('sha256', process.env.AGENT_API_TOKEN || '')
      .update(`${listingId}\n${input.url}\n${input.content_sha256}`)
      .digest('hex')
    if (!equalSecret(String(request.headers['x-housing-media-signature'] || ''), expected))
      throw new ManagementError(403, 'Ảnh phải được tải qua dịch vụ upload đã kiểm tra.')
    const outcome = await withTransaction(pool, async client => {
      const row = await lockedListing(client, user, listingId)
      if (row.publication_status === 'deleted') throw new ManagementError(409, 'Tin đã được xóa.')
      const existing = await client.query(
        `SELECT id,url,alt_text,moderation_status FROM housing.listing_media
        WHERE listing_id=$1 AND content_sha256=$2 AND deleted_at IS NULL`,
        [listingId, input.content_sha256],
      )
      if (existing.rows[0]) return { status: 200, body: existing.rows[0] }
      const count = await client.query(
        'SELECT count(*)::int AS count FROM housing.listing_media WHERE listing_id=$1 AND deleted_at IS NULL',
        [listingId],
      )
      if (count.rows[0].count >= 30) throw new ManagementError(422, 'Mỗi tin hỗ trợ tối đa 30 ảnh.')
      const result = await client.query(
        `INSERT INTO housing.listing_media(listing_id,url,alt_text,source_type,position,
        moderation_status,uploaded_by,content_sha256,storage_key,is_primary)
        VALUES($1,$2,$3,'self_service',COALESCE((SELECT max(position)+1 FROM housing.listing_media WHERE listing_id=$1),0),
        'pending',$4,$5,$6,NOT EXISTS(SELECT 1 FROM housing.listing_media WHERE listing_id=$1 AND deleted_at IS NULL))
        RETURNING id,url,alt_text,moderation_status`,
        [
          listingId,
          input.url,
          input.alt,
          user,
          input.content_sha256,
          new URL(input.url).pathname.split('/').pop(),
        ],
      )
      return { status: 201, body: result.rows[0] }
    })
    return reply.status(outcome.status).send(outcome.body)
  })

  app.post('/v1/landlord/listings/:listingId/submit', async request => {
    const user = actor(request),
      listingId = Id.parse((request.params as { listingId: string }).listingId)
    const input = z.object({ revision: Revision }).parse(request.body)
    return withTransaction(pool, async client => {
      const row = await lockedListing(client, user, listingId, input.revision)
      await member(client, user, String(row.property_id), true)
      await requireHostProfile(client, user)
      if (!['draft', 'rejected', 'hidden'].includes(row.publication_status))
        throw new ManagementError(409, 'Tin không thể gửi duyệt ở trạng thái hiện tại.')
      if (row.publication_status === 'rejected') {
        // Every owner edit bumps the revision; the rejection itself left it at reviewed+1.
        const rejection = (
          await client.query(
            `SELECT reviewed_revision FROM housing.listing_reviews
             WHERE listing_id=$1 AND decision='reject' ORDER BY created_at DESC LIMIT 1`,
            [listingId],
          )
        ).rows[0]
        if (rejection && row.revision === rejection.reviewed_revision + 1)
          throw new ManagementError(409, 'Bạn phải bổ sung thêm thông tin phù hợp.', 'listing_unchanged')
      }
      await requireCompleteListing(client, listingId)
      await client.query(
        `UPDATE housing.managed_listings SET publication_status='pending_review',revision=revision+1,updated_at=now() WHERE listing_id=$1`,
        [listingId],
      )
      const result = await revisionOf(client, listingId)
      return { id: listingId, ...result }
    })
  })

  app.post('/v1/landlord/listings/:listingId/availability', async request => {
    const user = actor(request),
      listingId = Id.parse((request.params as { listingId: string }).listingId)
    const input = z
      .object({
        status: z.enum(['vacant', 'rented', 'paused']),
        revision: Revision,
      })
      .parse(request.body)
    return withTransaction(pool, async client => {
      const row = await lockedListing(client, user, listingId, input.revision)
      await member(client, user, String(row.property_id), true)
      if (row.publication_status === 'deleted') throw new ManagementError(409, 'Tin đã được xóa.')
      await client.query(
        `UPDATE housing.managed_listings SET availability_status=$2,availability_confirmed_at=now(),
        revision=revision+1,updated_at=now() WHERE listing_id=$1`,
        [listingId, input.status],
      )
      if (input.status === 'rented' && row.availability_status !== 'rented')
        await startRentPeriod(client, listingId, { source: 'manual' })
      else if (input.status !== 'rented' && row.availability_status === 'rented') await endRentPeriod(client, listingId)
      const result = await revisionOf(client, listingId)
      return { id: listingId, availability_status: input.status, ...result }
    })
  })

  app.post('/v1/moderation/housing/properties/:propertyId/approve', async request => {
    const user = actor(request)
    if (!moderator(user)) throw new ManagementError(403, 'Moderator permission is required.')
    const propertyId = Id.parse((request.params as { propertyId: string }).propertyId)
    const input = z.object({ revision: Revision }).parse(request.body)
    return withTransaction(pool, async client => {
      await notOwnProperty(client, user, propertyId)
      const property = (
        await client.query(
          'SELECT revision,location_confirmed_at FROM housing.properties WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',
          [propertyId],
        )
      ).rows[0]
      if (!property || property.revision !== input.revision)
        throw new ManagementError(
          409,
          'Địa điểm đã thay đổi. Hãy tải lại trước khi duyệt.',
          'revision_conflict',
        )
      if (!property.location_confirmed_at)
        throw new ManagementError(
          409,
          'Địa điểm chưa được xác nhận trên bản đồ.',
          'location_confirmation_required',
        )
      const pending = await client.query(
        `SELECT user_id FROM housing.management_members WHERE property_id=$1 AND status='pending' FOR UPDATE`,
        [propertyId],
      )
      await requireVerifiedHosts(
        client,
        pending.rows.map(r => String(r.user_id)),
      )
      const result = await client.query(
        `UPDATE housing.management_members SET status='active',reviewed_at=now(),reviewed_by=$2,revision=revision+1
        WHERE property_id=$1 AND status='pending'`,
        [propertyId, user],
      )
      if (!result.rowCount) throw new ManagementError(409, 'Địa điểm không còn chờ duyệt.')
      return { property_id: propertyId, status: 'active' }
    })
  })

  app.get('/v1/moderation/housing/queue', async request => {
    const user = actor(request)
    if (!moderator(user)) throw new ManagementError(403, 'Moderator permission is required.')
    const properties = await pool.query(
      `SELECT p.id,p.name,p.property_type,cp.address,mm.user_id,mm.requested_at,
         hp.status AS host_status,hp.display_name AS host_name,hp.poster_type,p.revision,p.location_metadata,p.location_confirmed_at,ST_X(cp.geom)::float AS lng,ST_Y(cp.geom)::float AS lat
       FROM housing.management_members mm JOIN housing.properties p ON p.id=mm.property_id
       JOIN catalog.places cp ON cp.id=p.place_id LEFT JOIN housing.host_profiles hp ON hp.user_id=mm.user_id
       WHERE mm.status='pending' ORDER BY mm.requested_at`,
    )
    const listings = await pool.query(
      `SELECT l.id,l.title,l.description,p.name AS property_name,cp.address,u.unit_code,ml.created_by,ml.updated_at,ml.revision,ml.publication_status,
         o.price_amount::float AS rent_vnd,o.deposit_amount::float AS deposit_vnd,
         (SELECT count(*)::int FROM housing.listing_fees f WHERE f.listing_id=l.id AND f.valid_to IS NULL) AS fee_count,
         (SELECT coalesce(json_agg(json_build_object('url',m.url,'alt',m.alt_text) ORDER BY m.position),'[]'::json)
            FROM housing.listing_media m WHERE m.listing_id=l.id AND m.moderation_status='pending' AND m.deleted_at IS NULL) AS pending_media,
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
         hp.tax_code,hp.updated_at,hp.revision,(hp.user_id <> $1) AS can_review,
         (SELECT count(*)::int FROM housing.management_members mm WHERE mm.user_id=hp.user_id AND mm.status='pending') AS pending_properties,
         (SELECT count(*)::int FROM housing.managed_listings ml WHERE ml.created_by=hp.user_id AND ml.publication_status='pending_review') AS pending_listings
       FROM housing.host_profiles hp WHERE hp.status='pending' ORDER BY hp.updated_at`,
      [user],
    )
    return {
      hosts: hosts.rows,
      properties: properties.rows,
      listings: listings.rows,
    }
  })

  app.post('/v1/moderation/housing/listings/:listingId/review', async request => {
    const user = actor(request)
    if (!moderator(user)) throw new ManagementError(403, 'Moderator permission is required.')
    const listingId = Id.parse((request.params as { listingId: string }).listingId)
    const input = z
      .object({
        decision: z.enum(['approve', 'reject']),
        revision: Revision,
        reason: z.string().trim().max(500).optional(),
      })
      .parse(request.body)
    if (input.decision === 'reject' && !input.reason)
      throw new ManagementError(422, 'Hãy nhập lý do từ chối.', 'rejection_reason_required')
    return withTransaction(pool, async client => {
      const row = (
        await client.query(
          `SELECT ml.*,l.property_id FROM housing.managed_listings ml JOIN housing.listings l ON l.id=ml.listing_id
        WHERE ml.listing_id=$1 AND l.deleted_at IS NULL FOR UPDATE OF ml,l`,
          [listingId],
        )
      ).rows[0]
      if (!row) throw new ManagementError(404, 'Không tìm thấy tin nhà.')
      if (row.created_by === user) throw new ManagementError(403, 'Không thể tự duyệt tin của mình.')
      await notOwnProperty(client, user, String(row.property_id))
      if (row.revision !== input.revision || row.publication_status !== 'pending_review')
        throw new ManagementError(409, 'Tin đã thay đổi hoặc không còn chờ duyệt.', 'revision_conflict')
      const approved = input.decision === 'approve'
      if (approved) {
        await requireVerifiedHosts(client, [String(row.created_by)])
        await member(client, String(row.created_by), String(row.property_id), true)
        await requireCompleteListing(client, listingId)
        await client.query(
          `UPDATE housing.listing_media SET moderation_status='approved' WHERE listing_id=$1 AND deleted_at IS NULL AND moderation_status='pending'`,
          [listingId],
        )
      }
      await client.query(
        `UPDATE housing.managed_listings SET publication_status=$2,reviewed_at=now(),reviewed_by=$3,
        rejection_reason=$4,approved_revision=CASE WHEN $5 THEN revision+1 ELSE NULL END,
        revision=revision+1,updated_at=now() WHERE listing_id=$1`,
        [listingId, approved ? 'published' : 'rejected', user, approved ? null : input.reason, approved],
      )
      if (approved)
        await client.query(
          `UPDATE housing.listings l SET verification_status='lifeflow_verified',verified_at=now(),verified_by=$2,
        published_at=COALESCE(published_at,now()),attributes=l.attributes || jsonb_build_object('location_accuracy','approximate',
        'location_method',CASE WHEN p.location_metadata->>'source'='vietmap' THEN 'vietmap_place_v4' ELSE 'legacy_review' END)
        FROM housing.properties p WHERE l.id=$1 AND p.id=l.property_id`,
          [listingId, user],
        )
      await client.query(
        `INSERT INTO housing.listing_reviews(listing_id,actor_id,decision,reason,reviewed_revision) VALUES($1,$2,$3,$4,$5)`,
        [listingId, user, input.decision, input.reason || null, input.revision],
      )
      const result = await revisionOf(client, listingId)
      return { id: listingId, ...result }
    })
  })

  app.post('/v1/housing/:listingId/contact-requests', async (request, reply) => {
    const user = actor(request)
    const listingId = Id.parse((request.params as { listingId: string }).listingId)
    const input = ContactInput.parse(request.body)
    await notOwnContact(pool, user, listingId)
    const eligible = await pool.query(
      `SELECT 1 FROM housing.managed_listings ml JOIN housing.listings l ON l.id=ml.listing_id
       WHERE ml.listing_id=$1 AND ml.publication_status='published' AND ml.availability_status='vacant' AND l.status='active'
         AND EXISTS(SELECT 1 FROM housing.managed_listing_visibility v WHERE v.listing_id=l.id AND v.is_public)`,
      [listingId],
    )
    if (!eligible.rowCount) throw new ManagementError(409, 'Tin hiện không nhận yêu cầu liên hệ.')
    try {
      const result = await pool.query(
        `INSERT INTO housing.contact_requests(listing_id,tenant_user_id,message,landlord_activity_at) VALUES($1,$2,$3,now())
         RETURNING id,status,revision,created_at`,
        [listingId, user, input.message],
      )
      await pool.query(
        `INSERT INTO housing.listing_events(listing_id,actor_id,event_type,dedup_key)
         VALUES($1,$2,'contact_request',$3) ON CONFLICT DO NOTHING`,
        [listingId, user, `contact:${result.rows[0].id}`],
      )
      return reply.status(201).send(result.rows[0])
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        throw new ManagementError(409, 'Bạn đã có yêu cầu đang được xử lý cho tin này.')
      throw error
    }
  })

  app.get('/v1/landlord/contact-requests', async request => {
    const user = actor(request)
    const result = await pool.query(
      `SELECT cr.id,cr.listing_id,cr.tenant_user_id,cr.message,cr.status,cr.revision,cr.created_at,cr.updated_at,l.title,u.id AS unit_id,u.unit_code,p.id AS property_id,p.name AS property_name,
         cr.viewing_slot,cr.viewing_status,cr.viewing_options,cr.source,
         cr.landlord_activity_at>coalesce(cr.landlord_activity_read_at,'epoch') AS update_unread,
         (SELECT to_jsonb(r) FROM housing.rent_payment_reports r WHERE r.request_id=cr.id ORDER BY created_at DESC,id DESC LIMIT 1) AS payment_report,${unreadFor('landlord')}
       FROM housing.contact_requests cr JOIN housing.listings l ON l.id=cr.listing_id
       LEFT JOIN housing.units u ON u.id=l.unit_id JOIN housing.properties p ON p.id=l.property_id
       JOIN housing.management_members mm ON mm.property_id=p.id AND mm.user_id=$1 AND mm.status='active'
       WHERE NOT EXISTS(SELECT 1 FROM housing.contact_archives a WHERE a.request_id=cr.id AND a.user_id=$1)
       ORDER BY (cr.viewing_status='requested') DESC,(cr.status='new') DESC,cr.created_at DESC`,
      [user],
    )
    return { items: result.rows }
  })

  app.get('/v1/housing/contact-requests/me', async request => {
    const user = actor(request)
    const result = await pool.query(
      `SELECT cr.id,cr.listing_id,cr.message,cr.status,cr.revision,cr.created_at,cr.updated_at,l.title,
         cr.viewing_slot,cr.viewing_status,cr.viewing_options,cr.viewing_updated_at,cr.source,
         cr.tenant_activity_at>coalesce(cr.tenant_activity_read_at,'epoch') AS update_unread,
         (SELECT to_jsonb(r) FROM housing.rent_payment_reports r WHERE r.request_id=cr.id ORDER BY created_at DESC,id DESC LIMIT 1) AS payment_report,${unreadFor('tenant')}
       FROM housing.contact_requests cr JOIN housing.listings l ON l.id=cr.listing_id
       WHERE cr.tenant_user_id=$1 ORDER BY cr.created_at DESC`,
      [user],
    )
    return { items: result.rows }
  })

  // Viewing time from the tenant's "Xem nhà" tab (viewing-landlord-confirmation §3). Idempotent: the
  // gateway re-sends the current slot after every viewing step; an unchanged slot changes nothing.
  app.put('/v1/housing/:listingId/viewing', async (request, reply) => {
    const user = actor(request)
    const listingId = Id.parse((request.params as { listingId: string }).listingId)
    const input = ViewingInput.parse(request.body)
    await notOwnContact(pool, user, listingId)
    const slot = new Date(input.slot)
    if (slot.getTime() <= Date.now()) throw new ManagementError(422, 'Giờ xem đã qua.')
    const eligible = await pool.query(
      `SELECT 1 FROM housing.managed_listings ml JOIN housing.listings l ON l.id=ml.listing_id
       WHERE ml.listing_id=$1 AND ml.publication_status='published' AND ml.availability_status='vacant' AND l.status='active'
         AND EXISTS(SELECT 1 FROM housing.managed_listing_visibility v WHERE v.listing_id=l.id AND v.is_public)`,
      [listingId],
    )
    if (!eligible.rowCount) throw new ManagementError(409, 'Tin này không nhận lịch xem qua ReloHome.', 'not_managed')
    const open = await pool.query(
      `SELECT id,revision,viewing_slot,viewing_status,viewing_options FROM housing.contact_requests
       WHERE listing_id=$1 AND tenant_user_id=$2 AND status IN ('new','contacted','viewing')`,
      [listingId, user],
    )
    const current = open.rows[0]
    const options = current?.viewing_options as string[] | undefined
    if (options?.length && !options.some(value => new Date(value).getTime() === slot.getTime())) {
      throw new ManagementError(409, 'Hãy chọn một trong các giờ chủ nhà đề xuất.', 'viewing_option_required')
    }
    const sameSlot = current?.viewing_slot && new Date(current.viewing_slot).getTime() === slot.getTime()
    // A slot the landlord already answered stays answered; the tenant has to pick a different time.
    if (current && sameSlot && ['requested', 'confirmed', 'declined'].includes(current.viewing_status)) {
      return {
        id: current.id,
        viewing_status: current.viewing_status,
        changed: false,
      }
    }
    if (current) {
      const updated = await pool.query(
        `UPDATE housing.contact_requests SET viewing_slot=$2,viewing_status='requested',viewing_updated_at=now(),
           revision=revision+1,source='viewing',updated_at=now(),landlord_activity_at=now() WHERE id=$1 AND revision=$3 AND status IN ('new','contacted','viewing')
             AND NOT EXISTS(SELECT 1 FROM housing.rent_payment_reports r WHERE r.request_id=$1 AND r.status IN ('pending','confirmed'))
             AND (jsonb_array_length(viewing_options)=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(viewing_options) option WHERE option::timestamptz=$2::timestamptz))
           RETURNING id,viewing_status`,
        [current.id, slot, current.revision],
      )
      if (!updated.rowCount) throw new ManagementError(409, 'Lịch hoặc báo cáo chuyển tiền đã thay đổi; hãy tải lại.')
      return { ...updated.rows[0], changed: true }
    }
    try {
      const created = await pool.query(
        `INSERT INTO housing.contact_requests(listing_id,tenant_user_id,message,viewing_slot,viewing_status,viewing_updated_at,source,landlord_activity_at)
         VALUES($1,$2,'Người thuê đặt lịch xem nhà qua ReloHome.',$3,'requested',now(),'viewing',now()) RETURNING id,viewing_status`,
        [listingId, user, slot],
      )
      await pool.query(
        `INSERT INTO housing.listing_events(listing_id,actor_id,event_type,dedup_key)
         VALUES($1,$2,'contact_request',$3) ON CONFLICT DO NOTHING`,
        [listingId, user, `contact:${created.rows[0].id}`],
      )
      return reply.status(201).send({ ...created.rows[0], changed: true })
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        throw new ManagementError(409, 'Yêu cầu vừa được tạo ở nơi khác; hãy thử lại.')
      throw error
    }
  })

  app.delete('/v1/housing/:listingId/viewing', async request => {
    const user = actor(request)
    const listingId = Id.parse((request.params as { listingId: string }).listingId)
    return withTransaction(pool, async client => {
      await client.query(
        "SELECT id FROM housing.contact_requests WHERE listing_id=$1 AND tenant_user_id=$2 AND status IN ('new','contacted','viewing') FOR UPDATE",
        [listingId, user],
      )
      const pending = await client.query(
        `SELECT 1 FROM housing.rent_payment_reports r JOIN housing.contact_requests cr ON cr.id=r.request_id
        WHERE cr.listing_id=$1 AND cr.tenant_user_id=$2 AND r.status IN ('pending','confirmed')`,
        [listingId, user],
      )
      if (pending.rowCount)
        throw new ManagementError(409, 'Báo cáo chuyển tiền đang chờ hoặc đã xác nhận; không hủy lịch này.')
      const result = await client.query(
        `UPDATE housing.contact_requests SET viewing_status='cancelled',viewing_updated_at=now(),
         status=CASE WHEN source='viewing' AND status='new' THEN 'declined' ELSE status END,
         revision=revision+1,updated_at=now(),landlord_activity_at=now()
         WHERE listing_id=$1 AND tenant_user_id=$2 AND status IN ('new','contacted','viewing')
         AND viewing_status IN ('requested','confirmed','declined')
       RETURNING id,status,viewing_status`,
        [listingId, user],
      )
      return { changed: Boolean(result.rowCount), ...(result.rows[0] || {}) }
    })
  })

  app.post('/v1/landlord/contact-requests/:requestId/viewing', async request => {
    const user = actor(request)
    const requestId = Id.parse((request.params as { requestId: string }).requestId)
    const input = ViewingDecision.parse(request.body)
    if (input.decision === 'decline')
      throw new ManagementError(422, 'Hãy đề xuất giờ thay thế trong 7 ngày tới.', 'viewing_options_required')
    const confirmed = input.decision === 'confirm'
    const result = await pool.query(
      `UPDATE housing.contact_requests cr SET viewing_status=$2,viewing_updated_at=now(),
         status=CASE WHEN $2='confirmed' THEN 'viewing' ELSE cr.status END,revision=cr.revision+1,updated_at=now(),tenant_activity_at=now()
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
    const readAt = new Date()
    const messages = await pool.query(
      `SELECT id,sender_role,sender_user_id,body,created_at FROM housing.contact_messages WHERE request_id=$1 ORDER BY created_at,id`,
      [requestId],
    )
    await pool.query(
      `UPDATE housing.contact_requests SET ${conversation.role}_read_at=$2,${conversation.role}_activity_read_at=$2 WHERE id=$1`,
      [requestId, readAt],
    )
    return {
      role: conversation.role,
      viewer_id: user,
      counterparty_user_id: conversation.counterparty_user_id,
      counterparty_read_at: conversation.role === 'tenant' ? conversation.landlord_read_at : conversation.tenant_read_at,
      request: {
        id: conversation.id,
        listing_id: conversation.listing_id,
        tenant_user_id: conversation.tenant_user_id,
        title: conversation.title,
        status: conversation.status,
        revision: conversation.revision,
        message: conversation.message,
        created_at: conversation.created_at,
        viewing_slot: conversation.viewing_slot,
        viewing_status: conversation.viewing_status,
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
    if (conversation.role === 'tenant') await notOwnContact(pool, user, String(conversation.listing_id))
    const recent = await pool.query(
      `SELECT count(*)::int AS n FROM housing.contact_messages
       WHERE request_id=$1 AND sender_user_id=$2 AND created_at > now() - interval '1 minute'`,
      [requestId, user],
    )
    if (recent.rows[0].n >= messageRate())
      throw new ManagementError(429, 'Bạn gửi hơi nhanh; chờ một chút rồi gửi tiếp.')
    const created = await pool.query(
      `INSERT INTO housing.contact_messages(request_id,sender_role,sender_user_id,body) VALUES($1,$2,$3,$4)
       RETURNING id,sender_role,sender_user_id,body,created_at`,
      [requestId, conversation.role, user, input.body],
    )
    // The landlord's first reply means the request has been answered.
    await pool.query(
      `UPDATE housing.contact_requests SET ${conversation.role}_read_at=now(),updated_at=now(),
         ${conversation.role === 'tenant' ? 'landlord' : 'tenant'}_activity_at=now(),
         status=CASE WHEN $2='landlord' AND status='new' THEN 'contacted' ELSE status END,
         revision=CASE WHEN $2='landlord' AND status='new' THEN revision+1 ELSE revision END
       WHERE id=$1`,
      [requestId, conversation.role],
    )
    return reply.status(201).send(created.rows[0])
  })

  app.post('/v1/housing/contact-requests/:requestId/cancel', async request => {
    const user = actor(request)
    const requestId = Id.parse((request.params as { requestId: string }).requestId)
    const input = z.object({ revision: Revision }).parse(request.body)
    const result = await pool.query(
      `UPDATE housing.contact_requests SET status='declined',viewing_status=CASE WHEN viewing_slot IS NOT NULL THEN 'cancelled' ELSE viewing_status END,revision=revision+1,updated_at=now(),landlord_activity_at=now()
       WHERE id=$1 AND tenant_user_id=$2 AND revision=$3
         AND (status IN ('new','contacted') OR (status='viewing' AND viewing_slot IS NOT NULL))
         AND NOT EXISTS(SELECT 1 FROM housing.rent_payment_reports r WHERE r.request_id=$1 AND r.status IN ('pending','confirmed'))
       RETURNING id,status,revision,updated_at`,
      [requestId, user, input.revision],
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
         AND cr.source='contact' AND cr.viewing_status IS NULL
         AND NOT EXISTS(SELECT 1 FROM housing.rent_payment_reports r WHERE r.request_id=cr.id)
       RETURNING cr.id,cr.status,cr.revision,cr.updated_at`,
      [requestId, input.status, user, input.revision],
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
       ON CONFLICT DO NOTHING`,
      [listingId, user, input.event_type, input.dedup_key],
    )
    return { recorded: true }
  })
}
