import {
  createDatabasePool,
  getRuntimeConfig,
  HousingQueryService,
  LocationService,
  PlaceService,
  RouteService,
  RouteEndpointService,
  type QueryExecutor,
} from '../src/index.js'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
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

afterEach(() => vi.unstubAllGlobals())

beforeAll(async () => {
  const config = getRuntimeConfig()
  pool = createDatabasePool(config.ingestDatabaseUrl, 1)
  client = await pool.connect()
  await client.query('BEGIN')
  // Production housing may already exist in a developer database. Hide it only
  // inside this transaction so fixture assertions remain deterministic.
  await client.query("UPDATE housing.listings SET status = 'stale' WHERE source_type = 'partner'")
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
  it('preserves case-insensitive text OR across title, description and the original JSON address', async () => {
    await client.query('SAVEPOINT text_fields')
    try {
      await client.query("UPDATE housing.listings SET description='Description Needle' WHERE id=$1",[ids.validListing])
      await client.query("UPDATE housing.listings SET title='Title Needle' WHERE id=$1",[ids.unknownListing])
      await client.query(`UPDATE catalog.places SET address='{"street":"Address Needle"}' WHERE id=$1`,[ids.expensivePlace])
      const expected=[ids.unknownListing,ids.validListing,ids.expensiveListing]
      expect((await service.search({text:'nEeDlE'})).results.map(r=>r.listing_id)).toEqual(expected)
      expect((await service.search({text:'Need%'})).results.map(r=>r.listing_id)).toEqual(expected)
      const box={west:106.69,south:10.76,east:106.74,north:10.8}
      const map=await service.map({text:'needle',bounding_box:box,zoom:15})
      expect(map.features.map(r=>r.kind==='listing' && r.listing_id).sort()).toEqual([...expected].sort())
      const clusters=await service.map({text:'needle',bounding_box:box,zoom:10})
      expect(clusters.features.reduce((n,r)=>n+(r.kind==='cluster'?r.count:0),0)).toBe(3)
    } finally { await client.query('ROLLBACK TO SAVEPOINT text_fields') }
  })

  it('keeps future, expired and overlapping offer selection live for search, markers and clusters', async () => {
    await client.query('SAVEPOINT temporal_offers')
    try {
      await client.query(`UPDATE housing.offers SET valid_from=now()-interval '10 days' WHERE listing_id=$1`,[ids.validListing])
      const newer = (await client.query(`INSERT INTO housing.offers(listing_id,price_amount,currency,price_period,valid_from)
        VALUES($1,16000000,'VND','month',now()+interval '1 day') RETURNING id`,[ids.validListing])).rows[0].id
      const check = async (amount: number) => {
        expect((await service.get(ids.validListing)).price.amount).toBe(amount)
        expect((await service.search({text:'Valid listing'})).results[0].price.amount).toBe(amount)
        for (const zoom of [10,15]) {
          const feature = (await service.map({bounding_box:{west:106.69,south:10.76,east:106.74,north:10.8},listing_ids:[ids.validListing],zoom})).features[0]
          expect(feature.kind==='cluster' ? feature.min_price_amount : feature.price.amount).toBe(amount)
        }
      }
      await check(14000000) // future offer cannot win just because it was inserted most recently
      await client.query(`UPDATE housing.offers SET valid_from=now()-interval '1 day' WHERE id=$1`,[newer])
      await check(16000000) // no update or refresh of map_points is needed
      await client.query(`UPDATE housing.offers SET valid_to=now()-interval '1 hour' WHERE id=$1`,[newer])
      await check(14000000) // fallback to the older still-valid price
      await client.query(`UPDATE housing.offers SET is_active=false WHERE listing_id=$1`,[ids.validListing])
      expect((await service.search({text:'Valid listing'})).results).toEqual([])
      expect((await service.map({bounding_box:{west:106.69,south:10.76,east:106.74,north:10.8},listing_ids:[ids.validListing],zoom:15})).features).toEqual([])
    } finally { await client.query('ROLLBACK TO SAVEPOINT temporal_offers') }
  })

  it('applies identical hard filters to search, map listings and map clusters', async () => {
    const filters = {
      bounding_box: { west: 106.69, south: 10.76, east: 106.74, north: 10.80 },
      listing_type: ['rent'], property_type: ['apartment'], source_filters: ['import'],
      min_price: { amount: 13_000_000, currency: 'VND', period: 'month' },
      max_price: { amount: 15_000_000, currency: 'VND', period: 'month' },
      min_bedrooms: 2, max_bedrooms: 2, min_bathrooms: 2,
      min_area_m2: 75, max_area_m2: 80, amenities: ['parking'],
      nearby: [{ category: 'hospital', max_distance_m: 1000 }],
    }
    const found = await service.search(filters)
    expect(found.results.map((r) => r.listing_id)).toEqual([ids.validListing])
    const markers = await service.map({ ...filters, zoom: 15 })
    expect(markers.features.map((r) => r.kind === 'listing' && r.listing_id)).toEqual([ids.validListing])
    const clusters = await service.map({ ...filters, zoom: 10 })
    expect(clusters.features).toEqual([expect.objectContaining({ kind: 'cluster', count: 1, min_price_amount: 14_000_000, price_period: 'month' })])
    expect(clusters.meta.truncated).toBe(false)
    const empty = await service.map({ ...filters, amenities: ['not_in_fixture'], zoom: 10 })
    expect(empty.features).toEqual([])
  })

  it('can restrict both map modes to the exact IDs returned to the caller', async () => {
    for (const zoom of [10, 15]) {
      const result = await service.map({
        bounding_box: { west: 106.69, south: 10.76, east: 106.74, north: 10.80 },
        listing_ids: [ids.validListing], zoom,
      })
      expect(result.features).toHaveLength(1)
      expect(result.features[0]).toMatchObject(zoom < 13 ? { kind: 'cluster', count: 1 } : { listing_id: ids.validListing })
    }
  })

  it('keeps nightly and monthly prices in separate clusters in the same cell', async () => {
    await client.query('SAVEPOINT map_period_test')
    try {
      await client.query('UPDATE catalog.places SET geom = (SELECT geom FROM catalog.places WHERE id = $1) WHERE id = $2', [ids.validPlace, ids.expensivePlace])
      await client.query("UPDATE housing.offers SET price_period = 'night' WHERE listing_id = $1", [ids.expensiveListing])
      const result = await service.map({
        bounding_box: { west: 106.69, south: 10.76, east: 106.74, north: 10.80 },
        listing_ids: [ids.validListing, ids.expensiveListing], zoom: 10,
      })
      expect(result.features).toHaveLength(2)
      expect(result.features).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'cluster', count: 1, price_period: 'month', min_price_amount: 14_000_000 }),
        expect.objectContaining({ kind: 'cluster', count: 1, price_period: 'night', min_price_amount: 20_000_000 }),
      ]))
    } finally { await client.query('ROLLBACK TO SAVEPOINT map_period_test') }
  })

  it('returns nearby coordinates and distance semantics without a second get_place call', async () => {
    const matches = await placeService.findNearby({ lng: 106.7, lat: 10.77 }, [{ category: 'hospital', max_distance_m: 1000 }])
    expect(matches).toEqual([expect.objectContaining({
      place_id: ids.hospitalPlace, location: { lng: 106.701, lat: 10.771 }, distance_kind: 'straight_line',
    })])
  })

  it('exposes deposit and accuracy consistently in search and detail', async () => {
    await client.query("UPDATE housing.listings SET attributes = '{\"location_accuracy\":\"approximate\",\"location_method\":\"source_pin\"}'::jsonb WHERE id = $1", [ids.validListing])
    await client.query('UPDATE housing.offers SET deposit_amount = 28000000 WHERE listing_id = $1', [ids.validListing])
    try {
      const expected = { location_accuracy: 'approximate', location_method: 'source_pin', deposit: { amount: 28000000, currency: 'VND' } }
      expect(await service.get(ids.validListing)).toMatchObject(expected)
      expect((await service.search({ text: 'Valid listing' })).results.find((row) => row.listing_id === ids.validListing)).toMatchObject(expected)
      expect(await service.get(ids.unknownListing)).toMatchObject({ location_accuracy: 'unknown', location_method: null, deposit: null })
    } finally {
      await client.query("UPDATE housing.listings SET attributes = '{}'::jsonb WHERE id = $1", [ids.validListing])
      await client.query('UPDATE housing.offers SET deposit_amount = NULL WHERE listing_id = $1', [ids.validListing])
    }
  })

  it('resolves housing/place/coordinate endpoints with source metadata and preserves direction', async () => {
    const fetchMock = vi.fn(async () => routeResponse(1800))
    vi.stubGlobal('fetch', fetchMock)
    const endpoints = new RouteEndpointService(client as unknown as QueryExecutor, new RouteService(getRuntimeConfig().osrmUrls))
    const housing = { type: 'housing', listing_id: ids.validListing }
    const place = { type: 'place', place_id: ids.hospitalPlace }
    const coordinate = { type: 'coordinate', location: { lng: 106.701, lat: 10.771 } }
    for (const [origin, destination] of [[housing, place], [place, housing], [housing, housing], [housing, coordinate]]) {
      const output = await endpoints.calculate({ city: 'hcm', origin, destination, profile: 'walking' })
      expect(output.origin.type).toBe(origin!.type)
      expect(output.destination.type).toBe(destination!.type)
      expect(output.origin.source?.type).toBe('import')
      expect(output.warnings).toHaveLength(2)
      expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain(`${output.origin.location.lng},${output.origin.location.lat};${output.destination.location.lng},${output.destination.location.lat}`)
    }
    await expect(endpoints.calculate({ city: 'hcm', origin: housing, destination: { type: 'place', place_id: ids.validListing } })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await client.query("UPDATE housing.listings SET status = 'stale' WHERE id = $1", [ids.validListing])
    try {
      await expect(endpoints.calculate({ city: 'hcm', origin: housing, destination: place })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    } finally { await client.query("UPDATE housing.listings SET status = 'active' WHERE id = $1", [ids.validListing]) }
  })

  it('coarse-filters in PostGIS then checks the 1-2 km road-distance interval', async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input)
      const distance = url.includes('106.705,10.775;') ? 2_500 : url.includes('106.706,10.776;') ? 800 : 1_800
      return routeResponse(distance)
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await service.search({
      commute: { destination: { lng: 106.701, lat: 10.771 }, min_distance_m: 1_000, max_distance_m: 2_000 },
    })
    expect(result.results.map((item) => item.listing_id)).toEqual([ids.validListing])
    expect(result.results[0]?.commute?.distance_meters).toBe(1_800)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes('106.73,10.79'))).toBe(true)
    expect(new URL(String(fetchMock.mock.calls[0]![0])).searchParams.get('radiuses')).toBe('100;100')
  })

  it('keeps candidates just outside the raw radius when road snapping can bring them inside', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => routeResponse(1_990)))
    const result = await service.search({
      min_bedrooms: 2,
      max_price: { amount: 15_000_000, currency: 'VND', period: 'month' },
      commute: { destination: { lng: 106.719, lat: 10.77 }, max_distance_m: 2_000 },
    })
    expect(result.results.some((item) => item.listing_id === ids.validListing)).toBe(true)
  })

  it('evaluates the requested direction instead of treating roads as symmetric', async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo) =>
      routeResponse(new URL(String(input)).pathname.includes('/106.701,10.771;') ? 2_500 : 1_800))
    vi.stubGlobal('fetch', fetchMock)
    const query = {
      min_bedrooms: 2,
      max_price: { amount: 15_000_000, currency: 'VND', period: 'month' },
      commute: { destination: { lng: 106.701, lat: 10.771 }, max_distance_m: 2_000 },
    }
    expect((await service.search(query)).results.map((item) => item.listing_id)).toEqual([ids.validListing])
    expect((await service.search({ ...query, commute: { ...query.commute, direction: 'destination_to_listing' } })).results).toEqual([])
  })

  it('continues beyond a full candidate budget even when the first page has no matches', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo) => routeResponse(1_800, String(input).includes('106.73') ? 2_400 : 600)))
    const boundedService = new HousingQueryService(client as unknown as QueryExecutor, new RouteService(getRuntimeConfig().osrmUrls), { commuteCandidateLimit: 1 })
    const query = {
      min_bedrooms: 2,
      max_price: { amount: 15_000_000, currency: 'VND', period: 'month' },
      commute: { destination: { lng: 106.72, lat: 10.79 }, max_duration_seconds: 1_200 },
      pagination: { limit: 5, cursor: null as string | null },
    }
    const first = await boundedService.search(query)
    expect(first.results).toEqual([])
    expect(first.diagnostics.candidate_limit_reached).toBe(true)
    expect(first.page.next_cursor).not.toBeNull()
    const second = await boundedService.search({ ...query, pagination: { ...query.pagination, cursor: first.page.next_cursor } })
    expect(second.results.map((item) => item.listing_id)).toEqual([ids.validListing])
    expect(second.page.next_cursor).toBeNull()
  })

  it('paginates filtered matches without skipping candidates evaluated in the same batch', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => routeResponse(1_800)))
    const query = {
      commute: { destination: { lng: 106.701, lat: 10.771 }, max_distance_m: 2_000 },
      pagination: { limit: 1, cursor: null as string | null },
    }
    const seen: string[] = []
    do {
      const result = await service.search(query)
      seen.push(...result.results.map((item) => item.listing_id))
      query.pagination.cursor = result.page.next_cursor
    } while (query.pagination.cursor)
    expect(seen).toEqual([ids.unknownListing, ids.validListing, ids.expensiveListing])
  })

  it('excludes unroutable candidates but surfaces an OSRM outage', async () => {
    const query = { commute: { destination: { lng: 106.701, lat: 10.771 }, max_distance_m: 2_000 } }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 'NoRoute' }), { status: 400 })))
    const result = await service.search(query)
    expect(result.results).toEqual([])
    expect(result.diagnostics.excluded_unknown_count).toBe(3)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    await expect(service.search(query)).rejects.toMatchObject({ code: 'OSRM_OFFLINE' })
  })

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

  it('matches a district name with or without its unit-type prefix, but not a different name', async () => {
    await client.query('SAVEPOINT district_prefix')
    try {
      await client.query(`UPDATE catalog.places SET address = '{"district": "Quận Kiểm Thử Đông"}'::jsonb WHERE id = $1`, [
        ids.validPlace,
      ])
      for (const district of ['Kiểm Thử Đông', 'Quận Kiểm Thử Đông', 'quận kiểm thử đông']) {
        const response = await service.search({ district, pagination: { limit: 20, cursor: null } })
        expect(response.results.map((item) => item.listing_id)).toEqual([ids.validListing])
      }
      const other = await service.search({ district: 'Kiểm Thử', pagination: { limit: 20, cursor: null } })
      expect(other.results).toEqual([])
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT district_prefix')
    }
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

  it('shares nearby SQL across a candidate batch without changing listing order or pagination', async () => {
    const query = vi.fn((text: string, values?: unknown[]) => client.query(text, values))
    const counted = new HousingQueryService({ query } as unknown as QueryExecutor,
      new RouteService(getRuntimeConfig().osrmUrls), { commuteCandidateLimit: 20 })
    const nearby = [
      { category: 'hospital', max_distance_m: 10_000 },
      { category: 'hospital', max_distance_m: 10_000 },
    ]
    const result = await counted.search({ nearby, pagination: { limit: 3, cursor: null } })
    expect(result.results.map(row => row.listing_id)).toEqual([ids.unknownListing, ids.slowListing, ids.validListing])
    expect(result.results.every(row => row.nearby.length === 2)).toBe(true)
    expect(query).toHaveBeenCalledTimes(2) // candidate page + one nearby batch, not 3 * 2 additional queries
    const next = await counted.search({ nearby, pagination: { limit: 3, cursor: result.page.next_cursor } })
    expect(next.results.map(row => row.listing_id)).toEqual([ids.expensiveListing])
    expect(next.page.next_cursor).toBeNull()
    query.mockClear()
    await counted.search({ pagination: { limit: 3, cursor: null } })
    expect(query).toHaveBeenCalledTimes(1) // no extra SQL for searches without nearby constraints
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

function routeResponse(distance: number, duration = 600) {
  return new Response(JSON.stringify({
    code: 'Ok',
    waypoints: [{ distance: 30 }, { distance: 20 }],
    routes: [{ distance, duration, geometry: { type: 'LineString', coordinates: [[106.7, 10.77], [106.701, 10.771]] } }],
  }), { headers: { 'content-type': 'application/json' } })
}

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
