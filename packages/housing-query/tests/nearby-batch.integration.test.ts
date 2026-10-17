import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createDatabasePool, getRuntimeConfig, PlaceService, type QueryExecutor } from '../src/index.js'
import type pg from 'pg'

let pool: ReturnType<typeof createDatabasePool>, db: pg.PoolClient, service: PlaceService
const origins = [{ lng: 106.3, lat: 10.3 }, { lng: 107.3, lat: 11.3 }, { lng: 140, lat: 0 }]
const hospitalIds = [randomUUID(), randomUUID()].sort()
const supermarketId = randomUUID()
const constraints = [
  { category: 'hospital', max_distance_m: 1_000 },
  { category: 'supermarket', max_distance_m: 1_000 },
  { category: 'hospital', max_distance_m: 1_000 },
  { category: 'hospital', max_distance_m: 1 },
]

beforeAll(async () => {
  pool = createDatabasePool(getRuntimeConfig().ingestDatabaseUrl, 1)
  db = await pool.connect()
  await db.query('BEGIN')
  const hospital = (await db.query("SELECT id FROM catalog.place_categories WHERE slug='hospital'")).rows[0].id
  const supermarket = (await db.query("SELECT id FROM catalog.place_categories WHERE slug='supermarket'")).rows[0].id
  for (const [id, category, lng, lat, status, deleted, attributes] of [
    ...hospitalIds.map(id => [id, hospital, 106.3, 10.301, 'active', false, {}]),
    [supermarketId, supermarket, 107.3, 11.3005, 'active', false, {}],
    [randomUUID(), hospital, 106.3, 10.3, 'inactive', false, {}],
    [randomUUID(), hospital, 106.3, 10.3, 'active', true, {}],
    [randomUUID(), hospital, 106.3, 10.3, 'active', false, { entity_role: 'housing_anchor' }],
  ]) {
    await db.query(`INSERT INTO catalog.places(id,category_id,name,geom,status,deleted_at,attributes)
      VALUES($1,$2,'Batch test POI',ST_SetSRID(ST_MakePoint($3,$4),4326),$5,
        CASE WHEN $6 THEN now() END,$7)`, [id, category, lng, lat, status, deleted, JSON.stringify(attributes)])
  }
  for (const [id, date] of [['older', '2026-01-01'], ['newer', '2026-02-01']]) {
    await db.query(`INSERT INTO catalog.place_sources(place_id,source_type,source_id,observed_at)
      VALUES($1,'import',$2,$3)`, [hospitalIds[0], `batch-test-${id}-${hospitalIds[0]}`, date])
  }
  service = new PlaceService(db as unknown as QueryExecutor)
})

afterAll(async () => {
  if (db) { await db.query('ROLLBACK'); db.release() }
  if (pool) await pool.end()
})

it('keeps radius/category filtering, missing origins, duplicate constraints and deterministic distance ties', async () => {
  const matches = await service.findNearbyBatch(origins, constraints)
  expect(matches.map(group => group.map(match => match.place_id))).toEqual([
    [hospitalIds[0], hospitalIds[0]], [supermarketId], [],
  ])
  expect(matches[0]![0]).toMatchObject({
    category: 'hospital', location: { lng: 106.3, lat: 10.301 }, distance_kind: 'straight_line',
    source: { source_id: `batch-test-newer-${hospitalIds[0]}`, observed_at: '2026-02-01T00:00:00.000Z' },
  })
  expect(matches[0]![0]!.distance_meters).toBeGreaterThan(100)
  expect(matches[0]![0]!.distance_meters).toBeLessThan(120)
  expect(matches[1]![0]!.source).toMatchObject({ source_id: supermarketId, observed_at: null })
})

it('preserves duplicate origin slots and single-origin API responses with one query', async () => {
  const query = vi.fn((text: string, values?: unknown[]) => db.query(text, values))
  const counted = new PlaceService({ query } as unknown as QueryExecutor)
  const result = await counted.findNearbyBatch([origins[0]!, origins[0]!, origins[1]!], constraints)
  expect(query).toHaveBeenCalledTimes(1)
  expect(result[0]).toEqual(result[1])
  expect(result[0]).toEqual(await service.findNearby(origins[0]!, constraints))
  expect(result[2]).toEqual(await service.findNearby(origins[1]!, constraints))
})

it('matches the radius boundary and keeps misses out rather than fabricating a POI', async () => {
  const origin = origins[0]!
  const radius = Number((await db.query(`SELECT ST_Distance(geog,ST_SetSRID(ST_MakePoint($1,$2),4326)::geography) AS d
    FROM catalog.places WHERE id=$3`, [origin.lng, origin.lat, hospitalIds[0]])).rows[0].d)
  const result = await service.findNearbyBatch([origin], [
    { category: 'hospital', max_distance_m: radius + .001 },
    { category: 'hospital', max_distance_m: radius - .001 },
    { category: 'not-a-category', max_distance_m: 1_000 },
  ])
  expect(result[0]!.map(match => match.place_id)).toEqual([hospitalIds[0]])
})
