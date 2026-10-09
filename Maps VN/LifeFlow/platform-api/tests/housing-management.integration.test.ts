// SPEC-021 business rules against the real PostGIS schema (needs a migrated local database).
// Every row created here belongs to random test actors and is removed with the admin role afterwards.
import { randomUUID } from 'node:crypto'
import { createDatabasePool, getRuntimeConfig } from '@lifeflow/housing-query'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'

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
  const response = await app.inject({
    method,
    url,
    payload: payload as never,
    headers: { authorization: `Bearer ${TOKEN}`, 'x-user-id': user },
  })
  return { status: response.statusCode, body: response.body ? response.json() : null }
}

async function host(user: string, poster_type = 'owner') {
  const existing = (await call(user, 'GET', '/v1/host/profile')).body.profile
  if (existing) return existing
  const result = await call(user, 'PUT', '/v1/host/profile', {
    poster_type, display_name: `Người đăng ${run}`, legal_name: `Nguyễn Văn ${run}`, phone: '0901 234 567',
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
  })
  expect(result.status).toBe(201)
  created.push(result.body.id)
  return result.body.id as string
}

async function unit(user: string, propertyId: string, code: string) {
  const result = await call(user, 'POST', `/v1/landlord/properties/${propertyId}/units`, {
    unit_code: code, bedrooms: 1, bathrooms: 1, area_m2: 20, amenities: [],
  })
  expect(result.status).toBe(201)
  return result.body.id as string
}

async function listing(user: string, unitId: string, fees: unknown[]) {
  const result = await call(user, 'POST', `/v1/landlord/units/${unitId}/listing`, {
    title: `Phòng kiểm thử ${run}`, rent_vnd: 4_000_000, deposit_vnd: 4_000_000, fees,
  })
  expect(result.status).toBe(201)
  return result.body.id as string
}

beforeAll(async () => {
  process.env.AGENT_API_TOKEN = TOKEN
  process.env.HOUSING_MODERATOR_IDS = MODERATOR
  const config = getRuntimeConfig()
  pool = createDatabasePool(config.databaseUrl, 2)
  admin = createDatabasePool(config.adminDatabaseUrl, 1)
  app = buildApp(pool, config)
  await app.ready()
})

afterAll(async () => {
  await app?.close()
  if (admin && created.length) {
    const places = await admin.query('SELECT place_id FROM housing.properties WHERE id = ANY($1::uuid[])', [created])
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
      { code: 'electricity', label: 'Điện', amount: 4000, billing_unit: 'kwh', required: true },
    ])
    const listingB = await listing(OWNER, roomB, [
      { code: 'electricity', label: 'Điện', amount: 3500, billing_unit: 'kwh', required: true },
      { code: 'service', label: 'Dịch vụ', amount: null, billing_unit: 'month', required: true },
    ])

    // AC-02: two rooms with their own fees; another account sees nothing of it.
    const detail = await call(OWNER, 'GET', `/v1/landlord/properties/${propertyId}`)
    expect(detail.body.units.map((u: { unit_code: string }) => u.unit_code)).toEqual(['P.101', 'P.102'])
    const feesB = await call(OWNER, 'GET', `/v1/landlord/listings/${listingB}`)
    expect(feesB.body.fees.find((f: { code: string }) => f.code === 'service').amount).toBeNull()
    expect((await call(OTHER, 'GET', `/v1/landlord/properties/${propertyId}`)).status).toBe(403)
    expect((await call(OTHER, 'PATCH', `/v1/landlord/listings/${listingA}`, { revision: 1, title: 'Đổi tên trái phép' })).status).toBe(403)
    expect((await call(OTHER, 'GET', '/v1/landlord/properties')).body.items).toEqual([])
    // Owners can correct the address of their own property; the reader key `raw` follows it.
    const moved = await call(OWNER, 'PATCH', `/v1/landlord/properties/${propertyId}`, {
      revision: detail.body.revision, address: { full_address: `Địa chỉ kiểm thử ${run}` },
    })
    expect(moved.status, JSON.stringify(moved.body)).toBe(200)
    expect((await call(OTHER, 'PATCH', `/v1/landlord/properties/${propertyId}`, { revision: moved.body.revision, name: 'Chiếm quyền' })).status).toBe(403)

    // AC-03: drafts are not public and need an approved property before review.
    expect((await app.inject({ method: 'GET', url: `/v1/housing/${listingA}` })).statusCode).toBe(404)
    expect((await call(OWNER, 'POST', `/v1/landlord/listings/${listingA}/submit`, {})).status).toBe(403)
    expect((await call(OWNER, 'POST', `/v1/moderation/housing/properties/${propertyId}/approve`, {})).status).toBe(403)
    // HM-03: the poster must be verified before their property is.
    const early = await call(MODERATOR, 'POST', `/v1/moderation/housing/properties/${propertyId}/approve`, {})
    expect([early.status, early.body.code]).toEqual([409, 'host_not_verified'])
    expect((await call(MODERATOR, 'POST', `/v1/moderation/host/${OWNER}/review`, { decision: 'verify', method: 'video_call' })).status).toBe(200)
    expect((await call(MODERATOR, 'POST', `/v1/moderation/housing/properties/${propertyId}/approve`, {})).status).toBe(200)
    expect((await call(OWNER, 'POST', `/v1/landlord/listings/${listingA}/submit`, {})).status).toBe(200)
    const queue = await call(MODERATOR, 'GET', '/v1/moderation/housing/queue')
    expect(queue.body.listings.map((l: { id: string }) => l.id)).toContain(listingA)
    expect((await call(TENANT, 'POST', `/v1/housing/${listingA}/contact-requests`, { message: 'Còn phòng không?' })).status).toBe(409)
    const approved = await call(MODERATOR, 'POST', `/v1/moderation/housing/listings/${listingA}/review`, { decision: 'approve' })
    expect(approved.body.publication_status).toBe('published')
    const publicDetail = await app.inject({ method: 'GET', url: `/v1/housing/${listingA}` })
    expect(publicDetail.statusCode, publicDetail.body).toBe(200)
    expect(publicDetail.json().management.accepts_contact_requests).toBe(true)
    expect(publicDetail.json().fees[0].billing_unit).toBe('kwh')
    expect(publicDetail.json().address.raw).toBe(`Địa chỉ kiểm thử ${run}`)
    // HM-05: tenants see the poster label, never identity fields.
    expect(publicDetail.json().management).toMatchObject({ poster_type: 'owner', poster_name: `Người đăng ${run}`, host_verified: true })
    expect(publicDetail.body).not.toContain('0901 234 567')
    expect(publicDetail.body).not.toContain(`Nguyễn Văn ${run}`)
    // AC-01: the approved listing also parses through the existing search contract.
    const search = await app.inject({
      method: 'POST', url: '/v1/housing/search',
      payload: { center: { lat: 10.7769, lng: 106.7009 }, radius_m: 50, text: `kiểm thử ${run}`, limit: 50 },
    })
    expect(search.statusCode, search.body).toBe(200)
    expect(search.json().results.map((r: { listing_id: string }) => r.listing_id)).toContain(listingA)

    // AC-05: one open request per tenant and listing; only managers of that property see it.
    const sent = await call(TENANT, 'POST', `/v1/housing/${listingA}/contact-requests`, { message: 'Còn phòng không?' })
    expect(sent.status).toBe(201)
    expect((await call(TENANT, 'POST', `/v1/housing/${listingA}/contact-requests`, { message: 'Gửi lại' })).status).toBe(409)
    const inbox = await call(OWNER, 'GET', '/v1/landlord/contact-requests')
    expect(inbox.body.items.map((i: { id: string }) => i.id)).toContain(sent.body.id)
    expect((await call(OTHER, 'GET', '/v1/landlord/contact-requests')).body.items).toEqual([])
    const viewing = await call(OWNER, 'PATCH', `/v1/landlord/contact-requests/${sent.body.id}`, { status: 'viewing', revision: 1 })
    expect(viewing.body?.status, JSON.stringify(viewing)).toBe('viewing')
    expect((await call(OTHER, 'PATCH', `/v1/landlord/contact-requests/${sent.body.id}`, { status: 'resolved', revision: 2 })).status).toBe(409)
    const mine = await call(TENANT, 'GET', '/v1/housing/contact-requests/me')
    expect(mine.body.items[0]).toMatchObject({ id: sent.body.id, status: 'viewing' })
    expect((await call(TENANT, 'POST', `/v1/housing/contact-requests/${sent.body.id}/cancel`, { revision: 2 })).status).toBe(409)

    // AC-03: a rented room leaves public reads and stops taking requests.
    const revision = (await call(OWNER, 'GET', `/v1/landlord/listings/${listingA}`)).body.revision
    expect((await call(OWNER, 'POST', `/v1/landlord/listings/${listingA}/availability`, { status: 'rented', revision })).status).toBe(200)
    expect((await app.inject({ method: 'GET', url: `/v1/housing/${listingA}` })).statusCode).toBe(404)
    expect((await call(OTHER, 'POST', `/v1/housing/${listingA}/contact-requests`, { message: 'Còn không?' })).status).toBe(409)

    // AC-06: counters come only from recorded, de-duplicated events.
    const fresh = await call(OWNER, 'GET', '/v1/landlord/overview')
    expect(fresh.body.detail_views).toBe(0)
    await call(OWNER, 'POST', `/v1/landlord/listings/${listingA}/availability`, { status: 'vacant', revision: revision + 1 })
    for (let i = 0; i < 2; i += 1) {
      await call(TENANT, 'POST', `/v1/housing/${listingA}/events`, { event_type: 'detail_view', dedup_key: `detail:${run}` })
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
    expect((await call(MODERATOR, 'POST', `/v1/moderation/housing/listings/${draft}/review`, { decision: 'approve' })).status).toBe(403)
  })

  it('HM-02..07: poster profile gates property creation and review', async () => {
    const broker = `test-broker-${run}`
    // HM-02: no profile, no property.
    const blocked = await call(broker, 'POST', '/v1/landlord/properties', {
      name: `Nhà môi giới ${run}`, property_type: 'room', address: { full_address: 'x' }, location: { lat: 10.78, lng: 106.7 },
    })
    expect([blocked.status, blocked.body.code]).toEqual([409, 'host_profile_required'])
    expect((await call(broker, 'GET', '/v1/host/profile')).body.profile).toBeNull()
    const profile = await host(broker, 'broker')
    expect(profile.status).toBe('pending')
    // HM-04: only moderators review, never their own profile; others cannot read it.
    expect((await call(OTHER, 'POST', `/v1/moderation/host/${broker}/review`, { decision: 'verify', method: 'phone_call' })).status).toBe(403)
    expect((await call(OTHER, 'GET', '/v1/host/profile')).body.profile?.user_id ?? null).not.toBe(broker)
    await host(MODERATOR)
    expect((await call(MODERATOR, 'POST', `/v1/moderation/host/${MODERATOR}/review`, { decision: 'verify', method: 'phone_call' })).status).toBe(403)
    const queue = await call(MODERATOR, 'GET', '/v1/moderation/housing/queue')
    const queued = queue.body.hosts.find((h: { user_id: string }) => h.user_id === broker)
    expect(queued).toMatchObject({ poster_type: 'broker', phone: '0901 234 567' })
    expect(queue.body.hosts.map((h: { user_id: string }) => h.user_id)).not.toContain(MODERATOR)
    // needs_info shows the reason to the poster; saving again sends it back for review.
    await call(MODERATOR, 'POST', `/v1/moderation/host/${broker}/review`, { decision: 'needs_info', reason: 'Thiếu số chứng chỉ' })
    const asked = (await call(broker, 'GET', '/v1/host/profile')).body.profile
    expect([asked.status, asked.info_request]).toEqual(['needs_info', 'Thiếu số chứng chỉ'])
    const resent = await call(broker, 'PUT', '/v1/host/profile', {
      poster_type: 'broker', display_name: asked.display_name, legal_name: asked.legal_name, phone: asked.phone,
      broker_license_no: 'CC-123', revision: asked.revision,
    })
    expect(resent.body.profile.status).toBe('pending')
    await call(MODERATOR, 'POST', `/v1/moderation/host/${broker}/review`, { decision: 'verify', method: 'phone_call' })
    // HM-06: a display-name change keeps verification; an identity change does not.
    let current = (await call(broker, 'GET', '/v1/host/profile')).body.profile
    const renamed = await call(broker, 'PUT', '/v1/host/profile', { ...current, display_name: 'Tên mới', revision: current.revision })
    expect(renamed.body.profile.status).toBe('verified')
    current = renamed.body.profile
    const moved = await call(broker, 'PUT', '/v1/host/profile', { ...current, phone: '0909 999 999', revision: current.revision })
    expect(moved.body.profile.status).toBe('pending')
    // HM-07: a configured terms version must be accepted before posting.
    process.env.HOST_TERMS_VERSION = `t-${run}`
    try {
      const terms = await call(broker, 'POST', '/v1/landlord/properties', {
        name: `Nhà môi giới ${run}`, property_type: 'room', address: { full_address: 'x' }, location: { lat: 10.78, lng: 106.7 },
      })
      expect(terms.body.code).toBe('host_terms_required')
      current = moved.body.profile
      const accepted = await call(broker, 'PUT', '/v1/host/profile', { ...current, accept_terms_version: `t-${run}`, revision: current.revision })
      expect(accepted.body.profile.terms_version).toBe(`t-${run}`)
      await property(broker)
    } finally {
      delete process.env.HOST_TERMS_VERSION
    }
  })
})
