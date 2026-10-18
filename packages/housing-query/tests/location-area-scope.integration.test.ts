import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type pg from 'pg'
import { createDatabasePool, getRuntimeConfig, LocationService } from '../src/index.js'

// Each fixture exists only inside this connection's rolled-back transaction.
const prefix = randomUUID()
const query = `Bình Thạnh ${prefix}`
const cityId = `${prefix}-city`
const correctId = `${prefix}-ward`
const box = { west: 100, south: 0, east: 104, north: 4 }
let pool: ReturnType<typeof createDatabasePool>
let client: pg.PoolClient
let service: LocationService

beforeAll(async () => {
  pool = createDatabasePool(getRuntimeConfig().ingestDatabaseUrl, 1)
  client = await pool.connect()
  await client.query('BEGIN')
  service = new LocationService(client)
  // An L-shaped city: the upper-right corner is inside its bbox but outside its boundary.
  await client.query(`INSERT INTO geo.administrative_areas(id,name,level,source,source_id,geom)
    VALUES ($1,$2,'4','import',$1,ST_Multi(ST_GeomFromText(
      'POLYGON((100 0,104 0,104 1,101 1,101 4,100 4,100 0))',4326)))`,
  [cityId, 'Fixture metropolitan boundary'])
  for (let i = 0; i < 6; i++) {
    await client.query(`INSERT INTO geo.administrative_areas(id,name,level,source,source_id,geom)
      VALUES ($1,$2,'6','import',$1,ST_Multi(ST_MakeEnvelope(102,2,102.1,2.1,4326)))`,
    [`${prefix}-outside-${i}`, `Xã ${query}`])
  }
  await client.query(`INSERT INTO geo.administrative_areas(id,name,level,source,source_id,geom)
    VALUES ($1,$2,'6','import',$1,ST_Multi(ST_MakeEnvelope(100.1,0.1,100.2,0.2,4326)))`,
  [correctId, `Phường ${query}`])
})

afterAll(async () => {
  if (client) { await client.query('ROLLBACK'); client.release() }
  await pool?.end()
})

describe('administrative search inside a known city', () => {
  it('filters by the real boundary before LIMIT, excluding same-name areas inside only the bbox', async () => {
    const global = await service.searchAreas({ text: query, bounding_box: box, limit: 5 })
    expect(global.results.some(row => row.area_id === correctId)).toBe(false)
    const scoped = await service.searchAreas({ text: query, bounding_box: box, within_area_id: cityId, limit: 5 })
    expect(scoped.results.map(row => row.area_id)).toEqual([correctId])
    expect(scoped.results[0]?.parent?.area_id).toBe(cityId)
  })

  it('never falls back to a global search when the selected area ID is absent', async () => {
    const result = await service.searchAreas({ text: query, within_area_id: `${prefix}-missing`, limit: 5 })
    expect(result.results).toEqual([])
  })

  it('preserves accent-insensitive input and applies the optional bbox together with the city', async () => {
    const result = await service.searchAreas({ text: query.replace('Bình Thạnh', 'binh thanh'), within_area_id: cityId, limit: 1 })
    expect(result.results.map(row => row.area_id)).toEqual([correctId])
    const outside = await service.searchAreas({ text: query, within_area_id: cityId,
      bounding_box: { west: 102, south: 2, east: 103, north: 3 }, limit: 5 })
    expect(outside.results).toEqual([])
  })
})
