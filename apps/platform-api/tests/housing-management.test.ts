import type { ApplicationRuntimeConfig, DatabasePool } from '@relohome/housing-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../src/app.js'

const config: ApplicationRuntimeConfig = {
  databaseUrl: 'postgresql://unused',
  commuteCandidateLimit: 10,
  osrmUrls: {
    hcm: { driving: '', motorcycle: '', walking: '' },
    hanoi: { driving: '', motorcycle: '', walking: '' },
    danang: { driving: '', motorcycle: '', walking: '' },
  },
}

function fakePool(rows: Record<string, unknown>[] = []) {
  const query = vi.fn(async () => ({ rows, rowCount: rows.length }))
  return { query, end: vi.fn(async () => undefined) } as unknown as DatabasePool
}

describe('Housing management boundary', () => {
  beforeEach(() => { process.env.AGENT_API_TOKEN = 'trusted-test-token' })
  afterEach(() => { delete process.env.AGENT_API_TOKEN })

  it('does not change public housing routes but protects every management read', async () => {
    const app = buildApp(fakePool(), config)
    const response = await app.inject({ method: 'GET', url: '/v1/landlord/properties' })
    expect(response.statusCode).toBe(401)
    expect(response.json().code).toBe('HOUSING_MANAGEMENT_ERROR')
    await app.close()
  })

  it('uses only the gateway verified actor when listing managed properties', async () => {
    const pool = fakePool([{ id: 'property-1', name: 'Nhà A' }])
    const app = buildApp(pool, config)
    const response = await app.inject({
      method: 'GET',
      url: '/v1/landlord/properties',
      headers: { authorization: 'Bearer trusted-test-token', 'x-user-id': 'owner-a' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ items: [{ id: 'property-1', name: 'Nhà A' }] })
    expect((pool.query as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]).toEqual(['owner-a'])
    await app.close()
  })

  it('rejects an invalid actor even when a user id header is present', async () => {
    const app = buildApp(fakePool(), config)
    const response = await app.inject({
      method: 'GET',
      url: '/v1/landlord/overview',
      headers: { authorization: 'Bearer wrong', 'x-user-id': 'owner-a' },
    })
    expect(response.statusCode).toBe(401)
    await app.close()
  })
})

