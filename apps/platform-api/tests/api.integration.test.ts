import { createDatabasePool, getRuntimeConfig } from '@relohome/housing-query'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../src/app.js'

let app: FastifyInstance
let pool: ReturnType<typeof createDatabasePool>

beforeAll(async () => {
  const config = getRuntimeConfig()
  pool = createDatabasePool(config.databaseUrl, 2)
  app = buildApp(pool, config)
  await app.ready()
})

afterAll(async () => {
  vi.unstubAllGlobals()
  await app.close()
})

describe('ReloHome Platform API', () => {
  it('serves all eight POI groups in one city map layer', async () => {
    const response = await app.inject({
      method: 'POST', url: '/v1/places/map',
      payload: { bounding_box: { west: 106.34, south: 10.34, east: 107.05, north: 11.2 } },
    })
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.type).toBe('FeatureCollection')
    // Count the imported snapshot's visible identities; dedup intentionally reduces map rows.
    const raw = await pool.query(`SELECT id FROM catalog.places
      WHERE status='active' AND deleted_at IS NULL
        AND COALESCE(attributes->>'entity_role','') <> 'housing_anchor'
        AND ST_X(geom) BETWEEN 106.34 AND 107.05 AND ST_Y(geom) BETWEEN 10.34 AND 11.2`)
    const aliases = new Set((await pool.query('SELECT alias_place_id FROM catalog.poi_aliases')).rows.map(r => r.alias_place_id))
    const expected = raw.rows.map(r => r.id).filter(id => !aliases.has(id)).sort()
    expect(expected.length).toBeGreaterThan(0)
    expect(body.features.map((feature: { id: string }) => feature.id).sort()).toEqual(expected)
    expect([...new Set(body.features.map((feature: { properties: { group: string } }) => feature.properties.group))].sort())
      .toEqual(['accommodation', 'education', 'food', 'healthcare', 'lifestyle', 'shopping', 'transport', 'utility'])
    expect(new Set(body.features.map((feature: { id: string }) => feature.id)).size).toBe(body.features.length)
    expect(body.features.every((feature: { geometry: { coordinates: number[] } }) =>
      feature.geometry.coordinates.length === 2 && feature.geometry.coordinates.every(Number.isFinite),
    )).toBe(true)
  })

  it('rejects unbounded map requests', async () => {
    for (const payload of [{}, { bounding_box: { west: 100, south: 5, east: 110, north: 25 } }]) {
      const response = await app.inject({ method: 'POST', url: '/v1/places/map', payload })
      expect(response.statusCode).toBe(400)
    }
  })

  it('reports PostgreSQL/PostGIS health', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ status: 'ok' })
    expect(response.json().postgis).toContain('3.5')
  })

  it('serves real imported places inside the HCM bounding box', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/places/search',
      payload: {
        bounding_box: { west: 106.34, south: 10.34, east: 107.05, north: 11.2 },
        pagination: { limit: 100, cursor: null },
      },
    })
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.results).toHaveLength(100)
    expect(body.results[0].source.type).toBe('osm')
  })

  it('searches imported administrative areas without Vietnamese accents', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/areas/search',
      payload: { text: 'go vap', levels: ['6'], limit: 10 },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json().results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          area_id: 'osm:relation:38522189',
          name: 'Phường Gò Vấp',
          level: '6',
        }),
      ]),
    )
  })

  it('uses a bounding box to disambiguate an administrative area search', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/areas/search',
      payload: {
        text: 'ha noi',
        levels: ['4'],
        bounding_box: { west: 105.2, south: 20.5, east: 106.2, north: 21.5 },
        limit: 10,
      },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json().results[0]).toMatchObject({
      area_id: 'osm:relation:3807033',
      name: 'Thành phố Hà Nội',
      level: '4',
    })
  })

  it('resolves local location candidates and reports ambiguity explicitly', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/locations/resolve',
      payload: { text: 'go vap', limit: 10 },
    })
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.results.length).toBeGreaterThan(0)
    expect(body.results.some((item: { entity_type: string }) => item.entity_type === 'administrative_area')).toBe(true)
    expect(typeof body.ambiguous).toBe('boolean')
  })

  it('rejects invalid location input at the API boundary', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/locations/resolve',
      payload: { text: '', radius_m: -1 },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json().code).toBe('VALIDATION_ERROR')
  })

  it('returns imported factual housing without recommendation fields', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/housing/search',
      payload: {
        listing_type: 'rent',
        max_price: { amount: 15_000_000, currency: 'VND', period: 'month' },
        min_bedrooms: 2,
      },
    })
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(Array.isArray(body.results)).toBe(true)
    if (body.results[0]) expect(body.results[0].source.type).toBe('partner')
    expect(JSON.stringify(body)).not.toContain('recommendation_score')
  })

  it('returns viewport-aware housing map features', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/housing/map',
      payload: {
        bounding_box: { west: 106.45, south: 10.55, east: 106.95, north: 11.2 },
        zoom: 10,
        limit: 1000,
      },
    })
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.meta.mode).toBe('clusters')
    expect(Array.isArray(body.features)).toBe(true)
    if (body.features[0]) expect(body.features[0].kind).toBe('cluster')
  })

  it('rejects invalid hard constraints at the API boundary', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/housing/search',
      payload: { min_bedrooms: -1 },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json().code).toBe('VALIDATION_ERROR')
  })

  it('returns structured OSRM route data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            code: 'Ok',
            routes: [
              {
                distance: 4_648.2,
                duration: 422.4,
                geometry: {
                  type: 'LineString',
                  coordinates: [
                    [106.7009, 10.7769],
                    [106.7218, 10.7952],
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    )
    const response = await app.inject({
      method: 'POST',
      url: '/v1/routes',
      payload: {
        city: 'hcm',
        origin: { lng: 106.7009, lat: 10.7769 },
        destination: { lng: 106.7218, lat: 10.7952 },
        profile: 'driving',
      },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      code: 'Ok',
      distance_meters: 4_648.2,
      duration_seconds: 422.4,
    })
  })
})
