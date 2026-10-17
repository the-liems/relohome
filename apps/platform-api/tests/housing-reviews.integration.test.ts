import { createHmac, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDatabasePool, getRuntimeConfig } from '@relohome/housing-query'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { signLocation } from '../src/housing-location.js'

const run = randomUUID().slice(0, 8)
const owner = `review-owner-${run}`,
  moderator = `review-mod-${run}`,
  stranger = `review-other-${run}`
const tenants = [1, 2, 3].map(n => `review-tenant-${n}-${run}`)
const token = `review-token-${run}`
let app: FastifyInstance, admin: ReturnType<typeof createDatabasePool>
const properties: string[] = [],
  listings: string[] = []
async function call(user: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) {
  const body = payload as Record<string, unknown> | undefined
  if (method === 'POST' && body && body.revision === undefined) {
    const match = url.match(/\/(host|properties|listings)\/([^/]+)\/(review|approve|submit)$/)
    if (match) {
      const table =
        match[1] === 'host'
          ? 'housing.host_profiles'
          : match[1] === 'properties'
            ? 'housing.properties'
            : 'housing.managed_listings'
      const column = match[1] === 'host' ? 'user_id' : match[1] === 'properties' ? 'id' : 'listing_id'
      const result = await admin.query(`SELECT revision FROM ${table} WHERE ${column}=$1`, [match[2]])
      if (result.rows[0]) payload = { ...body, revision: result.rows[0].revision }
    }
  }
  const signature =
    url.endsWith('/media') && body
      ? createHmac('sha256', token)
          .update(`${url.split('/')[4]}\n${body.url}\n${body.content_sha256}`)
          .digest('hex')
      : undefined
  const response = await app.inject({
    method,
    url,
    payload: payload as never,
    headers: {
      authorization: `Bearer ${token}`,
      'x-user-id': user,
      ...(signature ? { 'x-housing-media-signature': signature } : {}),
    },
  })
  return { status: response.statusCode, body: response.json() }
}
beforeAll(async () => {
  process.env.AGENT_API_TOKEN = token
  process.env.HOUSING_MODERATOR_IDS = moderator
  const config = getRuntimeConfig()
  admin = createDatabasePool(config.adminDatabaseUrl, 1)
  app = buildApp(createDatabasePool(config.databaseUrl, 2), config)
  await app.ready()
  await call(owner, 'PUT', '/v1/host/profile', {
    poster_type: 'owner',
    display_name: 'Chủ nhà kiểm thử',
    legal_name: 'Người kiểm thử',
    phone: '0901234567',
  })
  await call(moderator, 'POST', `/v1/moderation/host/${owner}/review`, {
    decision: 'verify',
    method: 'phone_call',
  })
  for (let n = 1; n <= 2; n++) {
    const property = await call(owner, 'POST', '/v1/landlord/properties', {
      name: `Nhà đánh giá ${n}`,
      property_type: 'room',
      address: { full_address: 'Địa chỉ kiểm thử' },
      location: { lat: 10.776, lng: 106.7 },
      location_confirmed: true,
      location_token: signLocation(owner, {
        ref_id: 'review-ref',
        address: 'Địa chỉ kiểm thử',
        location: { lat: 10.776, lng: 106.7 },
      }),
    })
    expect(property.status).toBe(201)
    properties.push(property.body.id)
    await call(moderator, 'POST', `/v1/moderation/housing/properties/${property.body.id}/approve`, {})
    const unit = await call(owner, 'POST', `/v1/landlord/properties/${property.body.id}/units`, {
      unit_code: 'P.101',
      area_m2: 20,
    })
    const listing = await call(owner, 'POST', `/v1/landlord/units/${unit.body.id}/listing`, {
      title: 'Phòng kiểm thử đánh giá',
      description: 'Phòng kiểm thử nội dung đầy đủ.',
      rent_vnd: 4000000,
    })
    listings.push(listing.body.id)
    await call(owner, 'POST', `/v1/landlord/listings/${listing.body.id}/media`, {
      url: 'http://localhost/web/media/housing/' + String(n).repeat(40) + '.png',
      content_sha256: String(n).repeat(64),
    })
    await call(owner, 'POST', `/v1/landlord/listings/${listing.body.id}/submit`, {})
    await call(moderator, 'POST', `/v1/moderation/housing/listings/${listing.body.id}/review`, { decision: 'approve' })
    for (const tenant of tenants)
      await call(tenant, 'POST', `/v1/housing/${listing.body.id}/contact-requests`, {
        message: 'Tôi muốn tìm hiểu phòng.',
      })
  }
  // Existing review scenarios start with completed appointments, rather than contact-only requests.
  await admin.query(`UPDATE housing.contact_requests SET viewing_status='confirmed',
    viewing_slot=now()-interval '1 day',visit_met_at=now()
    WHERE tenant_user_id=ANY($1::text[]) AND listing_id=ANY($2::uuid[])`, [tenants.slice(0, 2), listings])

})
afterAll(async () => {
  await app?.close()
  if (admin && properties.length) {
    const places = await admin.query('SELECT place_id FROM housing.properties WHERE id=ANY($1::uuid[])', [properties])
    await admin.query('DELETE FROM housing.listing_reviews WHERE listing_id=ANY($1::uuid[])', [listings])
    await admin.query('DELETE FROM housing.listings WHERE property_id=ANY($1::uuid[])', [properties])
    await admin.query('DELETE FROM housing.units WHERE property_id=ANY($1::uuid[])', [properties])
    await admin.query('DELETE FROM housing.properties WHERE id=ANY($1::uuid[])', [properties])
    await admin.query('DELETE FROM catalog.places WHERE id=ANY($1::uuid[])', [places.rows.map(r => r.place_id)])
    await admin.query('DELETE FROM housing.host_flags WHERE host_user_id=$1', [owner])
  }
  await admin?.query('DELETE FROM housing.host_profiles WHERE user_id=$1', [owner])
  await admin?.end()
  delete process.env.AGENT_API_TOKEN
  delete process.env.HOUSING_MODERATOR_IDS
  delete process.env.HOUSING_REVIEW_MIN_COUNT
})
describe('landlord stars (housing-feedback-design RV-01..07)', () => {
  it('gates writing and validates public text; begins without zero-star ratings', async () => {
    const page = await call(stranger, 'GET', `/v1/housing/${listings[0]}/reviews`)
    expect(page.status).toBe(200)
    expect(page.body).toMatchObject({
      can_review: false,
      summary: { rating: null, count: 0 },
    })
    expect(
      (
        await call(stranger, 'PUT', `/v1/housing/${listings[0]}/review`, {
          rating: 5,
          body: '',
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await call(owner, 'PUT', `/v1/housing/${listings[0]}/review`, {
          rating: 5,
          body: '',
        })
      ).status,
    ).toBe(403)
    for (const payload of [
      { rating: 0 },
      { rating: 6 },
      { rating: 2.5 },
      { rating: 4, body: 'Gọi tôi 0901 234 567' },
      { rating: 1, body: 'đồ khốn nạn' },
    ]) {
      expect((await call(tenants[0], 'PUT', `/v1/housing/${listings[0]}/review`, payload)).status).toBe(400)
    }
    expect(
      (
        await call(tenants[0], 'PUT', `/v1/housing/${randomUUID()}/review`, {
          rating: 5,
        })
      ).status,
    ).toBe(404)
  })
  it('one review per property, edit/withdraw, owner summary, thresholds and anonymous public reads', async () => {
    const path = `/v1/housing/${listings[0]}/review`
    const first = await call(tenants[0], 'PUT', path, {
      rating: 5,
      body: 'Trao đổi rõ ràng.',
    })
    expect(first.status).toBe(200)
    const edited = await call(tenants[0], 'PUT', path, { rating: 4, body: '' })
    expect(edited.body.id).toBe(first.body.id)
    await call(tenants[1], 'PUT', `/v1/housing/${listings[1]}/review`, {
      rating: 2,
      body: 'Phản hồi chậm.',
      is_anonymous: false,
    })
    const page = (await call(stranger, 'GET', `/v1/housing/${listings[0]}/reviews`)).body
    expect(page.summary).toMatchObject({
      rating: 3,
      count: 2,
      property_count: 2,
      histogram: { '2': 1, '4': 1 },
    })
    // Anonymous is the default; only a public review carries its author for the gateway to name.
    expect(JSON.stringify(page)).not.toContain(tenants[0])
    const anonymous = page.items.find((r: { rating: number }) => r.rating === 4)
    const named = page.items.find((r: { rating: number }) => r.rating === 2)
    expect(anonymous.is_anonymous).toBe(true)
    expect(anonymous).not.toHaveProperty('author_user_id')
    expect(named).toMatchObject({ is_anonymous: false, author_user_id: tenants[1] })
    expect(page.items[0].property_id).toBe(properties[0])
    const detail = await call(stranger, 'GET', `/v1/housing/${listings[0]}`)
    expect(detail.body.management).toMatchObject({
      host_rating: 3,
      host_review_count: 2,
    })
    process.env.HOUSING_REVIEW_MIN_COUNT = '3'
    expect((await call(stranger, 'GET', `/v1/housing/${listings[0]}/reviews`)).body.summary.rating).toBeNull()
    delete process.env.HOUSING_REVIEW_MIN_COUNT
    expect((await call(tenants[0], 'DELETE', path)).status).toBe(200)
    expect((await call(stranger, 'GET', `/v1/housing/${listings[0]}/reviews`)).body.summary).toMatchObject({
      rating: 2,
      count: 1,
    })
  })
  it('only a reported meeting after a confirmed appointment permits review; owner can reply', async () => {
    const slot = new Date(Date.now() + 86400000).toISOString()
    const booked = await call(tenants[2], 'PUT', `/v1/housing/${listings[0]}/viewing`, { slot })
    const request = (await call(owner, 'GET', '/v1/landlord/contact-requests')).body.items.find(
      (r: any) => r.id === booked.body.id,
    )
    await call(owner, 'POST', `/v1/landlord/contact-requests/${request.id}/viewing`, {
      decision: 'confirm',
      revision: request.revision,
    })
    expect((await call(tenants[2], 'GET', `/v1/housing/${listings[0]}/reviews`)).body.can_review).toBe(false)
    expect((await call(tenants[2], 'PUT', `/v1/housing/${listings[0]}/review`, { rating: 5 })).status).toBe(403)
    expect((await call(tenants[2], 'PUT', `/v1/housing/${listings[0]}/review`, { rating: 5, visit_slot: slot })).status).toBe(403)
    const metSlot = new Date(Date.now() - 3600000).toISOString()
    await admin.query('UPDATE housing.contact_requests SET viewing_slot=$2 WHERE id=$1', [request.id, metSlot])
    const saved = await call(tenants[2], 'PUT', `/v1/housing/${listings[0]}/review`, {
      rating: 5,
      visit_slot: metSlot,
      body: 'Lịch xem thuận tiện.',
    })
    expect(saved.body.stage).toBe('viewed')
    expect(
      (await call(stranger, 'POST', `/v1/landlord/reviews/${saved.body.id}/reply`, { body: 'Cảm ơn.' })).status,
    ).toBe(403)
    expect(
      (await call(owner, 'POST', `/v1/landlord/reviews/${saved.body.id}/reply`, { body: 'Cảm ơn phản hồi của bạn.' }))
        .status,
    ).toBe(200)
    expect(
      (await call(owner, 'GET', '/v1/landlord/reviews')).body.items.some(
        (r: any) => r.reply_body === 'Cảm ơn phản hồi của bạn.',
      ),
    ).toBe(true)
    expect((await call(owner, 'DELETE', `/v1/housing/${listings[0]}/review`)).status).toBe(403)
  })
  it('reports are unique, moderators cannot self-moderate, hidden edits stay hidden and withdraw does not bypass moderation', async () => {
    const saved = await call(tenants[0], 'PUT', `/v1/housing/${listings[0]}/review`, {
      rating: 1,
      body: 'Tôi không hài lòng.',
    })
    const report = `/v1/housing/reviews/${saved.body.id}/report`
    expect((await call(owner, 'POST', report, { reason: 'Cần kiểm tra nội dung.' })).status).toBe(200)
    await call(owner, 'POST', report, { reason: 'Nội dung cần xem lại.' })
    const queue = await call(moderator, 'GET', '/v1/moderation/housing/reviews')
    expect(queue.body.items.find((r: any) => r.id === saved.body.id).report_count).toBe(1)
    process.env.HOUSING_MODERATOR_IDS = `${moderator},${owner}`
    expect(
      (
        await call(owner, 'POST', `/v1/moderation/housing/reviews/${saved.body.id}/decision`, {
          decision: 'hide',
          reason: 'Kiểm tra',
        })
      ).status,
    ).toBe(403)
    const decision = `/v1/moderation/housing/reviews/${saved.body.id}/decision`
    expect((await call(moderator, 'POST', decision, { decision: 'hide' })).status).toBe(400)
    expect(
      (
        await call(moderator, 'POST', decision, {
          decision: 'hide',
          reason: 'Nội dung không phù hợp.',
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await call(tenants[0], 'PUT', `/v1/housing/${listings[0]}/review`, {
          rating: 5,
          body: 'Đã sửa.',
        })
      ).body.status,
    ).toBe('hidden')
    await call(tenants[0], 'DELETE', `/v1/housing/${listings[0]}/review`)
    expect(
      (
        await call(tenants[0], 'PUT', `/v1/housing/${listings[0]}/review`, {
          rating: 5,
        })
      ).body.status,
    ).toBe('hidden')
    expect(
      (await call(stranger, 'GET', `/v1/housing/${listings[0]}/reviews`)).body.items.some(
        (r: any) => r.id === saved.body.id,
      ),
    ).toBe(false)
    await call(moderator, 'POST', decision, {
      decision: 'keep',
      reason: 'Đã rà soát.',
    })
  })
  it('flags multiple properties and independent authors, never auto-hides listings', async () => {
    await call(tenants[1], 'DELETE', `/v1/housing/${listings[1]}/review`)
    await call(tenants[2], 'DELETE', `/v1/housing/${listings[0]}/review`)
    await call(tenants[0], 'PUT', `/v1/housing/${listings[0]}/review`, {
      rating: 1,
    })
    await call(tenants[0], 'PUT', `/v1/housing/${listings[1]}/review`, {
      rating: 2,
    })
    expect((await call(moderator, 'GET', '/v1/moderation/housing/reviews')).body.flags).toHaveLength(0)
    await call(tenants[1], 'PUT', `/v1/housing/${listings[1]}/review`, {
      rating: 1,
    })
    await call(tenants[2], 'PUT', `/v1/housing/${listings[0]}/review`, {
      rating: 2,
    })
    await call(tenants[2], 'PUT', `/v1/housing/${listings[0]}/review`, {
      rating: 1,
    })
    const flags = (await call(moderator, 'GET', '/v1/moderation/housing/reviews')).body.flags
    expect(flags.filter((f: any) => f.host_user_id === owner)).toHaveLength(1)
    expect(flags[0].evidence).toMatchObject({
      author_count: 3,
      property_count: 2,
      review_count: 4,
    })
    expect((await call(stranger, 'GET', `/v1/housing/${listings[0]}`)).status).toBe(200)
    expect((await call(stranger, 'GET', '/v1/moderation/housing/reviews')).status).toBe(403)
    const acknowledge = `/v1/moderation/housing/flags/${flags[0].id}/review`
    expect((await call(owner, 'POST', acknowledge, {})).status).toBe(403)
    expect((await call(moderator, 'POST', acknowledge, {})).status).toBe(200)
    // Reading or editing the same low review does not reopen already-reviewed evidence.
    await call(tenants[2], 'PUT', `/v1/housing/${listings[0]}/review`, {
      rating: 2,
    })
    expect(
      (await call(moderator, 'GET', '/v1/moderation/housing/reviews')).body.flags.filter(
        (f: any) => f.host_user_id === owner,
      ),
    ).toHaveLength(0)
    // A new independent review reopens this one flag, rather than making duplicate alerts.
    await call(tenants[1], 'PUT', `/v1/housing/${listings[0]}/review`, {
      rating: 1,
    })
    expect(
      (await call(moderator, 'GET', '/v1/moderation/housing/reviews')).body.flags.filter(
        (f: any) => f.host_user_id === owner,
      ),
    ).toHaveLength(1)
  })
  it('expires the current flag evidence window while retaining the review history and listings', async () => {
    await admin.query("UPDATE housing.reviews SET updated_at=now()-interval '100 days' WHERE host_user_id=$1", [owner])
    const flags = (await call(moderator, 'GET', '/v1/moderation/housing/reviews')).body.flags.filter(
      (f: any) => f.host_user_id === owner,
    )
    expect(flags).toHaveLength(1)
    expect(flags[0].evidence).toMatchObject({
      qualifies: false,
      review_count: 0,
      author_count: 0,
      property_count: 0,
    })
    expect((await call(stranger, 'GET', `/v1/housing/${listings[0]}`)).status).toBe(200)
  })
})
