import { describe, expect, it, vi } from 'vitest'
import { PlaceService } from '../src/place-service.js'
import { withinOperation } from '../src/execution.js'
import type { QueryExecutor } from '../src/database.js'

const origins = [{ lng: 106.7, lat: 10.77 }, { lng: 106.71, lat: 10.78 }]
const constraints = [
  { category: 'hospital', max_distance_m: 1_000 },
  { category: 'supermarket', max_distance_m: 500 },
  { category: 'hospital', max_distance_m: 20 },
]
const match = (origin: number, constraint: number) => ({
  origin_index: String(origin), constraint_index: String(constraint),
  place_id: `${origin}-${constraint}`, category: 'hospital', name: 'Test POI',
  lng: '106.701', lat: '10.771', distance_meters: '12.5',
  verification_status: 'unverified', verified_at: null, verified_by: null,
  source_type: 'import', source_id: 'fixture-source', observed_at: null,
})

describe('batched nearby lookups', () => {
  it('uses one parameterized query and keeps origin/constraint order, duplicates and missing matches', async () => {
    const query = vi.fn(async () => ({ rows: [match(1, 1), match(1, 3), match(2, 2)] }))
    const service = new PlaceService({ query } as unknown as QueryExecutor)
    const result = await service.findNearbyBatch(origins, constraints)
    expect(query).toHaveBeenCalledTimes(1)
    expect(query.mock.calls[0]).toEqual([expect.any(String), [
      [106.7, 106.71], [10.77, 10.78], ['hospital', 'supermarket', 'hospital'], [1_000, 500, 20],
    ]])
    expect(result.map(matches => matches.map(m => m.place_id))).toEqual([['1-1', '1-3'], ['2-2']])
    expect(result[0]?.[0]).toMatchObject({
      location: { lng: 106.701, lat: 10.771 }, distance_meters: 12.5,
      distance_kind: 'straight_line', source: { source_id: 'fixture-source' },
    })
  })

  it.each([[[], constraints], [origins, []]] as const)('does not query for empty work', async (points, filters) => {
    const query = vi.fn()
    const service = new PlaceService({ query } as unknown as QueryExecutor)
    expect(await service.findNearbyBatch([...points], [...filters])).toEqual(points.map(() => []))
    expect(query).not.toHaveBeenCalled()
  })

  it('preserves an empty slot for an origin without matches', async () => {
    const query = vi.fn(async () => ({ rows: [match(2, 1)] }))
    const service = new PlaceService({ query } as unknown as QueryExecutor)
    expect((await service.findNearbyBatch(origins, constraints)).map(m => m.length)).toEqual([0, 1])
  })

  it('keeps the single-origin API on the same batched path', async () => {
    const service = new PlaceService({ query: vi.fn(async () => ({ rows: [match(1, 1)] })) } as unknown as QueryExecutor)
    const batch = vi.spyOn(service, 'findNearbyBatch')
    expect((await service.findNearby(origins[0]!, constraints)).map(m => m.place_id)).toEqual(['1-1'])
    expect(batch).toHaveBeenCalledWith([origins[0]], constraints)
  })

  it('propagates SQL failure rather than reporting no nearby matches', async () => {
    const error = new Error('database unavailable')
    const service = new PlaceService({ query: vi.fn().mockRejectedValue(error) } as unknown as QueryExecutor)
    await expect(service.findNearbyBatch(origins, constraints)).rejects.toBe(error)
  })

  it('does not start SQL after cancellation', async () => {
    const controller = new AbortController()
    const query = vi.fn()
    const service = new PlaceService({ query } as unknown as QueryExecutor)
    await expect(withinOperation(async () => {
      controller.abort()
      return service.findNearbyBatch(origins, constraints)
    }, controller.signal)).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(query).not.toHaveBeenCalled()
  })

  it('retains the caller deadline and discards a result that arrives after cancellation', async () => {
    const controller = new AbortController()
    const query = vi.fn(async () => { controller.abort(); return { rows: [match(1, 1)] } })
    const service = new PlaceService({ query } as unknown as QueryExecutor)
    await expect(withinOperation(() => service.findNearbyBatch(origins, constraints), controller.signal))
      .rejects.toMatchObject({ code: 'CANCELLED' })
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('shares the caller timeout instead of resetting its budget or starting more SQL', async () => {
    let complete!: (value: { rows: ReturnType<typeof match>[] }) => void
    const query = vi.fn(() => new Promise<{ rows: ReturnType<typeof match>[] }>(resolve => { complete = resolve }))
    const service = new PlaceService({ query } as unknown as QueryExecutor)
    await expect(withinOperation(() => service.findNearbyBatch(origins, constraints), undefined, 10))
      .rejects.toMatchObject({ code: 'TIMEOUT' })
    complete({ rows: [match(1, 1)] })
    await Promise.resolve()
    expect(query).toHaveBeenCalledTimes(1)
  })
})
