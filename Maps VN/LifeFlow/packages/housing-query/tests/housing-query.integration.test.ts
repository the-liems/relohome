import {
  createDatabasePool,
  getRuntimeConfig,
  HousingQueryService,
  LocationService,
  PlaceService,
  RouteService,
  type QueryExecutor,
} from '../src/index.js'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type pg from 'pg'

const ids = {
  hospitalPlace: '00000000-0000-4000-8000-000000000001',
  validPlace: '00000000-0000-4000-8000-000000000010',
  expensivePlace: '00000000-0000-4000-8000-000000000020',
  unknownPlace: '00000000-0000-4000-8000-000000000030',
  slowPlace: '00000000-0000-4000-8000-000000000040',
  validProperty: '10000000-0000-4000-8000-000000000010',
  expensiveProperty: '10000000-0000-4000-8000-000000000020',
  unknownProperty: '10000000-0000-4000-8000-000000000030',
  slowProperty: '10000000-0000-4000-8000-000000000040',
  validUnit: '20000000-0000-4000-8000-000000000010',
  expensiveUnit: '20000000-0000-4000-8000-000000000020',
  unknownUnit: '20000000-0000-4000-8000-000000000030',
  slowUnit: '20000000-0000-4000-8000-000000000040',
  validListing: '30000000-0000-4000-8000-000000000010',
  expensiveListing: '30000000-0000-4000-8000-000000000020',
  unknownListing: '30000000-0000-4000-8000-000000000030',
  slowListing: '30000000-0000-4000-8000-000000000040',
}

let pool: ReturnType<typeof createDatabasePool>
let client: pg.PoolClient
let service: HousingQueryService
let locationService: LocationService
let placeService: PlaceService

beforeAll(async () => {
  const config = getRuntimeConfig()
  pool = createDatabasePool(config.ingestDatabaseUrl, 1)
  client = await pool.connect()
  await client.query('BEGIN')
  await insertFixtures(client)
  service = new HousingQueryService(
    client as unknown as QueryExecutor,
    new RouteService(config.osrmUrls),
    { commuteCandidateLimit: 20 },
  )
  locationService = new LocationService(client as unknown as QueryExecutor)
  placeService = new PlaceService(client as unknown as QueryExecutor)
})

afterAll(async () => {
  vi.unstubAllGlobals()
  await client.query('ROLLBACK')
  client.release()
  await pool.end()
})

describe('HousingQueryService hard constraints', () => {
  it('enforces price, bedroom and area filters in PostgreSQL', async () => {
    const response = await service.search({
      max_price: { amount: 15_000_000, currency: 'VND', period: 'month' },
      min_bedrooms: 2,
      min_area_m2: 60,
      pagination: { limit: 20, cursor: null },
    })

    expect(response.results.map((item) => item.listing_id).sort()).toEqual(
      [ids.validListing, ids.slowListing].sort(),
    )
    expect(response.results.every((item) => item.price.amount <= 15_000_000)).toBe(true)
    expect(response.results.every((item) => Number(item.bedrooms) >= 2)).toBe(true)
    expect(response.results.every((item) => Number(item.area?.value) >= 60)).toBe(true)
  })

  it('does not treat NULL bedrooms as satisfying min_bedrooms', async () => {
    const response = await service.search({ min_bedrooms: 2, pagination: { limit: 20, cursor: null } })
    expect(response.results.some((item) => item.listing_id === ids.unknownListing)).toBe(false)
  })

  it('enforces administrative area, radius and nearby hospital constraints', async () => {
    const response = await service.search({
      administrative_area_ids: ['district_7_test'],
      center: { lng: 106.7, lat: 10.77 },
      radius_m: 2_000,
      min_bedrooms: 2,
      max_price: { amount: 15_000_000, currency: 'VND', period: 'month' },
      nearby: [{ category: 'hospital', max_distance_m: 1_500 }],
      pagination: { limit: 20, cursor: null },
    })

    expect(response.results.map((item) => item.listing_id)).toEqual([ids.validListing])
    expect(response.results[0]?.nearby[0]).toMatchObject({
      place_id: ids.hospitalPlace,
      category: 'hospital',
    })
    expect(response.results[0]!.nearby[0]!.distance_meters).toBeLessThanOrEqual(1_500)
  })

  it('uses OSRM duration rather than straight-line distance for commute constraints', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL | RequestInfo) => {
        const url = String(input)
        const slow = url.includes('106.73')
        return new Response(
          JSON.stringify({
            code: 'Ok',
            routes: [
              {
                distance: slow ? 9_000 : 4_000,
                duration: slow ? 2_400 : 1_200,
                geometry: {
                  type: 'LineString',
                  coordinates: [
                    [106.7, 10.77],
                    [106.71, 10.78],
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }),
    )

    const response = await service.search({
      max_price: { amount: 15_000_000, currency: 'VND', period: 'month' },
      min_bedrooms: 2,
      commute: {
        city: 'hcm',
        destination: { lng: 106.72, lat: 10.79 },
        max_duration_seconds: 1_800,
        profile: 'driving',
      },
      pagination: { limit: 20, cursor: null },
    })

    expect(response.results.map((item) => item.listing_id)).toEqual([ids.validListing])
    expect(response.results[0]!.commute?.duration_seconds).toBe(1_200)
    expect(response.diagnostics.commute_evaluated_count).toBe(2)
  })

  it('returns deterministic result ordering for the same database state and request', async () => {
    const request = {
      listing_type: 'rent' as const,
      pagination: { limit: 20, cursor: null },
      sort: [{ field: 'price_amount' as const, direction: 'asc' as const }],
    }
    const first = await service.search(request)
    const second = await service.search(request)
    expect(first.results.map((item) => item.listing_id)).toEqual(
      second.results.map((item) => item.listing_id),
    )
    expect(first.results.every((item) => !('recommendation_score' in item))).toBe(true)
  })
})

describe('location queries', () => {
  it('searches administrative areas without Vietnamese accents', async () => {
    const response = await locationService.searchAreas({ text: 'go vap test', limit: 10 })
    expect(response.results[0]).toMatchObject({
      area_id: 'ward_go_vap_test',
      name: 'Phường Gò Vấp Test',
      match_type: 'contains',
    })
  })

  it('resolves both administrative areas and canonical places', async () => {
    const response = await locationService.resolve({ text: 'go vap test', limit: 10 })
    expect(response.results.some((item) => item.entity_type === 'administrative_area')).toBe(true)
    expect(response.results.some((item) => item.entity_type === 'place')).toBe(true)
    expect(response.ambiguous).toBe(true)
  })

  it('filters canonical places with ST_Covers using an area ID', async () => {
    const response = await placeService.search({
      categories: ['apartment'],
      administrative_area_ids: ['ward_go_vap_test'],
      pagination: { limit: 20, cursor: null },
    })
    expect(response.results.map((item) => item.place_id)).toEqual([ids.validPlace])
  })
})

async function insertFixtures(db: pg.PoolClient) {
  await db.query(
    `INSERT INTO geo.administrative_areas (id, name, level, source, source_id, geom)
     VALUES (
       'district_7_test', 'District 7 Test', 'district', 'import', 'district_7_test',
       ST_Multi(ST_GeomFromText('POLYGON((106.68 10.75,106.75 10.75,106.75 10.82,106.68 10.82,106.68 10.75))', 4326))
     )`,
  )
  await db.query(
    `INSERT INTO geo.administrative_areas (id, name, level, source, source_id, geom)
     VALUES (
       'ward_go_vap_test', 'Phường Gò Vấp Test', '6', 'import', 'ward_go_vap_test',
       ST_Multi(ST_GeomFromText(
         'POLYGON((106.699 10.769,106.702 10.769,106.702 10.772,106.699 10.772,106.699 10.769))',
         4326
       ))
     )`,
  )

  const categories = await db.query<{ slug: string; id: string }>(
    `SELECT slug, id FROM catalog.place_categories WHERE slug IN ('apartment', 'hospital')`,
  )
  const categoryIds = Object.fromEntries(categories.rows.map((row) => [row.slug, row.id]))

  const places = [
    [ids.hospitalPlace, categoryIds.hospital, 'Test Hospital', 106.701, 10.771],
    [ids.validPlace, categoryIds.apartment, 'Gò Vấp Test Hotel', 106.7, 10.77],
    [ids.expensivePlace, categoryIds.apartment, 'Expensive Apartment', 106.705, 10.775],
    [ids.unknownPlace, categoryIds.apartment, 'Unknown Bedrooms', 106.706, 10.776],
    [ids.slowPlace, categoryIds.apartment, 'Slow Commute Apartment', 106.73, 10.79],
  ]
  for (const [id, categoryId, name, lng, lat] of places) {
    await db.query(
      `INSERT INTO catalog.places (id, category_id, name, geom, address)
       VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326), '{}'::jsonb)`,
      [id, categoryId, name, lng, lat],
    )
    await db.query(
      `INSERT INTO catalog.place_sources (place_id, source_type, source_id, source_payload)
       VALUES ($1, 'import', $2, '{}'::jsonb)`,
      [id, `test:${id}`],
    )
  }

  const records = [
    {
      property: ids.validProperty,
      unit: ids.validUnit,
      listing: ids.validListing,
      place: ids.validPlace,
      title: 'Valid listing',
      bedrooms: 2,
      bathrooms: 2,
      area: 78,
      price: 14_000_000,
    },
    {
      property: ids.expensiveProperty,
      unit: ids.expensiveUnit,
      listing: ids.expensiveListing,
      place: ids.expensivePlace,
      title: 'Expensive listing',
      bedrooms: 3,
      bathrooms: 2,
      area: 80,
      price: 20_000_000,
    },
    {
      property: ids.unknownProperty,
      unit: ids.unknownUnit,
      listing: ids.unknownListing,
      place: ids.unknownPlace,
      title: 'Unknown bedrooms listing',
      bedrooms: null,
      bathrooms: 1,
      area: 70,
      price: 12_000_000,
    },
    {
      property: ids.slowProperty,
      unit: ids.slowUnit,
      listing: ids.slowListing,
      place: ids.slowPlace,
      title: 'Slow commute listing',
      bedrooms: 2,
      bathrooms: 1,
      area: 65,
      price: 13_000_000,
    },
  ]

  for (const record of records) {
    await db.query(
      `INSERT INTO housing.properties (id, place_id, property_type, name)
       VALUES ($1, $2, 'apartment', $3)`,
      [record.property, record.place, record.title],
    )
    await db.query(
      `INSERT INTO housing.units (id, property_id, unit_code, bedrooms, bathrooms, area_m2, amenities)
       VALUES ($1, $2, 'A', $3, $4, $5, ARRAY['air_conditioning', 'parking'])`,
      [record.unit, record.property, record.bedrooms, record.bathrooms, record.area],
    )
    await db.query(
      `INSERT INTO housing.listings (
         id, property_id, unit_id, listing_type, title, source_type, source_listing_id
       ) VALUES ($1, $2, $3, 'rent', $4, 'import', $5)`,
      [record.listing, record.property, record.unit, record.title, `test:${record.listing}`],
    )
    await db.query(
      `INSERT INTO housing.offers (listing_id, price_amount, currency, price_period)
       VALUES ($1, $2, 'VND', 'month')`,
      [record.listing, record.price],
    )
  }
}
