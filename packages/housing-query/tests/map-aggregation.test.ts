import { expect, it, vi } from 'vitest'
import { HousingMapRequestSchema } from '@relohome/contracts'
import { HousingQueryService } from '../src/housing-service.js'
import type { QueryExecutor } from '../src/database.js'
import type { RouteService } from '../src/route-service.js'

const input = { bounding_box: { west: 105, south: 20, east: 106, north: 22 }, zoom: 10 }
it('explicit unclustered mode preserves zoom, limits, filters and the individual listing query', async () => {
  const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [] }))
  const service = new HousingQueryService({ query } as unknown as QueryExecutor, {} as RouteService, { commuteCandidateLimit: 100 })
  const result = await service.map({ ...input, cluster: false, amenities: ['air_conditioning'], limit: 50 })
  expect(result.meta.mode).toBe('listings')
  expect(query.mock.calls[0]?.[0]).not.toContain('ST_SnapToGrid')
  expect(query.mock.calls[0]?.[0]).toContain('housing.map_points')
  expect(query.mock.calls[0]?.[1]).toContain(51)
  expect(HousingMapRequestSchema.parse({ ...input, cluster: false }).zoom).toBe(10)
})
it('existing clients still get aggregation when they have not opted out', async () => {
  const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [] }))
  const service = new HousingQueryService({ query } as unknown as QueryExecutor, {} as RouteService, { commuteCandidateLimit: 100 })
  expect((await service.map(input)).meta.mode).toBe('clusters')
  expect(query.mock.calls[0]?.[0]).toContain('ST_SnapToGrid')
})
