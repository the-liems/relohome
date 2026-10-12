import { randomUUID } from 'node:crypto'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import type pg from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { applyPoiDedup, createDatabasePool, getRuntimeConfig, LocationService, PlaceService,
  previewPoiDedup, RouteEndpointService, type RouteService } from '../src/index.js'

describe.runIf(process.env.RUN_POI_CANONICAL_TESTS === '1')('physical named POI cleanup', () => {
  let pool: ReturnType<typeof createDatabasePool>
  let db: pg.PoolClient
  beforeAll(async () => {
    pool = createDatabasePool(getRuntimeConfig().adminDatabaseUrl, 1)
    db = await pool.connect()
    // These fixtures and importer tests must never run against the application's database.
    expect((await db.query('SELECT current_database() name')).rows[0].name).toMatch(/^lifeflow_poi_test_/)
  })
  beforeEach(async () => { await db.query('BEGIN') })
  afterEach(async () => { await db.query('ROLLBACK') })
  afterAll(async () => { db?.release(); await pool?.end() })

  async function place(sourceId: string, name = 'Canonical test pharmacy', category = 'pharmacy', lng = 105.84) {
    const id = randomUUID()
    await db.query(`INSERT INTO catalog.places(id,category_id,name,geom)
      SELECT $1,id,$2,ST_SetSRID(ST_MakePoint($3,21.0),4326) FROM catalog.place_categories WHERE slug=$4`,
    [id, name, lng, category])
    await db.query(`INSERT INTO catalog.place_sources(place_id,source_type,source_id,source_payload)
      VALUES($1,'osm',$2,'{}'::jsonb)`, [id, sourceId])
    return id
  }
  async function dedup() {
    const plan = await previewPoiDedup(db)
    return { plan, applied: await applyPoiDedup(db, plan.manifest_hash) }
  }

  it('shows one result in resolve, search, map and nearby; old IDs retain exact coordinates', async () => {
    const way = await place('way/99000001')
    const area = await place('area/198000002', undefined, undefined, 105.8403)
    const { plan } = await dedup()
    expect(plan.aliases).toEqual([{ alias_place_id: way, canonical_place_id: area, osm_identity: 'way/99000001' }])
    const places = new PlaceService(db)
    const resolved = await new LocationService(db).resolve({ text: 'Canonical test pharmacy', entity_types: ['place'], limit: 10 })
    expect(resolved.results.map(r => r.canonical_id)).toEqual([area])
    expect(resolved.results[0]!.alias_ids).toEqual([way])
    expect((await places.search({ text: 'Canonical test pharmacy' })).results.map(r => r.place_id)).toEqual([area])
    expect((await places.map({ bounding_box: { west: 105.83, south: 20.99, east: 105.85, north: 21.01 } })).features.map(r => r.id)).toEqual([area])
    expect((await places.findNearby({ lng: 105.84, lat: 21 }, [{ category: 'pharmacy', max_distance_m: 500 }]))[0]!.place_id).toBe(area)
    expect((await db.query('SELECT id FROM catalog.places WHERE id=$1',[way])).rowCount).toBe(0)
    expect((await db.query("SELECT count(DISTINCT place_id)::int n FROM catalog.place_sources WHERE source_id IN ('way/99000001','area/198000002')")).rows[0].n).toBe(1)
    expect(await places.get(way)).toMatchObject({ place_id: way, location: { lng: 105.84, lat: 21 } })
    expect(await places.get(area)).toMatchObject({ place_id: area, location: { lng: 105.8403, lat: 21 } })
    const routes = { calculate: async (input: { origin: { lng: number; lat: number }; destination: { lng: number; lat: number } }) => ({
      code: 'Ok', distance_meters: 10, duration_seconds: 3,
      geometry: { type: 'LineString', coordinates: [[input.origin.lng, input.origin.lat], [input.destination.lng, input.destination.lat]] },
    }) } as unknown as RouteService
    const route = await new RouteEndpointService(db, routes).calculate({ city: 'hanoi',
      origin: { type: 'place', place_id: way }, destination: { type: 'coordinate', location: { lng: 105.841, lat: 21 } } })
    expect(route.origin).toMatchObject({ canonical_id: way, location: { lng: 105.84, lat: 21 } })
  })

  it('keeps nearby same-name nodes, opposite stops and campus categories separate', async () => {
    const stopA = await place('node/99000011', 'Bách Khoa', 'bus_stop')
    const stopB = await place('node/99000012', 'Bách Khoa', 'bus_stop', 105.8401)
    const university = await place('way/99000013', 'Bách Khoa', 'university', 105.8402)
    await dedup()
    const rows = (await new LocationService(db).resolve({ text: 'Bách Khoa', entity_types: ['place'], limit: 10 })).results
    expect(rows.map(r => r.canonical_id).sort()).toEqual([stopA, stopB, university].sort())
    expect(rows.find(r => r.canonical_id === university)!.display_name).toContain('Trường đại học')
    expect(rows.find(r => r.canonical_id === stopA)!.display_name).toContain('Trạm xe buýt')
  })

  it('puts name and category conflicts in review instead of hiding them', async () => {
    await place('way/99000021', 'Name A')
    await place('area/198000042', 'Name B')
    await place('way/99000022', 'Bách Khoa', 'university')
    await place('area/198000044', 'Bách Khoa', 'bus_stop')
    const plan = await previewPoiDedup(db)
    expect(plan.aliases).toEqual([])
    expect(plan.review.map(r => r.reason).sort()).toEqual(['category_conflict', 'name_conflict'])
  })

  it('preserves unnamed rows instead of treating missing names as duplicate names', async () => {
    const way = await place('way/99000023', 'Named campus', 'university')
    const area = await place('area/198000046', 'Named campus', 'university')
    await db.query('UPDATE catalog.places SET name=NULL WHERE id=$1', [area])
    const plan=await previewPoiDedup(db)
    expect(plan.aliases).toEqual([])
    expect(plan.review[0]!.reason).toBe('missing_name')
    expect((await db.query('SELECT id FROM catalog.places WHERE id=ANY($1::uuid[])',[[area,way]])).rowCount).toBe(2)
  })

  it('protects housing and merges shared OSM components while retaining every raw source', async () => {
    const house = await place('way/99000031')
    await place('area/198000062')
    await db.query("INSERT INTO housing.properties(place_id,property_type) VALUES($1,'room')", [house])
    const shared = await place('way/99000032')
    const canonical=await place('area/198000064')
    await db.query("INSERT INTO catalog.place_sources(place_id,source_type,source_id) VALUES($1,'osm','node/99000033')", [shared])
    const plan = await previewPoiDedup(db)
    expect(plan.aliases).toEqual([{alias_place_id:shared,canonical_place_id:canonical,osm_identity:'way/99000032'}])
    expect(plan.review.map(r => r.reason)).toEqual(['housing_reference'])
    await applyPoiDedup(db,plan.manifest_hash)
    expect((await db.query('SELECT place_id FROM catalog.place_sources WHERE source_id=$1',['node/99000033'])).rows[0].place_id).toBe(canonical)
    expect((await db.query('SELECT place_id FROM housing.properties')).rows).toEqual([{ place_id: house }])
  })

  it('rejects changed manifests and rolls back physical changes transactionally', async () => {
    const way = await place('way/99000041')
    await place('area/198000082')
    const before = (await db.query('SELECT row_to_json(p) row FROM catalog.places p ORDER BY id')).rows
    const aliasesBefore = (await db.query('SELECT * FROM catalog.poi_aliases ORDER BY alias_place_id')).rows
    await db.query('SAVEPOINT physical_cleanup')
    await expect(applyPoiDedup(db, 'wrong')).rejects.toThrow('manifest changed')
    expect((await db.query('SELECT * FROM catalog.poi_aliases ORDER BY alias_place_id')).rows).toEqual(aliasesBefore)
    const { applied } = await dedup()
    expect(applied.deleted_count).toBe(1)
    expect((await db.query('SELECT id FROM catalog.places WHERE id=$1',[way])).rowCount).toBe(0)
    expect((await previewPoiDedup(db)).aliases).toEqual([])
    await db.query('ROLLBACK TO SAVEPOINT physical_cleanup')
    expect((await db.query('SELECT row_to_json(p) row FROM catalog.places p ORDER BY id')).rows).toEqual(before)
    expect((await new PlaceService(db).search({ text: 'Canonical test pharmacy' })).results.map(r => r.place_id)).toContain(way)
  })

  it('keeps same-name services on different floors or units and different amenities in one building', async () => {
    for (const [n,key,values] of [[61,'level',['1','2']],[62,'addr:unit',['A','B']]] as const) {
      const one=await place(`way/990000${n}`,'Same-name building shop')
      const two=await place(`area/${2*(99000000+n)}`,'Same-name building shop')
      for (const [index,id] of [one,two].entries()) await db.query('UPDATE catalog.places SET attributes=jsonb_build_object($2::text,$3::text) WHERE id=$1',[id,key,values[index]])
    }
    await place('way/99000063','Building service','pharmacy')
    await place('area/198000126','Building service','clinic')
    const plan=await previewPoiDedup(db)
    expect(plan.aliases).toEqual([])
    expect(plan.review.map(g=>g.reason).sort()).toEqual(['category_conflict','floor_conflict','unit_or_branch_conflict'])
    expect((await applyPoiDedup(db,plan.manifest_hash)).deleted_count).toBe(0)
  })

  it('preserves media and integration links while removing a duplicate physical row', async () => {
    const old=await place('way/99000071'), canonical=await place('area/198000142')
    await db.query("INSERT INTO catalog.place_media(place_id,url,source_type) VALUES($1,'https://example.test/poi.jpg','osm')",[old])
    const run=(await db.query("INSERT INTO geo.import_runs(source_type,source_path,status) VALUES('fixture','test','completed') RETURNING id")).rows[0].id
    await db.query("INSERT INTO integration.source_records(import_run_id,entity_type,entity_id,source_type,source_id,payload,payload_hash,validation_status) VALUES($1,'place',$2,'osm','way/99000071','{}','fixture-hash','accepted')",[run,old])
    await dedup()
    expect((await db.query('SELECT place_id FROM catalog.place_media WHERE url=$1',['https://example.test/poi.jpg'])).rows[0].place_id).toBe(canonical)
    expect((await db.query("SELECT entity_id FROM integration.source_records WHERE payload_hash='fixture-hash'")).rows[0].entity_id).toBe(canonical)
    expect((await db.query('SELECT count(*)::int n FROM catalog.places WHERE id=ANY($1::uuid[])',[[old,canonical]])).rows[0].n).toBe(1)
  })

  it('imports way+area as one place and re-imports idempotently with both raw sources intact', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lifeflow-poi-import-test-'))
    const osmId = BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 10))
    const waySource = `way/${osmId}`, areaSource = `area/${osmId * 2n}`
    const name = `Importer identity fixture ${randomUUID()}`
    try {
      const source = join(dir, 'fixture.geojsonl'), pbf = join(dir, 'fixture.osm.pbf')
      await writeFile(pbf, 'Explicit importer checksum fixture; not a live OSM extract')
      const feature = (id: string, x: number) => ({ type: 'Feature', id,
        geometry: { type: 'Point', coordinates: [x, 21] }, properties: { amenity: 'pharmacy', name } })
      await writeFile(source, [feature(`w${osmId}`, 105.85), feature(`a${osmId * 2n}`, 105.8501)].map(f => JSON.stringify(f)).join('\n'))
      const importer = fileURLToPath(new URL('../../../apps/platform-api/dist/import-pois-v2.js', import.meta.url))
      for (let i=0;i<2;i++) {
        const run = spawnSync(process.execPath, [importer], { env: { ...process.env,
          POI_V2_SOURCE_PATH: source, OSM_PBF_PATH: pbf, OSM_SOURCE_VERSION: 'canonical-import-fixture' }, timeout: 20000 })
        expect(run.status, run.stderr.toString()).toBe(0)
      }
      const sources = (await db.query('SELECT source_id,place_id FROM catalog.place_sources WHERE source_id IN ($1,$2)', [waySource, areaSource])).rows
      expect(sources).toHaveLength(2)
      expect(new Set(sources.map(r => r.place_id)).size).toBe(1)
      expect((await db.query('SELECT count(*)::int n FROM catalog.places WHERE name=$1', [name])).rows[0].n).toBe(1)
      // Simulate a historical ID after a canonical mapping has been applied.
      const canonical = sources[0].place_id
      const legacy = await place(`node/${osmId + 1n}`, name)
      await db.query('DELETE FROM catalog.place_sources WHERE place_id=$1', [legacy])
      await db.query('UPDATE catalog.place_sources SET place_id=$1 WHERE source_id=$2', [legacy, waySource])
      const plan = await previewPoiDedup(db)
      // A stable canonical area is selected, and provenance on the legacy way is retained.
      const applied = await applyPoiDedup(db, plan.manifest_hash)
      expect(applied.alias_count).toBe(1)
      await db.query('COMMIT')
      await db.query('BEGIN')
      const updated = spawnSync(process.execPath, [importer], { env: { ...process.env,
        POI_V2_SOURCE_PATH: source, OSM_PBF_PATH: pbf, OSM_SOURCE_VERSION: 'canonical-import-fixture' }, timeout: 20000 })
      expect(updated.status, updated.stderr.toString()).toBe(0)
      expect((await db.query('SELECT place_id FROM catalog.place_sources WHERE source_id=$1', [waySource])).rows[0].place_id).toBe(canonical)
      expect((await db.query('SELECT id FROM catalog.places WHERE id=$1',[legacy])).rowCount).toBe(0)
      expect((await db.query('SELECT canonical_place_id FROM catalog.poi_aliases WHERE alias_place_id=$1', [legacy])).rows[0].canonical_place_id).toBe(canonical)
      expect((await new PlaceService(db).search({ text: name })).results.map(r => r.place_id)).toEqual([canonical])
      expect(await new PlaceService(db).get(legacy)).toMatchObject({ place_id: legacy, location: { lng: 105.84, lat: 21 } })
      const layeredName='Layered importer fixture '+randomUUID()
      // Import floor 1 first, then a same-name/same-coordinate POI on floor 2.
      // The spatial matching branch must not combine them.
      for (const level of ['1','2']) {
        await writeFile(source,JSON.stringify({type:'Feature',id:`n${osmId+200n+BigInt(level)}`,
          geometry:{type:'Point',coordinates:[105.86,21]},properties:{amenity:'pharmacy',name:layeredName,level}}))
        const layered=spawnSync(process.execPath,[importer],{env:{...process.env,POI_V2_SOURCE_PATH:source,
          OSM_PBF_PATH:pbf,OSM_SOURCE_VERSION:'separate-floor-fixture'},timeout:20000})
        expect(layered.status,layered.stderr.toString()).toBe(0)
      }
      const floors=(await db.query("SELECT attributes->>'level' level FROM catalog.places WHERE name=$1 ORDER BY 1",[layeredName])).rows
      expect(floors).toEqual([{level:'1'},{level:'2'}])
    } finally {
      if (dirname(resolve(dir)) !== resolve(tmpdir()) || !basename(dir).startsWith('lifeflow-poi-import-test-')) {
        throw new Error('Refusing cleanup outside the test temporary directory')
      }
      await rm(dir, { recursive: true, force: true })
    }
  }, 30000)
})
