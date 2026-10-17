import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DatabasePool } from '@relohome/housing-query'
import { registerHousingReviews } from '../src/housing-reviews.js'
import { ManagementError } from '../src/housing-management.js'

const listing = 'aaaaaaaa-1111-4111-8111-111111111111'
afterEach(() => vi.unstubAllEnvs())
describe('review meeting eligibility at the API', () => {
  it.each([
    { viewed: false, manages: false, expected: 403 },
    { viewed: true, manages: false, expected: 200 },
    { viewed: true, manages: true, expected: 403 },
  ])('contact alone is insufficient; meeting=$viewed manager=$manages', async ({ viewed, manages, expected }) => {
    vi.stubEnv('AGENT_API_TOKEN', 'test-review-gateway')
    const statements: string[] = []
    const query = vi.fn(async (sql: string) => {
      statements.push(sql)
      if (sql.includes('AS manages')) return { rows: [{ property_id: 'property', host_user_id: 'owner', contacted: true, viewed, manages }], rowCount: 1 }
      if (sql.includes('INSERT INTO housing.reviews')) return { rows: [{ id: 'review', host_user_id: 'owner', rating: 4, stage: 'viewed' }], rowCount: 1 }
      return { rows: [], rowCount: 0 }
    })
    const pool = { query, connect: async () => ({ query, release() {} }) } as unknown as DatabasePool
    const app = Fastify()
    app.setErrorHandler((error, _request, reply) => reply.code(error instanceof ManagementError ? error.status : 500).send({ error: error.message }))
    registerHousingReviews(app, pool)
    const response = await app.inject({ method: 'PUT', url: `/v1/housing/${listing}/review`,
      headers: { authorization: 'Bearer test-review-gateway', 'x-user-id': 'tenant' }, payload: { rating: 4 } })
    expect(response.statusCode).toBe(expected)
    expect(statements.some(sql => sql.includes('INSERT INTO housing.reviews'))).toBe(expected === 200)
    await app.close()
  })
  it('an unconfirmed or future appointment cannot establish a meeting', async () => {
    vi.stubEnv('AGENT_API_TOKEN', 'test-review-gateway')
    const query = vi.fn(async (sql: string) => sql.includes('AS manages')
      ? { rows: [{ property_id: 'property', host_user_id: 'owner', manages: false, viewed: false }], rowCount: 1 }
      : { rows: [], rowCount: 0 })
    const pool = { query, connect: async () => ({ query, release() {} }) } as unknown as DatabasePool
    const app = Fastify()
    app.setErrorHandler((error, _request, reply) => reply.code(error instanceof ManagementError ? error.status : 500).send({ error: error.message }))
    registerHousingReviews(app, pool)
    const response = await app.inject({ method: 'PUT', url: `/v1/housing/${listing}/review`,
      headers: { authorization: 'Bearer test-review-gateway', 'x-user-id': 'tenant' },
      payload: { rating: 4, visit_slot: '2027-01-01T09:00:00+07:00' } })
    expect(response.statusCode).toBe(403)
    const update = query.mock.calls.find(([sql]) => sql.includes('UPDATE housing.contact_requests'))![0]
    expect(update).toContain("viewing_status='confirmed'")
    expect(update).toContain('viewing_slot<=now()')
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO housing.reviews'))).toBe(false)
    await app.close()
  })
})
