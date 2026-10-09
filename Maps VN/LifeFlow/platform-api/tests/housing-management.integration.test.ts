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

async function call(user: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) {
  const response = await app.inject({
    method,
    url,
    payload: payload as never,
    headers: { authorization: `Bearer ${TOKEN}`, 'x-user-id': user },
  })
  return { status: response.statusCode, body: response.body ? response.json() : null }
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
  await admin?.end() // the app closes its own pool
  delete process.env.AGENT_API_TOKEN
  delete process.env.HOUSING_MODERATOR_IDS
})

describe('Housing Product V1 rules (SPEC-021)', () => {
  it('AC-02/03/05/06: owner workflow, moderation, contact lifecycle and real counters', async () => {
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
    const own = await property(MODERATOR)
    expect((await call(MODERATOR, 'POST', `/v1/moderation/housing/properties/${own}/approve`, {})).status).toBe(403)
    const room = await unit(MODERATOR, own, 'P.201')
    const draft = await listing(MODERATOR, room, [])
    expect((await call(MODERATOR, 'POST', `/v1/moderation/housing/listings/${draft}/review`, { decision: 'approve' })).status).toBe(403)
  })
})
