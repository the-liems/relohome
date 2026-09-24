import { createDatabasePool, getRuntimeConfig } from '@lifeflow/housing-query'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../src/app.js'

let app: FastifyInstance

beforeAll(async () => {
  const config = getRuntimeConfig()
  app = buildApp(createDatabasePool(config.databaseUrl, 2), config)
  await app.ready()
})

afterAll(async () => {
  vi.unstubAllGlobals()
  await app.close()
})

describe('LifeFlow Platform API', () => {
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

  it('returns an empty factual housing set when no production housing source exists', async () => {
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
    expect(body.results).toEqual([])
    expect(JSON.stringify(body)).not.toContain('recommendation_score')
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
