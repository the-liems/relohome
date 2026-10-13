import { RouteEndpointService, NotFoundError, type DatabasePool, type RuntimeConfig } from '@relohome/housing-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../src/app.js'

afterEach(() => vi.restoreAllMocks())

const input = {
  city: 'hcm', profile: 'walking',
  origin: { type: 'housing', listing_id: '30000000-0000-4000-8000-000000000010' },
  destination: { type: 'place', place_id: '00000000-0000-4000-8000-000000000001' },
}

function appForTest() {
  // Invalid payloads and mocked service results must not touch a database.
  const pool = { end: vi.fn(), connect: vi.fn(() => { throw new Error('Unexpected database access') }) }
  return buildApp(pool as unknown as DatabasePool, { osrmUrls: {}, commuteCandidateLimit: 20 } as RuntimeConfig)
}

describe('entity routing HTTP contract', () => {
  it('passes canonical endpoint IDs and profile to the shared entity route service', async () => {
    const calculate = vi.spyOn(RouteEndpointService.prototype, 'calculate').mockResolvedValue({ warnings: [] } as never)
    const app = appForTest()
    try {
      const response = await app.inject({ method: 'POST', url: '/v1/routes/entities', payload: input })
      expect(response.statusCode).toBe(200)
      expect(calculate).toHaveBeenCalledWith({ ...input, snap_radius_m: 100 })
    } finally { await app.close() }
  })

  it('rejects guessed IDs and mixed endpoint shapes before calling the service', async () => {
    const calculate = vi.spyOn(RouteEndpointService.prototype, 'calculate')
    const app = appForTest()
    try {
      for (const origin of [
        { type: 'housing', listing_id: 'Sunrise' },
        { ...input.origin, location: { lat: 10.77, lng: 106.7 } },
        { type: 'coordinate', location: { lat: 100, lng: 106.7 } },
      ]) {
        const response = await app.inject({ method: 'POST', url: '/v1/routes/entities', payload: { ...input, origin } })
        expect(response.statusCode).toBe(400)
      }
      expect(calculate).not.toHaveBeenCalled()
    } finally { await app.close() }
  })

  it('returns 404 for stale or missing entities instead of substituting another location', async () => {
    vi.spyOn(RouteEndpointService.prototype, 'calculate').mockRejectedValue(new NotFoundError('origin not found'))
    const app = appForTest()
    try {
      const response = await app.inject({ method: 'POST', url: '/v1/routes/entities', payload: input })
      expect(response.statusCode).toBe(404)
      expect(response.json().code).toBe('NOT_FOUND')
    } finally { await app.close() }
  })
})
