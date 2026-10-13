import { createDatabasePool, getRuntimeConfig } from '@relohome/housing-query'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'

const enabled = process.env.RUN_POI_V2_INTEGRATION === '1'

describe.runIf(enabled)('POI v2 live import', () => {
  const config = getRuntimeConfig()
  const pool = createDatabasePool(config.databaseUrl, 2)
  const ingestPool = createDatabasePool(config.ingestDatabaseUrl, 1)
  let app: FastifyInstance
  let runId: string

  beforeAll(async () => {
    app = buildApp(pool, config)
    await app.ready()
    const run = await pool.query(
      `SELECT id FROM geo.import_runs
       WHERE source_version IS NOT NULL AND status = 'completed'
       ORDER BY started_at DESC LIMIT 1`,
    )
    expect(run.rowCount).toBe(1)
    runId = run.rows[0].id
  })

  afterAll(async () => {
    await app?.close()
    await ingestPool.end()
  })

  it('accounts for every staged input and preserves valid source geometry', async () => {
    const result = await pool.query(
      `SELECT r.input_count, r.staged_count, r.accepted_count, r.rejected_count,
              r.duplicate_count, r.published_count,
              count(s.id)::integer AS actual_staged,
              count(s.id) FILTER (WHERE s.validation_status = 'accepted')::integer AS actual_accepted,
              count(s.id) FILTER (WHERE s.validation_status = 'accepted'
                AND (s.source_geom IS NULL OR s.representative_geom IS NULL
                  OR NOT ST_IsValid(s.source_geom) OR ST_SRID(s.source_geom) <> 4326))::integer AS bad_geometry
       FROM geo.import_runs r JOIN geo.poi_staging s ON s.import_run_id = r.id
       WHERE r.id = $1 GROUP BY r.id`,
      [runId],
    )
    const row = result.rows[0]
    expect(row.input_count).toBeGreaterThan(0)
    expect(row.input_count).toBe(row.staged_count)
    expect(row.input_count).toBe(row.actual_staged)
    expect(row.input_count).toBe(row.accepted_count + row.rejected_count + row.duplicate_count)
    expect(row.accepted_count).toBe(row.actual_accepted)
    expect(row.bad_geometry).toBe(0)
  })

  it('keeps source identity and raw payload linked to a canonical place', async () => {
    const result = await ingestPool.query(
      `SELECT s.source_id, s.canonical_place_id, ps.source_payload->>'id' AS payload_id,
              sr.osm_type, sr.osm_id, ST_SRID(sr.geom) AS source_srid
       FROM geo.poi_staging s
       JOIN catalog.place_sources ps ON ps.source_type = 'osm' AND ps.source_id = s.source_id
       JOIN integration.source_records sr ON sr.source_type = 'osm'
         AND sr.source_id = s.source_id AND sr.payload_hash = s.payload_hash
       WHERE s.import_run_id = $1 AND s.validation_status = 'accepted'
       ORDER BY s.id LIMIT 1`,
      [runId],
    )
    expect(result.rowCount).toBe(1)
    expect(result.rows[0].source_id).toBe(result.rows[0].payload_id)
    expect(result.rows[0].canonical_place_id).toBeTruthy()
    expect(['node', 'way', 'relation']).toContain(result.rows[0].osm_type)
    expect(Number(result.rows[0].osm_id)).toBeGreaterThan(0)
    expect(result.rows[0].source_srid).toBe(4326)
  })

  it('maps Osmium area IDs to their original OSM way or relation', async () => {
    const result = await ingestPool.query(
      `SELECT s.source_id, s.osmium_feature_id, s.osm_type, s.osm_id,
              ps.source_url, ps.source_payload->>'osmium_feature_id' AS payload_feature_id
       FROM geo.poi_staging s
       JOIN catalog.place_sources ps ON ps.source_type = 'osm' AND ps.source_id = s.source_id
       WHERE s.import_run_id = $1 AND s.validation_status = 'accepted'
         AND s.source_id LIKE 'area/%'
       LIMIT 1`,
      [runId],
    )
    expect(result.rowCount).toBe(1)
    const area = result.rows[0]
    expect(area.osmium_feature_id).toMatch(/^a\d+$/)
    expect(area.payload_feature_id).toBe(area.osmium_feature_id)
    expect(area.source_id).toBe(`area/${area.osmium_feature_id.slice(1)}`)
    expect(area.source_url).toBe(`https://www.openstreetmap.org/${area.osm_type}/${area.osm_id}`)
  })

  it('filters an imported hospital by category and radius', async () => {
    const sample = await pool.query(
      `SELECT p.id, ST_X(p.geom) AS lng, ST_Y(p.geom) AS lat
       FROM catalog.places p
       JOIN catalog.place_categories c ON c.id = p.category_id
       JOIN catalog.place_sources ps ON ps.place_id = p.id AND ps.source_type = 'osm'
       WHERE c.slug = 'hospital' AND p.status = 'active' AND p.deleted_at IS NULL
       LIMIT 1`,
    )
    expect(sample.rowCount).toBe(1)
    const point = sample.rows[0]
    const response = await app.inject({
      method: 'POST', url: '/v1/places/search',
      payload: {
        categories: ['hospital'], center: { lng: point.lng, lat: point.lat },
        radius_m: 10, pagination: { limit: 100, cursor: null },
      },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json().results).toEqual(expect.arrayContaining([
      expect.objectContaining({ place_id: point.id, category: 'hospital' }),
    ]))
    expect(response.json().results[0]).toHaveProperty('opening_hours')
  })

  it.each(['hospital', 'supermarket', 'school', 'gym', 'restaurant'])(
    'finds %s POIs in HCM by category', async (category) => {
      const response = await app.inject({
        method: 'POST', url: '/v1/places/search',
        payload: {
          categories: [category],
          bounding_box: { west: 106.34, south: 10.34, east: 107.05, north: 11.2 },
          pagination: { limit: 10, cursor: null },
        },
      })
      expect(response.statusCode).toBe(200)
      expect(response.json().results.length).toBeGreaterThan(0)
      expect(response.json().results.every((place: { category: string }) => place.category === category)).toBe(true)
    },
  )
})
