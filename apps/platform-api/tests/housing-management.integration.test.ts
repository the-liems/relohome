// SPEC-021 business rules against the real PostGIS schema (needs a migrated local database).
// Every row created here belongs to random test actors and is removed with the admin role afterwards.
import { createHash, createHmac, randomUUID } from 'node:crypto'
import { createDatabasePool, getRuntimeConfig } from '@relohome/housing-query'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { signLocation } from '../src/housing-location.js'

const run = randomUUID().slice(0, 8)
const OWNER = `test-owner-${run}`
const OTHER = `test-other-${run}`
const TENANT = `test-tenant-${run}`
const MODERATOR = `test-moderator-${run}`
const TOKEN = `test-token-${run}`

let app: FastifyInstance
let pool: ReturnType<typeof createDatabasePool>
let admin: ReturnType<typeof createDatabasePool>
const created: string[] = []

async function call(user: string, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) {
  let extraHeaders: Record<string, string> = {}
  const body = payload as Record<string, unknown> | undefined
  if (method === 'POST' && body && body.revision === undefined) {
    const listingMatch = url.match(/\/listings\/([^/]+)\/(submit|review)$/)
    const propertyMatch = url.match(/\/properties\/([^/]+)\/approve$/)
    const hostMatch = url.match(/\/host\/([^/]+)\/review$/)
    const current = listingMatch
      ? await admin.query('SELECT revision FROM housing.managed_listings WHERE listing_id=$1', [listingMatch[1]])
      : propertyMatch
        ? await admin.query('SELECT revision FROM housing.properties WHERE id=$1', [propertyMatch[1]])
        : hostMatch
          ? await admin.query('SELECT revision FROM housing.host_profiles WHERE user_id=$1', [hostMatch[1]])
          : null
    if (current?.rows[0]) payload = { ...body, revision: current.rows[0].revision }
  }
  if (method === 'POST' && url.endsWith('/media') && body) {
    const id = url.split('/')[4]!
    extraHeaders = {
      'x-housing-media-signature': createHmac('sha256', TOKEN)
        .update(`${id}\n${body.url}\n${body.content_sha256}`)
        .digest('hex'),
    }
  }
  const response = await app.inject({
    method,
    url,
    payload: payload as never,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'x-user-id': user,
      ...extraHeaders,
    },
  })
  return {
    status: response.statusCode,
    body: response.body ? response.json() : null,
  }
}

async function host(user: string, poster_type = 'owner') {
  const existing = (await call(user, 'GET', '/v1/host/profile')).body.profile
  if (existing) return existing
  const result = await call(user, 'PUT', '/v1/host/profile', {
    poster_type,
    display_name: `Người đăng ${run}`,
    legal_name: `Nguyễn Văn ${run}`,
    phone: '0901 234 567',
  })
  expect(result.status, JSON.stringify(result.body)).toBe(200)
  return result.body.profile
}

async function property(user: string) {
  const result = await call(user, 'POST', '/v1/landlord/properties', {
    name: `Nhà kiểm thử ${run}`,
    property_type: 'room',
    address: { full_address: `Địa chỉ kiểm thử ${run}` },
    location: { lat: 10.7769, lng: 106.7009 },
    location_confirmed: true,
    location_token: signLocation(user, {
      ref_id: 'test-address',
      address: `Địa chỉ kiểm thử ${run}`,
      location: { lat: 10.7769, lng: 106.7009 },
    }),
  })
  expect(result.status).toBe(201)
  created.push(result.body.id)
  // Owner properties are housing anchors, never POIs on the map layer.
  const place = await admin.query(
    `SELECT cp.attributes->>'entity_role' AS role FROM housing.properties p JOIN catalog.places cp ON cp.id=p.place_id WHERE p.id=$1`,
    [result.body.id],
  )
  expect(place.rows[0].role).toBe('housing_anchor')
  return result.body.id as string
}

async function unit(user: string, propertyId: string, code: string) {
  const result = await call(user, 'POST', `/v1/landlord/properties/${propertyId}/units`, {
    unit_code: code,
    bedrooms: 1,
    bathrooms: 1,
    area_m2: 20,
    amenities: [],
  })
  expect(result.status).toBe(201)
  return result.body.id as string
}

async function listing(user: string, unitId: string, fees: unknown[]) {
  const result = await call(user, 'POST', `/v1/landlord/units/${unitId}/listing`, {
    title: `Phòng kiểm thử ${run}`,
    description: 'Phòng sáng thoáng để kiểm thử.',
    rent_vnd: 4_000_000,
    deposit_vnd: 4_000_000,
    fees,
  })
  expect(result.status).toBe(201)
  const uploaded = await call(user, 'POST', `/v1/landlord/listings/${result.body.id}/media`, {
    url: `http://localhost/web/media/housing/${createHash('sha1').update(result.body.id).digest('hex')}.png`,
    content_sha256: createHash('sha256').update(result.body.id).digest('hex'),
    alt: 'Ảnh kiểm thử',
  })
  expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(201)
  return result.body.id as string
}

beforeAll(async () => {
  process.env.AGENT_API_TOKEN = TOKEN
  process.env.HOUSING_MODERATOR_IDS = MODERATOR
  const config = getRuntimeConfig()
  // Exercise API writes with the deployed application role, not the admin role.
  const applicationUrl = new URL(config.databaseUrl)
  applicationUrl.username = config.postgresAppUser
  applicationUrl.password = config.postgresAppPassword
  pool = createDatabasePool(applicationUrl.toString(), 2)
  admin = createDatabasePool(config.adminDatabaseUrl, 1)
  app = buildApp(pool, config)
  await app.ready()
})

afterAll(async () => {
  await app?.close()
  if (admin && created.length) {
    const places = await admin.query('SELECT place_id FROM housing.properties WHERE id = ANY($1::uuid[])', [created])
    await admin.query(
      'DELETE FROM housing.listing_reviews WHERE listing_id IN(SELECT id FROM housing.listings WHERE property_id=ANY($1::uuid[]))',
      [created],
    )
    await admin.query('DELETE FROM housing.listings WHERE property_id = ANY($1::uuid[])', [created])
    await admin.query('DELETE FROM housing.units WHERE property_id = ANY($1::uuid[])', [created])
    await admin.query('DELETE FROM housing.properties WHERE id = ANY($1::uuid[])', [created])
    await admin.query('DELETE FROM catalog.places WHERE id = ANY($1::uuid[])', [places.rows.map(r => r.place_id)])
  }
  if (admin) await admin.query('DELETE FROM housing.host_profiles WHERE user_id LIKE $1', [`test-%-${run}`])
  await admin?.end() // the app closes its own pool
  delete process.env.AGENT_API_TOKEN
  delete process.env.HOUSING_MODERATOR_IDS
  delete process.env.HOST_TERMS_VERSION
})

describe('Housing Product V1 rules (SPEC-021)', () => {
  it('AC-02/03/05/06: owner workflow, moderation, contact lifecycle and real counters', async () => {
    await host(OWNER)
    const propertyId = await property(OWNER)
    const roomA = await unit(OWNER, propertyId, 'P.101')
    const roomB = await unit(OWNER, propertyId, 'P.102')
    const listingA = await listing(OWNER, roomA, [
      {
        code: 'electricity',
        label: 'Điện',
        amount: 4000,
        billing_unit: 'kwh',
        required: true,
      },
    ])
    const listingB = await listing(OWNER, roomB, [
      {
        code: 'electricity',
        label: 'Điện',
        amount: 3500,
        billing_unit: 'kwh',
        required: true,
      },
      {
        code: 'service',
        label: 'Dịch vụ',
        amount: null,
        billing_unit: 'month',
        required: true,
      },
    ])

    // AC-02: two rooms with their own fees; another account sees nothing of it.
    const detail = await call(OWNER, 'GET', `/v1/landlord/properties/${propertyId}`)
    expect(detail.body.units.map((u: { unit_code: string }) => u.unit_code)).toEqual(['P.101', 'P.102'])
    const feesB = await call(OWNER, 'GET', `/v1/landlord/listings/${listingB}`)
    expect(feesB.body.fees.find((f: { code: string }) => f.code === 'service').amount).toBeNull()
    expect((await call(OTHER, 'GET', `/v1/landlord/properties/${propertyId}`)).status).toBe(403)
    expect(
      (
        await call(OTHER, 'PATCH', `/v1/landlord/listings/${listingA}`, {
          revision: 1,
          title: 'Đổi tên trái phép',
        })
      ).status,
    ).toBe(403)
    expect((await call(OTHER, 'GET', '/v1/landlord/properties')).body.items).toEqual([])
    // Owners can correct the address of their own property; the reader key `raw` follows it.
    const moved = await call(OWNER, 'PATCH', `/v1/landlord/properties/${propertyId}`, {
      revision: detail.body.revision,
      address: { full_address: `Địa chỉ kiểm thử ${run}` },
    })
    expect(moved.status, JSON.stringify(moved.body)).toBe(200)
    expect(
      (
        await call(OTHER, 'PATCH', `/v1/landlord/properties/${propertyId}`, {
          revision: moved.body.revision,
          name: 'Chiếm quyền',
        })
      ).status,
    ).toBe(403)

    // AC-03: drafts are not public and need an approved property before review.
    expect((await app.inject({ method: 'GET', url: `/v1/housing/${listingA}` })).statusCode).toBe(404)
    expect((await call(OWNER, 'POST', `/v1/landlord/listings/${listingA}/submit`, {})).status).toBe(403)
    expect((await call(OWNER, 'POST', `/v1/moderation/housing/properties/${propertyId}/approve`, {})).status).toBe(403)
    // HM-03: the poster must be verified before their property is.
    const early = await call(MODERATOR, 'POST', `/v1/moderation/housing/properties/${propertyId}/approve`, {})
    expect([early.status, early.body.code]).toEqual([409, 'host_not_verified'])
    expect(
      (
        await call(MODERATOR, 'POST', `/v1/moderation/host/${OWNER}/review`, {
          decision: 'verify',
          method: 'video_call',
        })
      ).status,
    ).toBe(200)
    expect((await call(MODERATOR, 'POST', `/v1/moderation/housing/properties/${propertyId}/approve`, {})).status).toBe(
      200,
    )
    expect((await call(OWNER, 'POST', `/v1/landlord/listings/${listingA}/submit`, {})).status).toBe(200)
    const queue = await call(MODERATOR, 'GET', '/v1/moderation/housing/queue')
    expect(queue.body.listings.map((l: { id: string }) => l.id)).toContain(listingA)
    expect(
      (
        await call(TENANT, 'POST', `/v1/housing/${listingA}/contact-requests`, {
          message: 'Còn phòng không?',
        })
      ).status,
    ).toBe(409)
    const approved = await call(MODERATOR, 'POST', `/v1/moderation/housing/listings/${listingA}/review`, {
      decision: 'approve',
    })
    expect(approved.body.publication_status).toBe('published')
    const publicDetail = await app.inject({
      method: 'GET',
      url: `/v1/housing/${listingA}`,
    })
    expect(publicDetail.statusCode, publicDetail.body).toBe(200)
    expect(publicDetail.json().management.accepts_contact_requests).toBe(true)
    expect(publicDetail.json().fees[0].billing_unit).toBe('kwh')
    expect(publicDetail.json().address.raw).toBe(`Địa chỉ kiểm thử ${run}`)
    // HM-05: tenants see the poster label, never identity fields.
    expect(publicDetail.json().management).toMatchObject({
      poster_type: 'owner',
      poster_name: `Người đăng ${run}`,
      host_verified: true,
    })
    expect(publicDetail.body).not.toContain('0901 234 567')
    expect(publicDetail.body).not.toContain(`Nguyễn Văn ${run}`)
    // AC-01: the approved listing also parses through the existing search contract.
    const search = await app.inject({
      method: 'POST',
      url: '/v1/housing/search',
      payload: {
        center: { lat: 10.7769, lng: 106.7009 },
        radius_m: 50,
        text: `kiểm thử ${run}`,
        limit: 50,
      },
    })
    expect(search.statusCode, search.body).toBe(200)
    expect(search.json().results.map((r: { listing_id: string }) => r.listing_id)).toContain(listingA)

    // AC-05: one open request per tenant and listing; only managers of that property see it.
    const sent = await call(TENANT, 'POST', `/v1/housing/${listingA}/contact-requests`, { message: 'Còn phòng không?' })
    expect(sent.status).toBe(201)
    expect(
      (
        await call(TENANT, 'POST', `/v1/housing/${listingA}/contact-requests`, {
          message: 'Gửi lại',
        })
      ).status,
    ).toBe(409)
    const inbox = await call(OWNER, 'GET', '/v1/landlord/contact-requests')
    expect(inbox.body.items.map((i: { id: string }) => i.id)).toContain(sent.body.id)
    expect((await call(OTHER, 'GET', '/v1/landlord/contact-requests')).body.items).toEqual([])
    const viewing = await call(OWNER, 'PATCH', `/v1/landlord/contact-requests/${sent.body.id}`, {
      status: 'viewing',
      revision: 1,
    })
    expect(viewing.body?.status, JSON.stringify(viewing)).toBe('viewing')
    expect(
      (await call(OTHER, 'PATCH', `/v1/landlord/contact-requests/${sent.body.id}`, { status: 'resolved', revision: 2 }))
        .status,
    ).toBe(409)
    const mine = await call(TENANT, 'GET', '/v1/housing/contact-requests/me')
    expect(mine.body.items[0]).toMatchObject({
      id: sent.body.id,
      status: 'viewing',
    })
    expect(
      (await call(TENANT, 'POST', `/v1/housing/contact-requests/${sent.body.id}/cancel`, { revision: 2 })).status,
    ).toBe(409)

    // AC-03: a rented room leaves public reads and stops taking requests.
    const revision = (await call(OWNER, 'GET', `/v1/landlord/listings/${listingA}`)).body.revision
    expect(
      (await call(OWNER, 'POST', `/v1/landlord/listings/${listingA}/availability`, { status: 'rented', revision }))
        .status,
    ).toBe(200)
    expect((await app.inject({ method: 'GET', url: `/v1/housing/${listingA}` })).statusCode).toBe(404)
    expect(
      (
        await call(OTHER, 'POST', `/v1/housing/${listingA}/contact-requests`, {
          message: 'Còn không?',
        })
      ).status,
    ).toBe(409)

    // AC-06: counters come only from recorded, de-duplicated events.
    const fresh = await call(OWNER, 'GET', '/v1/landlord/overview')
    expect(fresh.body.detail_views).toBe(0)
    await call(OWNER, 'POST', `/v1/landlord/listings/${listingA}/availability`, {
      status: 'vacant',
      revision: revision + 1,
    })
    for (let i = 0; i < 2; i += 1) {
      await call(TENANT, 'POST', `/v1/housing/${listingA}/events`, {
        event_type: 'detail_view',
        dedup_key: `detail:${run}`,
      })
    }
    const counted = await call(OWNER, 'GET', '/v1/landlord/overview')
    expect(counted.body.detail_views).toBe(1)
    expect(counted.body.contact_requests).toBe(1)
    expect(counted.body.measured_since).not.toBeNull()
  })

  it('a moderator cannot approve a property or listing they manage', async () => {
    await host(MODERATOR)
    const own = await property(MODERATOR)
    expect((await call(MODERATOR, 'POST', `/v1/moderation/housing/properties/${own}/approve`, {})).status).toBe(403)
    const room = await unit(MODERATOR, own, 'P.201')
    const draft = await listing(MODERATOR, room, [])
    expect(
      (await call(MODERATOR, 'POST', `/v1/moderation/housing/listings/${draft}/review`, { decision: 'approve' }))
        .status,
    ).toBe(403)
  })

  it('HM-02..07: poster profile gates property creation and review', async () => {
    const broker = `test-broker-${run}`
    // HM-02: no profile, no property.
    const blocked = await call(broker, 'POST', '/v1/landlord/properties', {
      name: `Nhà môi giới ${run}`,
      property_type: 'room',
      address: { full_address: 'x' },
      location: { lat: 10.78, lng: 106.7 },
    })
    expect([blocked.status, blocked.body.code]).toEqual([409, 'host_profile_required'])
    expect((await call(broker, 'GET', '/v1/host/profile')).body.profile).toBeNull()
    const profile = await host(broker, 'broker')
    expect(profile.status).toBe('pending')
    // HM-04: only moderators review, never their own profile; others cannot read it.
    expect(
      (
        await call(OTHER, 'POST', `/v1/moderation/host/${broker}/review`, {
          decision: 'verify',
          method: 'phone_call',
        })
      ).status,
    ).toBe(403)
    expect((await call(OTHER, 'GET', '/v1/host/profile')).body.profile?.user_id ?? null).not.toBe(broker)
    await host(MODERATOR)
    expect(
      (
        await call(MODERATOR, 'POST', `/v1/moderation/host/${MODERATOR}/review`, {
          decision: 'verify',
          method: 'phone_call',
        })
      ).status,
    ).toBe(403)
    const queue = await call(MODERATOR, 'GET', '/v1/moderation/housing/queue')
    const queued = queue.body.hosts.find((h: { user_id: string }) => h.user_id === broker)
    expect(queued).toMatchObject({
      poster_type: 'broker',
      phone: '0901 234 567',
    })
    expect(queued.can_review).toBe(true)
    expect(queue.body.hosts.find((h: { user_id: string }) => h.user_id === MODERATOR)).toMatchObject({user_id:MODERATOR,can_review:false})
    // needs_info shows the reason to the poster; saving again sends it back for review.
    await call(MODERATOR, 'POST', `/v1/moderation/host/${broker}/review`, {
      decision: 'needs_info',
      reason: 'Thiếu số chứng chỉ',
    })
    const asked = (await call(broker, 'GET', '/v1/host/profile')).body.profile
    expect([asked.status, asked.info_request]).toEqual(['needs_info', 'Thiếu số chứng chỉ'])
    const resent = await call(broker, 'PUT', '/v1/host/profile', {
      poster_type: 'broker',
      display_name: asked.display_name,
      legal_name: asked.legal_name,
      phone: asked.phone,
      broker_license_no: 'CC-123',
      revision: asked.revision,
    })
    expect(resent.body.profile.status).toBe('pending')
    await call(MODERATOR, 'POST', `/v1/moderation/host/${broker}/review`, {
      decision: 'verify',
      method: 'phone_call',
    })
    // HM-06: a display-name change keeps verification; an identity change does not.
    let current = (await call(broker, 'GET', '/v1/host/profile')).body.profile
    const renamed = await call(broker, 'PUT', '/v1/host/profile', {
      ...current,
      display_name: 'Tên mới',
      revision: current.revision,
    })
    expect(renamed.body.profile.status).toBe('verified')
    current = renamed.body.profile
    const moved = await call(broker, 'PUT', '/v1/host/profile', {
      ...current,
      phone: '0909 999 999',
      revision: current.revision,
    })
    expect(moved.body.profile.status).toBe('pending')
    // HM-07: a configured terms version must be accepted before posting.
    process.env.HOST_TERMS_VERSION = `t-${run}`
    try {
      const terms = await call(broker, 'POST', '/v1/landlord/properties', {
        name: `Nhà môi giới ${run}`,
        property_type: 'room',
        address: { full_address: 'x' },
        location: { lat: 10.78, lng: 106.7 },
      })
      expect(terms.body.code).toBe('host_terms_required')
      current = moved.body.profile
      const accepted = await call(broker, 'PUT', '/v1/host/profile', {
        ...current,
        accept_terms_version: `t-${run}`,
        revision: current.revision,
      })
      expect(accepted.body.profile.terms_version).toBe(`t-${run}`)
      await property(broker)
    } finally {
      delete process.env.HOST_TERMS_VERSION
    }
  })

  it('viewing slots from the tenant tab reach the landlord, who confirms or declines', async () => {
    const owner = `test-vowner-${run}`
    const tenant = `test-vtenant-${run}`
    await host(owner)
    await call(MODERATOR, 'POST', `/v1/moderation/host/${owner}/review`, {
      decision: 'verify',
      method: 'phone_call',
    })
    const propertyId = await property(owner)
    await call(MODERATOR, 'POST', `/v1/moderation/housing/properties/${propertyId}/approve`, {})
    const listingId = await listing(owner, await unit(owner, propertyId, 'V.1'), [])
    await call(owner, 'POST', `/v1/landlord/listings/${listingId}/submit`, {})
    await call(MODERATOR, 'POST', `/v1/moderation/housing/listings/${listingId}/review`, { decision: 'approve' })
    const slot = new Date(Date.now() + 86_400_000).toISOString()

    const first = await call(tenant, 'PUT', `/v1/housing/${listingId}/viewing`, { slot })
    expect([first.status, first.body.viewing_status]).toEqual([201, 'requested'])
    // Re-sending the same slot is a no-op (the gateway syncs after every step).
    expect((await call(tenant, 'PUT', `/v1/housing/${listingId}/viewing`, { slot })).body.changed).toBe(false)
    const inbox = (await call(owner, 'GET', '/v1/landlord/contact-requests')).body.items
    const request = inbox.find((i: { listing_id: string }) => i.listing_id === listingId)
    expect(request).toMatchObject({
      source: 'viewing',
      viewing_status: 'requested',
      status: 'new',
    })
    expect(new Date(request.viewing_slot).toISOString()).toBe(slot)
    // Only the landlord of this property answers.
    expect(
      (
        await call(OTHER, 'POST', `/v1/landlord/contact-requests/${request.id}/viewing`, {
          decision: 'confirm',
          revision: request.revision,
        })
      ).status,
    ).toBe(409)
    const later = new Date(Date.now() + 2 * 86_400_000).toISOString()
    const declined = await call(owner, 'POST', `/v1/landlord/contact-requests/${request.id}/viewing-options`, {
      slots: [later],
      revision: request.revision,
    })
    expect(declined.body.viewing_status).toBe('declined')
    // The tenant picks another time; the landlord confirms it.
    expect(
      (
        await call(tenant, 'PUT', `/v1/housing/${listingId}/viewing`, {
          slot: later,
        })
      ).body.viewing_status,
    ).toBe('requested')
    const again = (await call(owner, 'GET', '/v1/landlord/contact-requests')).body.items.find(
      (i: { id: string }) => i.id === request.id,
    )
    const confirmed = await call(owner, 'POST', `/v1/landlord/contact-requests/${request.id}/viewing`, {
      decision: 'confirm',
      revision: again.revision,
    })
    expect(confirmed.body).toMatchObject({
      viewing_status: 'confirmed',
      status: 'viewing',
    })
    const mine = (await call(tenant, 'GET', '/v1/housing/contact-requests/me')).body.items[0]
    expect(mine).toMatchObject({
      id: request.id,
      viewing_status: 'confirmed',
      status: 'viewing',
    })
    // The gateway fingerprints this to tell whether a timed-out write landed.
    expect(mine.viewing_updated_at).not.toBeNull()
    // Cancelling in the tab withdraws the time; a request the landlord already handled stays open.
    const cancelled = await call(tenant, 'DELETE', `/v1/housing/${listingId}/viewing`)
    expect(cancelled.body).toMatchObject({
      changed: true,
      viewing_status: 'cancelled',
      status: 'viewing',
    })
    // A request created only by a viewing and never handled closes with the cancellation.
    const other = `test-vtenant2-${run}`
    await call(other, 'PUT', `/v1/housing/${listingId}/viewing`, { slot })
    expect((await call(other, 'DELETE', `/v1/housing/${listingId}/viewing`)).body.status).toBe('declined')
    // Crawled or unmanaged listings keep the local test-mode viewing.
    expect(
      (
        await call(tenant, 'PUT', `/v1/housing/${randomUUID()}/viewing`, {
          slot,
        })
      ).body.code,
    ).toBe('not_managed')
  })

  it('tenant and landlord exchange messages on one request; nobody else can read it', async () => {
    const owner = `test-mowner-${run}`
    const tenant = `test-mtenant-${run}`
    await host(owner)
    await call(MODERATOR, 'POST', `/v1/moderation/host/${owner}/review`, {
      decision: 'verify',
      method: 'phone_call',
    })
    const propertyId = await property(owner)
    await call(MODERATOR, 'POST', `/v1/moderation/housing/properties/${propertyId}/approve`, {})
    const listingId = await listing(owner, await unit(owner, propertyId, 'M.1'), [])
    await call(owner, 'POST', `/v1/landlord/listings/${listingId}/submit`, {})
    await call(MODERATOR, 'POST', `/v1/moderation/housing/listings/${listingId}/review`, { decision: 'approve' })
    const sent = await call(tenant, 'POST', `/v1/housing/${listingId}/contact-requests`, {
      message: 'Phòng còn không ạ?',
    })
    const id = sent.body.id
    const path = `/v1/housing/contact-requests/${id}/messages`

    expect(
      (
        await call(tenant, 'POST', path, {
          body: 'Chiều mai em qua xem được không?',
        })
      ).status,
    ).toBe(201)
    let inbox = (await call(owner, 'GET', '/v1/landlord/contact-requests')).body.items.find(
      (i: { id: string }) => i.id === id,
    )
    expect(inbox.unread).toBe(1)
    // Strangers, including other landlords, cannot read or write.
    expect((await call(OTHER, 'GET', path)).status).toBe(404)
    expect((await call(OTHER, 'POST', path, { body: 'xin chào' })).status).toBe(404)
    expect((await call(tenant, 'GET', path)).body.counterparty_read_at).toBeNull()
    const read = await call(owner, 'GET', path)
    const receipt = await call(tenant, 'GET', path)
    expect(Date.parse(receipt.body.counterparty_read_at)).toBeGreaterThanOrEqual(Date.parse(receipt.body.messages[0].created_at))
    expect(receipt.body.request.revision).toBeGreaterThan(0)
    expect(read.body.role).toBe('landlord')
    expect(read.body.messages.map((m: { body: string }) => m.body)).toEqual(['Chiều mai em qua xem được không?'])
    inbox = (await call(owner, 'GET', '/v1/landlord/contact-requests')).body.items.find(
      (i: { id: string }) => i.id === id,
    )
    expect(inbox.unread).toBe(0)
    // The landlord's first reply marks the request as contacted; the tenant sees one unread message.
    await call(owner, 'POST', path, { body: 'Được em, 3 giờ chiều nhé.' })
    const mine = (await call(tenant, 'GET', '/v1/housing/contact-requests/me')).body.items.find(
      (i: { id: string }) => i.id === id,
    )
    expect([mine.status, mine.unread]).toEqual(['contacted', 1])
    expect((await call(tenant, 'GET', path)).body.messages.map((m: { sender_role: string }) => m.sender_role)).toEqual([
      'tenant',
      'landlord',
    ])
    // Rate limit comes from configuration.
    process.env.HOUSING_MESSAGE_RATE_PER_MINUTE = '2'
    try {
      expect((await call(tenant, 'POST', path, { body: 'Dạ vâng.' })).status).toBe(201)
      expect((await call(tenant, 'POST', path, { body: 'Em cảm ơn.' })).status).toBe(429)
    } finally {
      delete process.env.HOUSING_MESSAGE_RATE_PER_MINUTE
    }
    // A closed request takes no more messages.
    const rev = (await call(tenant, 'GET', '/v1/housing/contact-requests/me')).body.items.find(
      (i: { id: string }) => i.id === id,
    ).revision
    await call(owner, 'PATCH', `/v1/landlord/contact-requests/${id}`, {
      status: 'resolved',
      revision: rev,
    })
    expect((await call(owner, 'POST', path, { body: 'Cảm ơn em.' })).status).toBe(409)
  })
  it('keeps Search, Map and the shared MCP reader aligned through edits, rejection and reapproval', async () => {
    const owner = `test-state-${run}`
    await host(owner)
    await call(MODERATOR, 'POST', `/v1/moderation/host/${owner}/review`, {
      decision: 'verify',
      method: 'phone_call',
    })
    const propertyId = await property(owner)
    await call(MODERATOR, 'POST', `/v1/moderation/housing/properties/${propertyId}/approve`, {})
    const a = await listing(owner, await unit(owner, propertyId, 'S.1'), [])
    const b = await listing(owner, await unit(owner, propertyId, 'S.2'), [])
    const rev = async (id: string) => (await call(owner, 'GET', `/v1/landlord/listings/${id}`)).body.revision as number
    const approve = async (id: string) => {
      expect((await call(owner, 'POST', `/v1/landlord/listings/${id}/submit`, {})).status).toBe(200)
      expect(
        (await call(MODERATOR, 'POST', `/v1/moderation/housing/listings/${id}/review`, { decision: 'approve' })).status,
      ).toBe(200)
    }
    const assertPublic = async (id: string, visible: boolean) => {
      expect((await app.inject({ method: 'GET', url: `/v1/housing/${id}` })).statusCode).toBe(visible ? 200 : 404)
      const search = await app.inject({
        method: 'POST',
        url: '/v1/housing/search',
        payload: {
          center: { lat: 10.7769, lng: 106.7009 },
          radius_m: 50,
          limit: 50,
          text: `kiểm thử ${run}`,
        },
      })
      expect(search.statusCode, search.body).toBe(200)
      expect(search.json().results.some((r: { listing_id: string }) => r.listing_id === id)).toBe(visible)
      const map = await app.inject({
        method: 'POST',
        url: '/v1/housing/map',
        payload: {
          bounding_box: {
            west: 106.7,
            south: 10.776,
            east: 106.702,
            north: 10.778,
          },
          zoom: 19,
          limit: 100,
        },
      })
      expect(map.statusCode, map.body).toBe(200)
      expect(JSON.stringify(map.json()).includes(id)).toBe(visible)
      expect((await admin.query('SELECT count(*)::int AS n FROM housing.map_points WHERE id=$1', [id])).rows[0].n).toBe(
        visible ? 1 : 0,
      )
    }
    await assertPublic(a, false)
    await approve(a)
    await approve(b)
    await assertPublic(a, true)
    await assertPublic(b, true) // same point, different units
    const filename = createHash('sha1').update(a).digest('hex') + '.png'
    expect((await call('__public_media__', 'GET', `/v1/housing-media/${filename}/access`)).body.public).toBe(true)
    const stale = await rev(a)
    expect(
      (
        await call(owner, 'PATCH', `/v1/landlord/listings/${a}`, {
          revision: stale,
          description: 'Nội dung mới phải được duyệt lại.',
        })
      ).status,
    ).toBe(200)
    const unchanged = (await call(owner, 'GET', `/v1/landlord/listings/${a}`)).body
    expect(unchanged.title).toBe(`Phòng kiểm thử ${run}`)
    expect(unchanged.rent_vnd).toBe(4000000)
    await assertPublic(a, false)
    await assertPublic(b, true)
    expect((await call('__public_media__', 'GET', `/v1/housing-media/${filename}/access`)).status).toBe(403)
    expect((await call(owner, 'GET', `/v1/housing-media/${filename}/access`)).status).toBe(200)
    expect((await call(MODERATOR, 'GET', `/v1/moderation/housing/listings/${a}`)).body.description).toContain(
      'Nội dung mới',
    )
    expect((await call(OTHER, 'GET', `/v1/landlord/listings/${a}/preview`)).status).toBe(403)
    expect((await call(OTHER, 'GET', `/v1/moderation/housing/listings/${a}`)).status).toBe(403)
    expect(
      (
        await call(owner, 'POST', `/v1/landlord/listings/${a}/submit`, {
          revision: stale,
        })
      ).status,
    ).toBe(409)
    const submitted = await call(owner, 'POST', `/v1/landlord/listings/${a}/submit`, {})
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200)
    expect(
      (
        await call(MODERATOR, 'POST', `/v1/moderation/housing/listings/${a}/review`, {
          decision: 'reject',
          reason: '   ',
        })
      ).status,
    ).toBe(422)
    const rejected = await call(MODERATOR, 'POST', `/v1/moderation/housing/listings/${a}/review`, {
      decision: 'reject',
      reason: 'Bổ sung nội dung.',
    })
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(200)
    expect(rejected.body.publication_status).toBe('rejected')
    await assertPublic(a, false)
    // A rejected listing goes back to review only after the owner changes it.
    const resend = await call(owner, 'POST', `/v1/landlord/listings/${a}/submit`, {})
    expect(resend.status).toBe(409)
    expect(resend.body.code).toBe('listing_unchanged')
    expect(
      (
        await call(owner, 'PATCH', `/v1/landlord/listings/${a}`, {
          revision: await rev(a),
          description: 'Nội dung đã bổ sung theo yêu cầu.',
        })
      ).status,
    ).toBe(200)
    await approve(a)
    const history = (await call(MODERATOR, 'GET', `/v1/moderation/housing/listings/${a}`)).body.review_history
    expect(history.map((r: { decision: string }) => r.decision)).toEqual(['approve', 'reject', 'approve'])
    expect(
      (
        await call(owner, 'POST', `/v1/landlord/listings/${a}/availability`, {
          revision: await rev(a),
          status: 'rented',
        })
      ).status,
    ).toBe(200)
    await assertPublic(a, false)
    await call(owner, 'POST', `/v1/landlord/listings/${a}/availability`, {
      revision: await rev(a),
      status: 'vacant',
    })
    await assertPublic(a, true)
    await call(owner, 'POST', `/v1/landlord/listings/${a}/hide`, {
      revision: await rev(a),
    })
    await assertPublic(a, false)
    await approve(a)
    const unitId = (await call(owner, 'GET', `/v1/landlord/listings/${a}`)).body.unit_id
    expect(
      (
        await call(OTHER, 'PATCH', `/v1/landlord/units/${unitId}`, {
          revision: 1,
          area_m2: 30,
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await call(owner, 'PATCH', `/v1/landlord/units/${unitId}`, {
          revision: 1,
          area_m2: 30,
        })
      ).status,
    ).toBe(200)
    await assertPublic(a, false)
    await approve(a)
    const propertyInfo = (await call(owner, 'GET', `/v1/landlord/properties/${propertyId}`)).body
    const changed = await call(owner, 'PATCH', `/v1/landlord/properties/${propertyId}`, {
      revision: propertyInfo.revision,
      address: { full_address: 'Địa chỉ khác' },
      location: { lat: 10.777, lng: 106.701 },
    })
    expect(changed.status).toBe(200)
    await assertPublic(a, false)
    await assertPublic(b, false)
    const incomplete = await call(owner, 'POST', `/v1/landlord/listings/${a}/submit`, {})
    expect(incomplete.status).toBe(422)
    expect(incomplete.body.fields.location).toBeTruthy()
  })

  it('validates incomplete drafts, forbids arbitrary media and retries one create request without duplicate listings', async () => {
    const owner = `test-draft-${run}`
    await host(owner)
    await call(MODERATOR, 'POST', `/v1/moderation/host/${owner}/review`, {
      decision: 'verify',
      method: 'phone_call',
    })
    const p = await property(owner)
    await call(MODERATOR, 'POST', `/v1/moderation/housing/properties/${p}/approve`, {})
    const u = await unit(owner, p, 'D.1'),
      request_id = randomUUID()
    const first = await call(owner, 'POST', `/v1/landlord/units/${u}/listing`, {
      request_id,
    })
    expect(first.status).toBe(201)
    const retry = await call(owner, 'POST', `/v1/landlord/units/${u}/listing`, {
      request_id,
    })
    expect(retry.body.id).toBe(first.body.id)
    expect(
      (
        await call(owner, 'POST', `/v1/landlord/units/${u}/listing`, {
          request_id: randomUUID(),
        })
      ).status,
    ).toBe(409)
    const incomplete = await call(owner, 'POST', `/v1/landlord/listings/${first.body.id}/submit`, {})
    expect(incomplete.status).toBe(422)
    expect(Object.keys(incomplete.body.fields)).toEqual(
      expect.arrayContaining(['title', 'description', 'rent_vnd', 'images']),
    )
    const invalid = await app.inject({
      method: 'POST',
      url: `/v1/landlord/listings/${first.body.id}/media`,
      headers: { authorization: `Bearer ${TOKEN}`, 'x-user-id': owner },
      payload: {
        url: 'http://localhost/web/media/housing/' + 'a'.repeat(40) + '.png',
        content_sha256: 'a'.repeat(64),
      },
    })
    expect(invalid.statusCode).toBe(403)
    const info = (await call(owner, 'GET', `/v1/landlord/properties/${p}`)).body
    const forged = await call(owner, 'PATCH', `/v1/landlord/properties/${p}`, {
      revision: info.revision,
      location_token: 'forged',
      location_confirmed: true,
    })
    expect(forged.status).toBe(409)
    expect((await call(owner, 'GET', `/v1/landlord/properties/${p}`)).body.revision).toBe(info.revision)
  })

  it('commits one simultaneous review, protects stale profile reviews and scopes dashboard counters', async () => {
    const owner = `test-race-${run}`
    await host(owner)
    const old = (await call(owner, 'GET', '/v1/host/profile')).body.profile
    await call(owner, 'PUT', '/v1/host/profile', {
      ...old,
      phone: '0988 888 888',
      revision: old.revision,
    })
    expect(
      (
        await call(MODERATOR, 'POST', `/v1/moderation/host/${owner}/review`, {
          decision: 'verify',
          method: 'phone_call',
          revision: old.revision,
        })
      ).status,
    ).toBe(409)
    await call(MODERATOR, 'POST', `/v1/moderation/host/${owner}/review`, {
      decision: 'verify',
      method: 'phone_call',
    })
    const p = await property(owner)
    await call(MODERATOR, 'POST', `/v1/moderation/housing/properties/${p}/approve`, {})
    const a = await listing(owner, await unit(owner, p, 'R.1'), [])
    await call(owner, 'POST', `/v1/landlord/listings/${a}/submit`, {})
    const revision = (await call(owner, 'GET', `/v1/landlord/listings/${a}`)).body.revision
    const decisions = await Promise.all(
      [1, 2].map(() =>
        call(MODERATOR, 'POST', `/v1/moderation/housing/listings/${a}/review`, {
          decision: 'approve',
          revision,
        }),
      ),
    )
    expect(decisions.map(r => r.status).sort()).toEqual([200, 409])
    expect(
      (await admin.query('SELECT count(*)::int AS n FROM housing.listing_reviews WHERE listing_id=$1', [a])).rows[0].n,
    ).toBe(1)
    await call(TENANT, 'POST', `/v1/housing/${a}/events`, {
      event_type: 'detail_view',
      dedup_key: `race:${run}`,
    })
    const stats = await call(owner, 'GET', `/v1/landlord/stats?days=7&property_id=${p}`)
    expect(stats.status, JSON.stringify(stats.body)).toBe(200)
    expect(stats.body.inventory).toMatchObject({
      properties: 1,
      units: 1,
      listings: 1,
      published: 1,
      vacant: 1,
    })
    expect(stats.body.daily.reduce((n: number, r: { detail_views: number }) => n + r.detail_views, 0)).toBe(1)
    expect((await call(OTHER, 'GET', '/v1/landlord/stats?days=7')).body.inventory.listings).toBe(0)
    expect((await call(OTHER, 'GET', `/v1/landlord/stats?property_id=${p}`)).status).toBe(403)
  })
  it('gallery mutations preserve cover/order, reject foreign IDs and invalidate publication',async()=>{
    const owner=`test-gallery-${run}`
    await host(owner)
    await call(MODERATOR,'POST',`/v1/moderation/host/${owner}/review`,{decision:'verify',method:'phone_call'})
    const p=await property(owner)
    await call(MODERATOR,'POST',`/v1/moderation/housing/properties/${p}/approve`,{})
    const a=await listing(owner,await unit(owner,p,'G.1'),[])
    const extra={url:'http://localhost/web/media/housing/'+ 'e'.repeat(40)+'.png',content_sha256:'e'.repeat(64)}
    const second=await call(owner,'POST',`/v1/landlord/listings/${a}/media`,extra)
    expect(second.status).toBe(201)
    const get=async()=>(await call(owner,'GET',`/v1/landlord/listings/${a}`)).body
    let current=await get()
    const first=current.media.find((m:{id:string})=>m.id!==second.body.id)
    const duplicate=await call(owner,'POST',`/v1/landlord/listings/${a}/media`,extra)
    expect(duplicate.body.id).toBe(second.body.id)
    expect((await get()).revision).toBe(current.revision)
    const bad=await call(owner,'PATCH',`/v1/landlord/listings/${a}/media`,{revision:current.revision,order:[second.body.id,randomUUID()],cover_id:second.body.id})
    expect(bad.status).toBe(409);expect((await get()).revision).toBe(current.revision)
    expect((await call(owner,'PATCH',`/v1/landlord/listings/${a}/media`,{revision:current.revision,order:[second.body.id,first.id],cover_id:second.body.id})).status).toBe(200)
    current=await get();expect(current.media[0]).toMatchObject({id:second.body.id,is_primary:true,position:0})
    await call(owner,'POST',`/v1/landlord/listings/${a}/submit`,{})
    await call(MODERATOR,'POST',`/v1/moderation/housing/listings/${a}/review`,{decision:'approve'})
    current=await get()
    expect((await call(OTHER,'DELETE',`/v1/landlord/listings/${a}/media/${second.body.id}`,{revision:current.revision})).status).toBe(403)
    expect((await call(owner,'DELETE',`/v1/landlord/listings/${a}/media/${second.body.id}`,{revision:current.revision})).status).toBe(200)
    current=await get();expect(current.publication_status).toBe('draft');expect(current.media).toHaveLength(1);expect(current.media[0].is_primary).toBe(true)
    expect((await app.inject({method:'GET',url:`/v1/housing/${a}`})).statusCode).toBe(404)
  })

})

it('handoff: proposed times, distinct senders, payment review, visibility and per-owner archive', async () => {
  const owner = `test-handoff-owner-${run}`, tenant = `test-handoff-tenant-${run}`
  await host(owner)
  await call(MODERATOR, 'POST', `/v1/moderation/host/${owner}/review`, {decision:'verify',method:'phone_call'})
  const p = await property(owner)
  await call(MODERATOR, 'POST', `/v1/moderation/housing/properties/${p}/approve`, {})
  const id = await listing(owner, await unit(owner,p,'H.1'), [])
  await call(owner,'POST',`/v1/landlord/listings/${id}/submit`,{})
  await call(MODERATOR,'POST',`/v1/moderation/housing/listings/${id}/review`,{decision:'approve'})
  const slot = new Date(Date.now()+86400000).toISOString(), later = new Date(Date.now()+172800000).toISOString()
  expect((await call(owner,'PUT',`/v1/housing/${id}/viewing`,{slot})).status).toBe(409)
  expect((await call(owner,'POST',`/v1/housing/${id}/contact-requests`,{message:'Tự liên hệ'})).status).toBe(409)
  const booked = await call(tenant,'PUT',`/v1/housing/${id}/viewing`,{slot})
  const request = booked.body.id, path = `/v1/landlord/contact-requests/${request}`
  const current = async () => (await admin.query('SELECT * FROM housing.contact_requests WHERE id=$1',[request])).rows[0]
  expect((await call(owner,'POST',path+'/archive',{revision:(await current()).revision})).status).toBe(409)
  const proposal = {revision:(await current()).revision,slots:[later]}
  expect((await call(tenant,'POST',path+'/viewing-options',proposal)).status).toBe(403)
  expect([403,404]).toContain((await call(OTHER,'POST',path+'/viewing-options',proposal)).status)
  expect((await call(owner,'POST',path+'/viewing-options',{...proposal,slots:[new Date(Date.now()+8*86400000).toISOString()]})).status).toBe(422)
  // The window follows HOUSING_VIEWING_PROPOSAL_DAYS, shared with the agent's slot list.
  process.env.HOUSING_VIEWING_PROPOSAL_DAYS = '1'
  try {
    const outside = await call(owner,'POST',path+'/viewing-options',proposal)
    expect(outside.status).toBe(422)
    expect(outside.body.message).toBe('Chọn giờ phù hợp trong 1 ngày tới.')
  } finally {
    delete process.env.HOUSING_VIEWING_PROPOSAL_DAYS
  }
  expect((await call(owner,'POST',path+'/viewing-options',{...proposal,slots:[slot]})).status).toBe(422)
  expect((await call(owner,'POST',path+'/viewing-options',proposal)).status).toBe(200)
  expect((await call(tenant,'PUT',`/v1/housing/${id}/viewing`,{slot})).status).toBe(409)
  expect((await call(tenant,'PUT',`/v1/housing/${id}/viewing`,{slot:later})).status).toBe(200)
  expect((await call(owner,'POST',path+'/viewing',{decision:'confirm',revision:(await current()).revision})).status).toBe(200)
  expect((await call(owner,'PATCH',path,{status:'resolved',revision:(await current()).revision})).status).toBe(409)
  const messages = `/v1/housing/contact-requests/${request}/messages`
  // Before any reply, identify the property's active owner.
  expect((await call(tenant,'GET',messages)).body.counterparty_user_id).toBe(owner)
  await call(tenant,'POST',messages,{body:'Em sẽ chuyển tiền sau khi xem.'})
  await call(owner,'POST',messages,{body:'Chủ nhà xác nhận lịch.'})
  const thread = (await call(tenant,'GET',messages)).body
  expect(thread.viewer_id).toBe(tenant)
  expect(thread.counterparty_user_id).toBe(owner)
  expect((await call(owner,'GET',messages)).body.counterparty_user_id).toBe(tenant)
  expect(thread.messages.map((m: {sender_user_id:string}) => m.sender_user_id)).toEqual([tenant,owner])
  expect([403,404]).toContain((await call(OTHER,'GET',messages)).status)
  const paid = {report_key:randomUUID(),amount_vnd:8000000,paid_on:new Date().toISOString().slice(0,10),agreement:{deposit_vnd:4000000,first_month_vnd:4000000}}
  const reportPath = `/v1/housing/${id}/payment-reports`
  const report = await call(tenant,'POST',reportPath,paid)
  expect(report.status,JSON.stringify(report.body)).toBe(201)
  expect(report.body.amount_vnd).toBe(8000000)
  expect((await call(tenant,'POST',reportPath,paid)).body.id).toBe(report.body.id)
  expect((await call(tenant,'POST',reportPath,{...paid,amount_vnd:1})).status).toBe(409)
  expect((await call(tenant,'POST',reportPath,{...paid,report_key:randomUUID()})).status).toBe(409)
  expect((await call(tenant,'DELETE',`/v1/housing/${id}/viewing`)).status).toBe(409)
  const notifications = (await call(owner,'GET','/v1/housing/contact-notifications')).body.items
  expect(notifications.find((r: {id:string})=>r.id===request)).toMatchObject({payment_status:'pending',update_unread:true,role:'landlord',counterparty_user_id:tenant})
  const tenantNotices = (await call(tenant,'GET','/v1/housing/contact-notifications')).body.items
  expect(tenantNotices.find((r: {id:string})=>r.id===request).counterparty_user_id).toBe(owner)
  const review = {report_id:report.body.id,revision:report.body.revision,decision:'reject',reason:'Chưa nhận được khoản tiền này'}
  expect((await call(tenant,'POST',path+'/payment-review',review)).status).toBe(403)
  expect([403,404]).toContain((await call(OTHER,'POST',path+'/payment-review',review)).status)
  expect((await call(owner,'POST',path+'/payment-review',{...review,reason:''})).status).toBe(422)
  expect((await call(owner,'POST',path+'/payment-review',review)).body.status).toBe('rejected')
  const second = await call(tenant,'POST',reportPath,{...paid,report_key:randomUUID()})
  expect(second.status).toBe(201)
  const decisions = await Promise.all([1,2].map(()=>call(owner,'POST',path+'/payment-review',{report_id:second.body.id,revision:second.body.revision,decision:'confirm'})))
  expect(decisions.map(r=>r.status).sort()).toEqual([200,409])
  expect((await current()).status).toBe('resolved')
  const publicRow = await admin.query('SELECT is_public FROM housing.managed_listing_visibility WHERE listing_id=$1',[id])
  expect(publicRow.rows[0].is_public).toBe(false)
  expect((await app.inject({method:'GET',url:`/v1/housing/${id}`})).statusCode).toBe(404)
  expect((await call(owner,'POST',path+'/archive',{revision:(await current()).revision})).body.archived).toBe(true)
  expect((await call(owner,'GET','/v1/landlord/contact-requests')).body.items.some((r: {id:string})=>r.id===request)).toBe(false)
  expect((await call(tenant,'GET','/v1/housing/contact-requests/me')).body.items.some((r: {id:string})=>r.id===request)).toBe(true)
  expect((await call(tenant,'GET',messages)).body.messages).toHaveLength(2)
  expect((await admin.query('SELECT count(*)::int AS n FROM housing.rent_payment_reports WHERE request_id=$1',[request])).rows[0].n).toBe(2)
})


it('reuses one pending host profile for multiple homes without resubmission', async () => {
  const owner = `test-profile-once-${run}`
  const profile = await host(owner)
  const first = await property(owner)
  const second = await property(owner)
  expect(first).not.toBe(second)
  const saved = (await call(owner, 'GET', '/v1/host/profile')).body.profile
  expect(saved).toMatchObject({user_id:owner,status:'pending',revision:profile.revision})
  const count = await pool.query('SELECT count(*)::int AS total FROM housing.host_profiles WHERE user_id=$1', [owner])
  expect(count.rows[0].total).toBe(1)
  const queue = (await call(MODERATOR, 'GET', '/v1/moderation/housing/queue')).body
  expect(queue.hosts.filter((h: {user_id:string})=>h.user_id===owner)).toHaveLength(1)
  expect(queue.hosts.find((h: {user_id:string})=>h.user_id===owner)).toMatchObject({pending_properties:2,can_review:true})
})


it('records scoped system updates and atomically saves room drafts without self-approval', async () => {
  const propertyId = await property(OWNER)
  const roomBody = {
    request_id: randomUUID(),
    unit: {
      unit_code: 'R-' + run,
      area_m2: 24,
      bedrooms: 1,
      bathrooms: 1,
      bathroom_type: 'private',
      amenities: ['wifi'],
    },
    listing: {
      title: 'Phòng kiểm tra thông báo',
      description: 'Nội dung đầy đủ cho bản nháp.',
      rent_vnd: 5000000,
      deposit_vnd: 5000000,
      availability_from: '2027-02-01',
      fees: [
        { code: 'water', label: 'Nước', amount: 20000, billing_unit: 'm3', required: true, refundable: false },
        { code: 'electricity', label: 'Điện', amount: 3500, billing_unit: 'kwh', required: true, refundable: false },
      ],
    },
  }
  const result = await call(OWNER, 'POST', `/v1/landlord/properties/${propertyId}/room-listing`, roomBody)
  expect(result.status, JSON.stringify(result.body)).toBe(201)
  expect(
    (await call(OWNER, 'POST', `/v1/landlord/properties/${propertyId}/room-listing`, roomBody)).body.id,
  ).toBe(result.body.id)
  expect(
    (await call(OTHER, 'PUT', `/v1/landlord/units/${result.body.unit_id}/room-listing`, roomBody)).status,
  ).toBe(403)
  const home = (await call(OWNER, 'GET', `/v1/landlord/properties/${propertyId}`)).body
  expect(home.units).toHaveLength(1)
  expect(home.units[0].bathroom_type).toBe('private')
  const shared = await call(OWNER, 'PUT', `/v1/landlord/units/${result.body.unit_id}/room-listing`, {
    ...roomBody,
    request_id: randomUUID(),
    unit: { ...roomBody.unit, bathroom_type: 'shared' },
    unit_revision: result.body.unit_revision,
    listing_revision: result.body.revision,
  })
  expect(shared.status, JSON.stringify(shared.body)).toBe(200)
  const cleared = await call(OWNER, 'PUT', `/v1/landlord/units/${result.body.unit_id}/room-listing`, {
    ...roomBody,
    request_id: randomUUID(),
    unit: { ...roomBody.unit, bathroom_type: null },
    unit_revision: shared.body.unit_revision,
    listing_revision: shared.body.revision,
  })
  expect(cleared.status, JSON.stringify(cleared.body)).toBe(200)
  // Saving the same form again is not an edit: revisions stay put.
  const again = await call(OWNER, 'PUT', `/v1/landlord/units/${result.body.unit_id}/room-listing`, {
    ...roomBody,
    request_id: randomUUID(),
    unit: { ...roomBody.unit, bathroom_type: null },
    unit_revision: cleared.body.unit_revision,
    listing_revision: cleared.body.revision,
  })
  expect(again.status, JSON.stringify(again.body)).toBe(200)
  expect(again.body).toMatchObject({ unit_revision: cleared.body.unit_revision, revision: cleared.body.revision })
  const units = (await call(OWNER, 'GET', `/v1/landlord/properties/${propertyId}`)).body.units
  expect(units[0].bathroom_type).toBeNull()
  expect(
    (await admin.query('SELECT attributes FROM housing.units WHERE id=$1', [result.body.unit_id])).rows[0].attributes,
  ).not.toHaveProperty('bathroom_type')
  // Fixtures set moderation/availability explicitly; no real property is changed.
  await admin.query("UPDATE housing.management_members SET status='active' WHERE property_id=$1", [
    propertyId,
  ])
  await admin.query(
    "UPDATE housing.managed_listings SET publication_status='published',approved_revision=revision WHERE listing_id=$1",
    [result.body.id],
  )
  const publicationNotice = (await call(OWNER, 'GET', '/v1/housing/activity')).body.items.find(
    (event: { listing_id: string; kind: string }) =>
      event.listing_id === result.body.id && event.kind === 'listing_published',
  )
  expect(publicationNotice.counterparty_user_id).toBeNull()
  const slot = new Date(Date.now() + 86400000).toISOString()
  const cr = (
    await admin.query(
      "INSERT INTO housing.contact_requests(listing_id,tenant_user_id,message,viewing_slot,viewing_status,landlord_activity_at) VALUES($1,$2,'Đặt lịch xem',$3,'requested',now()) RETURNING id,revision",
      [result.body.id, TENANT, slot],
    )
  ).rows[0]
  const events = (await call(OWNER, 'GET', '/v1/housing/activity')).body.items
  const requested = events.find(
    (event: { contact_id: string; kind: string }) =>
      event.contact_id === cr.id && event.kind === 'viewing_requested',
  )
  expect(requested).toMatchObject({
    property_id: propertyId,
    listing_id: result.body.id,
    property_name: home.name,
    unit_code: roomBody.unit.unit_code,
    unread: true,
  })
  expect(
    (await call(TENANT, 'GET', '/v1/housing/activity')).body.items.some(
      (event: { id: string }) => event.id === requested.id,
    ),
  ).toBe(false)
  expect(
    (await call(OTHER, 'GET', '/v1/housing/activity')).body.items.some(
      (event: { id: string }) => event.id === requested.id,
    ),
  ).toBe(false)
  expect((await call(OTHER, 'POST', `/v1/housing/activity/${requested.id}/read`, {})).status).toBe(404)
  expect(
    (await call(OWNER, 'GET', '/v1/landlord/contact-requests')).body.items.find(
      (row: { id: string }) => row.id === cr.id,
    ).update_unread,
  ).toBe(true)
  expect((await call(OWNER, 'POST', `/v1/housing/activity/${requested.id}/read`, {})).status).toBe(200)
  expect(
    (await call(OWNER, 'GET', '/v1/landlord/contact-requests')).body.items.find(
      (row: { id: string }) => row.id === cr.id,
    ).update_unread,
  ).toBe(false)
  expect(
    (
      await call(TENANT, 'POST', `/v1/landlord/contact-requests/${cr.id}/viewing`, {
        decision: 'confirm',
        revision: cr.revision,
      })
    ).status,
  ).toBe(409)
  expect(
    (
      await call(OWNER, 'POST', `/v1/landlord/contact-requests/${cr.id}/viewing`, {
        decision: 'confirm',
        revision: cr.revision,
      })
    ).status,
  ).toBe(200)
  const confirmed = (await call(TENANT, 'GET', '/v1/housing/activity')).body.items.find(
    (event: { contact_id: string; kind: string }) =>
      event.contact_id === cr.id && event.kind === 'viewing_confirmed',
  )
  expect(confirmed).toMatchObject({ audience: 'tenant', property_id: propertyId })
  expect(new Date(confirmed.payload.slot).toISOString()).toBe(slot)
  const timeline = (await call(TENANT, 'GET', `/v1/housing/contact-requests/${cr.id}/activity`)).body.items
  expect(timeline.map((event: { kind: string }) => event.kind)).toContain('viewing_requested')
  expect((await call(OTHER, 'GET', `/v1/housing/contact-requests/${cr.id}/activity`)).status).toBe(404)
  expect((await call(TENANT, 'POST', `/v1/housing/activity/${confirmed.id}/read`, {})).status).toBe(200)
  expect(
    (await call(TENANT, 'GET', '/v1/housing/activity')).body.items.find(
      (event: { id: string }) => event.id === confirmed.id,
    ).unread,
  ).toBe(false)
  expect((await call(TENANT, 'GET', '/v1/housing/activity?admin=true')).status).toBe(403)
  await admin.query(
    "UPDATE housing.managed_listings SET publication_status='pending_review' WHERE listing_id=$1",
    [result.body.id],
  )
  const queue = (await call(MODERATOR, 'GET', '/v1/housing/activity?admin=true')).body.items
  expect(
    queue.find(
      (event: { listing_id: string; kind: string }) =>
        event.listing_id === result.body.id && event.kind === 'listing_submitted',
    ),
  ).toMatchObject({ audience: 'admin', property_id: propertyId })
  await host(MODERATOR)
  const ownNotice = (await call(MODERATOR, 'GET', '/v1/housing/activity?admin=true')).body.items.find(
    (event: { subject_user_id: string; kind: string }) =>
      event.subject_user_id === MODERATOR && event.kind === 'host_submitted',
  )
  expect(ownNotice).toBeDefined()
  expect(
    (
      await call(MODERATOR, 'POST', `/v1/moderation/host/${MODERATOR}/review`, {
        decision: 'verify',
        method: 'in_person',
      })
    ).status,
  ).toBe(403)
})

it('revenue: estimated from rent x days rented, never deposits, and scoped to the owner', async () => {
  const owner = `test-revenue-owner-${run}`, tenant = `test-revenue-tenant-${run}`
  await host(owner)
  await call(MODERATOR, 'POST', `/v1/moderation/host/${owner}/review`, {decision:'verify',method:'phone_call'})
  const p = await property(owner)
  await call(MODERATOR, 'POST', `/v1/moderation/housing/properties/${p}/approve`, {})
  const paidRoom = await listing(owner, await unit(owner,p,'V.1'), [])
  const manualRoom = await listing(owner, await unit(owner,p,'V.2'), [])
  for (const id of [paidRoom, manualRoom]) {
    await call(owner,'POST',`/v1/landlord/listings/${id}/submit`,{})
    await call(MODERATOR,'POST',`/v1/moderation/housing/listings/${id}/review`,{decision:'approve'})
  }
  const today = String((await admin.query(`SELECT to_char((now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,'YYYY-MM-DD') AS d`)).rows[0].d)
  const [year, month, day] = today.split('-').map(Number) as [number, number, number]
  const previous = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 10)
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate()

  // A confirmed transfer opens a period at the agreed move-in with the monthly rent only.
  const slot = new Date(Date.now()+86400000).toISOString()
  const request = (await call(tenant,'PUT',`/v1/housing/${paidRoom}/viewing`,{slot})).body.id
  const path = `/v1/landlord/contact-requests/${request}`
  const revisionOf = async () => (await admin.query('SELECT revision FROM housing.contact_requests WHERE id=$1',[request])).rows[0].revision
  expect((await call(owner,'POST',path+'/viewing',{decision:'confirm',revision:await revisionOf()})).status).toBe(200)
  const report = await call(tenant,'POST',`/v1/housing/${paidRoom}/payment-reports`,{
    report_key:randomUUID(),amount_vnd:9_000_000,paid_on:previous,
    agreement:{deposit_vnd:4_000_000,first_month_vnd:5_000_000,rent_vnd:5_000_000,move_in:previous},
  })
  expect(report.status, JSON.stringify(report.body)).toBe(201)
  expect((await call(owner,'POST',path+'/payment-review',{report_id:report.body.id,revision:report.body.revision,decision:'confirm'})).status).toBe(200)

  // A room marked rented by hand opens today at its listed rent; marking it vacant closes it.
  const availability = async (status: string) => {
    const revision = (await call(owner,'GET',`/v1/landlord/listings/${manualRoom}`)).body.revision
    expect((await call(owner,'POST',`/v1/landlord/listings/${manualRoom}/availability`,{status,revision})).status).toBe(200)
  }
  await availability('rented')
  await availability('rented')
  const periods = async () => (await admin.query(
    'SELECT source,monthly_rent_vnd::float AS rent,to_char(starts_on,$2) AS starts_on,to_char(ends_on,$2) AS ends_on FROM housing.rent_periods WHERE listing_id=$1 ORDER BY created_at',
    [manualRoom,'YYYY-MM-DD'])).rows
  expect(await periods()).toEqual([{source:'manual',rent:4_000_000,starts_on:today,ends_on:null}])

  const revenue = await call(owner,'GET',`/v1/landlord/revenue?months=3&property_id=${p}`)
  expect(revenue.status, JSON.stringify(revenue.body)).toBe(200)
  expect(revenue.body.estimated).toBe(true)
  expect(revenue.body.series.map((m: {month:string}) => m.month)).toHaveLength(3)
  const byMonth = Object.fromEntries(revenue.body.series.map((m: {month:string;total:number}) => [m.month, m.total]))
  expect(byMonth[previous.slice(0, 7)]).toBe(5_000_000)
  expect(byMonth[today.slice(0, 7)]).toBe(Math.round((5_000_000 * day + 4_000_000) / days))
  const row = revenue.body.properties.find((r: {id:string}) => r.id === p)
  expect(row).toMatchObject({units:2,rented_units:2,previous_month:5_000_000})
  expect(revenue.body.total).toBe(byMonth[previous.slice(0, 7)] + byMonth[today.slice(0, 7)])

  await availability('vacant')
  expect((await periods())[0]).toMatchObject({ends_on:today})
  const after = await call(owner,'GET',`/v1/landlord/revenue?months=3&property_id=${p}`)
  expect(after.body.series.at(-1).total).toBe(Math.round(5_000_000 * day / days))

  expect((await call(OTHER,'GET',`/v1/landlord/revenue?property_id=${p}`)).status).toBe(403)
  expect((await call(OTHER,'GET','/v1/landlord/revenue')).body.total).toBe(0)
  expect((await call(owner,'GET','/v1/landlord/revenue?months=4')).status).toBe(400)
})

it('revenue: future move-in earns nothing yet and impossible dates never block payment review or the migration', async () => {
  const owner = `test-revenue-edge-owner-${run}`, tenant = `test-revenue-edge-tenant-${run}`
  await host(owner)
  await call(MODERATOR, 'POST', `/v1/moderation/host/${owner}/review`, {decision:'verify',method:'phone_call'})
  const p = await property(owner)
  await call(MODERATOR, 'POST', `/v1/moderation/housing/properties/${p}/approve`, {})
  const rooms = [await listing(owner, await unit(owner,p,'E.1'), []), await listing(owner, await unit(owner,p,'E.2'), [])]
  for (const id of rooms) {
    await call(owner,'POST',`/v1/landlord/listings/${id}/submit`,{})
    await call(MODERATOR,'POST',`/v1/moderation/housing/listings/${id}/review`,{decision:'approve'})
  }
  const today = String((await admin.query(`SELECT to_char((now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,'YYYY-MM-DD') AS d`)).rows[0].d)
  const dateIn = (days: number) => new Date(Date.parse(today + 'T00:00:00Z') + days * 86_400_000).toISOString().slice(0, 10)
  async function transfer(listingId: string, tenantId: string, agreement: Record<string, unknown>) {
    const request = (await call(tenantId,'PUT',`/v1/housing/${listingId}/viewing`,{slot:new Date(Date.now()+86400000).toISOString()})).body.id
    const path = `/v1/landlord/contact-requests/${request}`
    const revision = async () => (await admin.query('SELECT revision FROM housing.contact_requests WHERE id=$1',[request])).rows[0].revision
    expect((await call(owner,'POST',path+'/viewing',{decision:'confirm',revision:await revision()})).status).toBe(200)
    const report = await call(tenantId,'POST',`/v1/housing/${listingId}/payment-reports`,{report_key:randomUUID(),amount_vnd:9_000_000,paid_on:today,agreement})
    expect(report.status, JSON.stringify(report.body)).toBe(201)
    const review = await call(owner,'POST',path+'/payment-review',{report_id:report.body.id,revision:report.body.revision,decision:'confirm'})
    expect(review.status, JSON.stringify(review.body)).toBe(200)
    return report.body.id as string
  }
  const monthTotal = async () => {
    const revenue = await call(owner,'GET',`/v1/landlord/revenue?months=3&property_id=${p}`)
    expect(revenue.status, JSON.stringify(revenue.body)).toBe(200)
    return revenue.body
  }

  // A move-in later than today has not produced revenue; it must never go negative.
  await transfer(rooms[0]!, tenant, { rent_vnd: 5_000_000, first_month_vnd: 5_000_000, deposit_vnd: 5_000_000, move_in: dateIn(3) })
  const future = await monthTotal()
  expect(future.series.every((m: { total: number }) => m.total === 0)).toBe(true)
  expect(future.total).toBe(0)
  expect(future.properties[0]).toMatchObject({ current_month: 0, previous_month: 0 })

  // An impossible calendar date used to be accepted by the report API; it falls back to the transfer date.
  const bad = `test-revenue-edge-bad-${run}`
  const reportId = await transfer(rooms[1]!, bad, { rent_vnd: 6_000_000, first_month_vnd: 6_000_000, move_in: '2026-02-31' })
  const period = await admin.query(
    'SELECT to_char(starts_on,$2) AS starts_on,monthly_rent_vnd::float AS rent FROM housing.rent_periods WHERE payment_report_id=$1',
    [reportId, 'YYYY-MM-DD'],
  )
  expect(period.rows).toEqual([{ starts_on: today, rent: 6_000_000 }])

  // The migration backfill reads legacy reports defensively: rerun it over bad dates and amounts.
  await admin.query('DELETE FROM housing.rent_periods WHERE listing_id = ANY($1::uuid[])', [rooms])
  await admin.query(
    `UPDATE housing.rent_payment_reports SET agreement=jsonb_set(agreement,'{move_in}','"2026-02-31"')
    WHERE id=$1`,
    [reportId],
  )
  const other = (await admin.query(
    `SELECT id FROM housing.rent_payment_reports r WHERE r.request_id IN
    (SELECT id FROM housing.contact_requests WHERE listing_id=$1) AND id<>$2`,
    [rooms[0], reportId],
  )).rows[0]
  if (other) await admin.query(`UPDATE housing.rent_payment_reports SET agreement=agreement||'{"rent_vnd":1e30,"first_month_vnd":"abc"}'::jsonb WHERE id=$1`, [other.id])
  const sql = (await import('node:fs')).readFileSync(new URL('../../../deploy/database/migrations/029_housing_rent_periods.sql', import.meta.url), 'utf8')
  await admin.query(sql)
  const restored = await admin.query(
    'SELECT listing_id,to_char(starts_on,$2) AS starts_on,monthly_rent_vnd::float AS rent FROM housing.rent_periods WHERE listing_id = ANY($1::uuid[]) ORDER BY monthly_rent_vnd',
    [rooms, 'YYYY-MM-DD'],
  )
  // An unusable rent falls back to the listed rent and keeps its future move-in;
  // an impossible date falls back to the transfer date.
  expect(restored.rows.map((r: { starts_on: string; rent: number }) => [r.starts_on, r.rent])).toEqual([
    [dateIn(3), 4_000_000],
    [today, 6_000_000],
  ])
})

it.each([
  { name: 'impossible move-in', moveIn: '2026-02-31', rent: 5_000_000, firstMonth: 6_000_000, expectedRent: 5_000_000 },
  { name: 'empty move-in', moveIn: '', rent: 5_000_000, firstMonth: 6_000_000, expectedRent: 5_000_000 },
  { name: 'missing move-in', moveIn: null, rent: 5_000_000, firstMonth: 6_000_000, expectedRent: 5_000_000 },
  { name: 'year zero', moveIn: '0000-01-01', rent: 5_000_000, firstMonth: 6_000_000, expectedRent: 5_000_000 },
  { name: 'unusable rent with valid first month', moveIn: null, rent: 1e30, firstMonth: 6_000_000, expectedRent: 6_000_000 },
  { name: 'both agreement rents unusable', moveIn: null, rent: 1e30, firstMonth: 0, expectedRent: 4_000_000 },
])('revenue fallback: $name agrees between payment confirmation and migration', async ({ moveIn, rent, firstMonth, expectedRent }) => {
  const owner = `test-rent-fallback-owner-${randomUUID()}-${run}`, tenant = `test-rent-fallback-tenant-${randomUUID()}-${run}`
  await host(owner)
  expect((await call(MODERATOR, 'POST', `/v1/moderation/host/${owner}/review`, { decision: 'verify', method: 'phone_call' })).status).toBe(200)
  const p = await property(owner)
  expect((await call(MODERATOR, 'POST', `/v1/moderation/housing/properties/${p}/approve`, {})).status).toBe(200)
  const room = await listing(owner, await unit(owner, p, 'F.1'), [])
  expect((await call(owner, 'POST', `/v1/landlord/listings/${room}/submit`, {})).status).toBe(200)
  expect((await call(MODERATOR, 'POST', `/v1/moderation/housing/listings/${room}/review`, { decision: 'approve' })).status).toBe(200)
  const request = await call(tenant, 'PUT', `/v1/housing/${room}/viewing`, { slot: new Date(Date.now() + 86400000).toISOString() })
  expect(request.status).toBe(201)
  const requestId = request.body.id
  const revision = (await admin.query('SELECT revision FROM housing.contact_requests WHERE id=$1', [requestId])).rows[0].revision
  expect((await call(owner, 'POST', `/v1/landlord/contact-requests/${requestId}/viewing`, { decision: 'confirm', revision })).status).toBe(200)

  // A previous-month payment distinguishes paid_on from today's review date.
  const dates = (await admin.query(`SELECT
    to_char(date_trunc('month',(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)-interval '1 month','YYYY-MM-DD') AS paid_on`)).rows[0]
  const report = await call(tenant, 'POST', `/v1/housing/${room}/payment-reports`, {
    report_key: randomUUID(), amount_vnd: 9_000_000, paid_on: dates.paid_on,
    agreement: { move_in: moveIn, rent_vnd: rent, first_month_vnd: firstMonth, deposit_vnd: 4_000_000 },
  })
  expect(report.status, JSON.stringify(report.body)).toBe(201)
  const reviewed = await call(owner, 'POST', `/v1/landlord/contact-requests/${requestId}/payment-review`, {
    report_id: report.body.id, revision: report.body.revision, decision: 'confirm',
  })
  expect(reviewed.status, JSON.stringify(reviewed.body)).toBe(200)
  expect(reviewed.body.status).toBe('confirmed')
  const periodSql = `SELECT to_char(starts_on,'YYYY-MM-DD') AS starts_on,monthly_rent_vnd::float AS rent
    FROM housing.rent_periods WHERE payment_report_id=$1`
  const actual = (await admin.query(periodSql, [report.body.id])).rows
  expect(actual).toEqual([{ starts_on: dates.paid_on, rent: expectedRent }])

  const revenue = await call(owner, 'GET', `/v1/landlord/revenue?months=3&property_id=${p}`)
  expect(revenue.status).toBe(200)
  const months = Object.fromEntries(revenue.body.series.map((m: { month: string; total: number }) => [m.month, m.total]))
  expect(months[String(dates.paid_on).slice(0, 7)]).toBe(expectedRent)

  // Rebuild the same report with the migration, but roll back all backfill changes.
  const sql = (await import('node:fs')).readFileSync(new URL('../../../deploy/database/migrations/029_housing_rent_periods.sql', import.meta.url), 'utf8')
  const client = await admin.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM housing.rent_periods WHERE payment_report_id=$1', [report.body.id])
    await client.query(sql)
    expect((await client.query(periodSql, [report.body.id])).rows).toEqual(actual)
  } finally {
    await client.query('ROLLBACK')
    client.release()
  }
})

async function closedRentFixture() {
  const owner = `test-rent-overlap-owner-${randomUUID()}-${run}`
  await host(owner)
  expect((await call(MODERATOR, 'POST', `/v1/moderation/host/${owner}/review`, {
    decision: 'verify', method: 'phone_call',
  })).status).toBe(200)
  const propertyId = await property(owner)
  expect((await call(MODERATOR, 'POST', `/v1/moderation/housing/properties/${propertyId}/approve`, {})).status).toBe(200)
  const room = await listing(owner, await unit(owner, propertyId, 'O.1'), [])
  const listingRevision = (await call(owner, 'GET', `/v1/landlord/listings/${room}`)).body.revision
  expect((await call(owner, 'PATCH', `/v1/landlord/listings/${room}`, {
    revision: listingRevision, rent_vnd: 5_000_000,
  })).status).toBe(200)
  expect((await call(owner, 'POST', `/v1/landlord/listings/${room}/submit`, {})).status).toBe(200)
  expect((await call(MODERATOR, 'POST', `/v1/moderation/housing/listings/${room}/review`, { decision: 'approve' })).status).toBe(200)
  const dates = (await admin.query(`SELECT
    to_char((now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,'YYYY-MM-DD') AS today,
    to_char(date_trunc('month',(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)-interval '1 month','YYYY-MM-DD') AS previous,
    to_char(date_trunc('month',(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)-interval '2 months','YYYY-MM-DD') AS earlier`)).rows[0]
  const reportFor = async (moveIn: string, rent = 5_000_000) => {
    const tenant = `test-rent-overlap-tenant-${randomUUID()}-${run}`
    const request = await call(tenant, 'PUT', `/v1/housing/${room}/viewing`, {
      slot: new Date(Date.now() + 86400000).toISOString(),
    })
    expect(request.status, JSON.stringify(request.body)).toBe(201)
    const requestId = request.body.id as string
    const revision = (await admin.query('SELECT revision FROM housing.contact_requests WHERE id=$1', [requestId])).rows[0].revision
    expect((await call(owner, 'POST', `/v1/landlord/contact-requests/${requestId}/viewing`, {
      decision: 'confirm', revision,
    })).status).toBe(200)
    const report = await call(tenant, 'POST', `/v1/housing/${room}/payment-reports`, {
      report_key: randomUUID(), amount_vnd: rent, paid_on: dates.today,
      agreement: { move_in: moveIn, rent_vnd: rent, first_month_vnd: rent },
    })
    expect(report.status, JSON.stringify(report.body)).toBe(201)
    return { requestId, report: report.body }
  }
  const confirm = async ({ requestId, report }: Awaited<ReturnType<typeof reportFor>>) =>
    call(owner, 'POST', `/v1/landlord/contact-requests/${requestId}/payment-review`, {
      report_id: report.id, revision: report.revision, decision: 'confirm',
    })
  const first = await reportFor(dates.previous)
  const confirmed = await confirm(first)
  expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200)
  const revision = (await call(owner, 'GET', `/v1/landlord/listings/${room}`)).body.revision
  expect((await call(owner, 'POST', `/v1/landlord/listings/${room}/availability`, {
    status: 'vacant', revision,
  })).status).toBe(200)
  const periods = async () => (await admin.query(`SELECT id,payment_report_id,
    to_char(starts_on,'YYYY-MM-DD') AS starts_on,to_char(ends_on,'YYYY-MM-DD') AS ends_on,
    monthly_rent_vnd::float AS rent FROM housing.rent_periods WHERE listing_id=$1 ORDER BY starts_on,id`, [room])).rows
  expect(await periods()).toEqual([{
    id: expect.any(String), payment_report_id: first.report.id,
    starts_on: dates.previous, ends_on: dates.today, rent: 5_000_000,
  }])
  const revenue = async () => {
    const result = await call(owner, 'GET', `/v1/landlord/revenue?months=3&property_id=${propertyId}`)
    expect(result.status, JSON.stringify(result.body)).toBe(200)
    return result.body
  }
  return { owner, room, dates, reportFor, confirm, periods, revenue }
}

it.each([
  { name: 'the same start as the closed tenancy', start: 'previous' },
  { name: 'a start before the closed tenancy', start: 'earlier' },
])('revenue overlap: payment review rejects $name without changing committed state', async ({ start }) => {
  const fixture = await closedRentFixture()
  const pending = await fixture.reportFor(fixture.dates[start])
  const beforePeriods = await fixture.periods()
  const beforeRevenue = await fixture.revenue()
  expect(beforeRevenue.series.find((month: { month: string }) => month.month === fixture.dates.previous.slice(0, 7)).total).toBe(5_000_000)
  const state = async () => ({
    report: (await admin.query('SELECT * FROM housing.rent_payment_reports WHERE id=$1', [pending.report.id])).rows[0],
    contact: (await admin.query('SELECT * FROM housing.contact_requests WHERE id=$1', [pending.requestId])).rows[0],
    listing: (await admin.query('SELECT * FROM housing.managed_listings WHERE listing_id=$1', [fixture.room])).rows[0],
  })
  const before = await state()
  expect(before.report.status).toBe('pending')
  expect(before.listing.availability_status).toBe('vacant')

  const reviewed = await fixture.confirm(pending)

  expect([reviewed.status, reviewed.body.code], JSON.stringify(reviewed.body)).toEqual([409, 'rent_period_overlap'])
  expect(await state()).toEqual(before)
  expect(await fixture.periods()).toEqual(beforePeriods)
  expect(await fixture.revenue()).toEqual(beforeRevenue)
})

it('revenue overlap: a new tenancy may start exactly on the prior exclusive end date', async () => {
  const fixture = await closedRentFixture()
  const beforePeriods = await fixture.periods()
  const boundary = beforePeriods[0]!.ends_on
  const pending = await fixture.reportFor(boundary, 7_000_000)

  const reviewed = await fixture.confirm(pending)

  expect(reviewed.status, JSON.stringify(reviewed.body)).toBe(200)
  expect(reviewed.body.status).toBe('confirmed')
  expect(await fixture.periods()).toEqual([
    beforePeriods[0],
    { id: expect.any(String), payment_report_id: pending.report.id, starts_on: boundary, ends_on: null, rent: 7_000_000 },
  ])
  const revenue = await fixture.revenue()
  expect(revenue.series.find((month: { month: string }) => month.month === fixture.dates.previous.slice(0, 7)).total).toBe(5_000_000)
  const [year, month, day] = fixture.dates.today.split('-').map(Number) as [number, number, number]
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  expect(revenue.series.find((entry: { month: string }) => entry.month === fixture.dates.today.slice(0, 7)).total)
    .toBe(Math.round((5_000_000 * (day - 1) + 7_000_000) / daysInMonth))
})

it('revenue overlap: the database rejects overlapping direct inserts and updates', async () => {
  const fixture = await closedRentFixture()
  const before = await fixture.periods()
  await expect(pool.query(`INSERT INTO housing.rent_periods
    (listing_id,monthly_rent_vnd,starts_on,ends_on,source) VALUES($1,7000000,$2,$3,'manual')`,
    [fixture.room, fixture.dates.previous, fixture.dates.today]))
    .rejects.toMatchObject({ code: '23P01', constraint: 'rent_periods_no_overlap' })
  expect(await fixture.periods()).toEqual(before)

  const next = await pool.query(`INSERT INTO housing.rent_periods
    (listing_id,monthly_rent_vnd,starts_on,source) VALUES($1,7000000,$2,'manual') RETURNING id`,
    [fixture.room, fixture.dates.today])
  const adjacent = await fixture.periods()
  await expect(pool.query('UPDATE housing.rent_periods SET starts_on=$2 WHERE id=$1',
    [next.rows[0].id, fixture.dates.previous]))
    .rejects.toMatchObject({ code: '23P01', constraint: 'rent_periods_no_overlap' })
  expect(await fixture.periods()).toEqual(adjacent)
})

it('revenue overlap: concurrent transactions cannot commit intersecting closed periods', async () => {
  const fixture = await closedRentFixture()
  const [first, second] = await Promise.all([pool.connect(), pool.connect()])
  try {
    await Promise.all([first.query('BEGIN'), second.query('BEGIN')])
    const inserted = await first.query(`INSERT INTO housing.rent_periods
      (listing_id,monthly_rent_vnd,starts_on,ends_on,source)
      VALUES($1,7000000,$2::date+1,$2::date+3,'manual') RETURNING id`, [fixture.room, fixture.dates.today])
    // Attach the rejection handler before committing the competing transaction.
    const competing = second.query(`INSERT INTO housing.rent_periods
      (listing_id,monthly_rent_vnd,starts_on,ends_on,source)
      VALUES($1,8000000,$2::date+2,$2::date+4,'manual')`, [fixture.room, fixture.dates.today])
      .then(() => ({ code: 'committed', constraint: '' }), (error: { code: string; constraint: string }) => error)
    await first.query('COMMIT')
    expect(await competing).toMatchObject({ code: '23P01', constraint: 'rent_periods_no_overlap' })
    await second.query('ROLLBACK')
    const periods = await fixture.periods()
    expect(periods).toHaveLength(2)
    expect(periods.find(period => period.id === inserted.rows[0].id)?.rent).toBe(7_000_000)
  } finally {
    await Promise.all([first.query('ROLLBACK'), second.query('ROLLBACK')])
    first.release()
    second.release()
  }
})

it('revenue overlap: migration refuses conflicting legacy history without rewriting dates', async () => {
  const fixture = await closedRentFixture()
  const before = await fixture.periods()
  const sql = (await import('node:fs')).readFileSync(
    new URL('../../../deploy/database/migrations/030_housing_rent_period_overlap.sql', import.meta.url), 'utf8')
  const client = await admin.connect()
  try {
    await client.query('BEGIN')
    await client.query('ALTER TABLE housing.rent_periods DROP CONSTRAINT rent_periods_no_overlap')
    await client.query(`INSERT INTO housing.rent_periods
      (listing_id,monthly_rent_vnd,starts_on,ends_on,source) VALUES($1,7000000,$2,$3,'manual')`,
      [fixture.room, fixture.dates.previous, fixture.dates.today])
    await expect(client.query(sql)).rejects.toMatchObject({
      code: 'P0001', message: 'Existing housing rent periods overlap; migration 030 cannot be applied',
    })
  } finally {
    await client.query('ROLLBACK')
    client.release()
  }
  expect(await fixture.periods()).toEqual(before)
})
