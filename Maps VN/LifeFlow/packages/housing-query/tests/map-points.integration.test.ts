import { afterAll, beforeAll, expect, it } from 'vitest'
import { createDatabasePool, getRuntimeConfig } from '../src/index.js'
import type pg from 'pg'

let pool: ReturnType<typeof createDatabasePool>, db: pg.PoolClient
let place: string, property: string, unit: string, listing: string
beforeAll(async () => {
  pool = createDatabasePool(getRuntimeConfig().ingestDatabaseUrl, 1)
  db = await pool.connect()
  await db.query('BEGIN')
  place = (await db.query(`INSERT INTO catalog.places(category_id,geom,address)
    VALUES((SELECT id FROM catalog.place_categories LIMIT 1),ST_SetSRID(ST_MakePoint(106.7,10.77),4326),'{"district":"Quận 1"}') RETURNING id`)).rows[0].id
  property = (await db.query(`INSERT INTO housing.properties(place_id,property_type) VALUES($1,'room') RETURNING id`,[place])).rows[0].id
  unit = (await db.query(`INSERT INTO housing.units(property_id,bedrooms,area_m2) VALUES($1,1,20) RETURNING id`,[property])).rows[0].id
  listing = (await db.query(`INSERT INTO housing.listings(property_id,unit_id,listing_type,title,source_type,source_listing_id)
    VALUES($1,$2,'rent','Map point test','import',gen_random_uuid()::text) RETURNING id`,[property,unit])).rows[0].id
})
afterAll(async () => { if(db){await db.query('ROLLBACK');db.release()} if(pool)await pool.end() })

it('keeps map data fresh within the source transaction and preserves a soft-deleted unit as unknown', async () => {
  const point = async () => (await db.query('SELECT *,ST_X(geom) AS lng FROM housing.map_points WHERE id=$1',[listing])).rows[0]
  expect(await point()).toMatchObject({property_type:'room',bedrooms:'1.00',area_m2:'20.00'})
  await db.query(`UPDATE housing.listings SET title='Fresh marker',source_url='https://example.test/room',
    attributes='{"location_accuracy":"approximate","irrelevant_provider_payload":"not copied"}' WHERE id=$1`,[listing])
  expect(await point()).toMatchObject({title:'Fresh marker',source_url:'https://example.test/room',location_accuracy:'approximate'})
  expect(await point()).not.toHaveProperty('attributes')
  await db.query('UPDATE housing.units SET area_m2=25,amenities=ARRAY[\'parking\'] WHERE id=$1',[unit])
  expect(await point()).toMatchObject({area_m2:'25.00',amenities:['parking']})
  await db.query('UPDATE catalog.places SET geom=ST_SetSRID(ST_MakePoint(106.8,10.78),4326) WHERE id=$1',[place])
  expect((await point()).lng).toBe(106.8)
  await db.query("UPDATE housing.properties SET property_type='studio' WHERE id=$1",[property])
  expect((await point()).property_type).toBe('studio')
  await db.query("UPDATE housing.listings SET status='inactive' WHERE id=$1",[listing])
  expect(await point()).toBeUndefined()
  await db.query("UPDATE housing.listings SET status='active' WHERE id=$1",[listing])
  expect(await point()).toBeDefined()
  await db.query('UPDATE housing.units SET deleted_at=now() WHERE id=$1',[unit])
  expect(await point()).toMatchObject({bedrooms:null,area_m2:null,unit_id:null,amenities:[]})
  await db.query('SAVEPOINT hide_point')
  await db.query('UPDATE catalog.places SET deleted_at=now() WHERE id=$1',[place])
  expect(await point()).toBeUndefined()
  await db.query('ROLLBACK TO SAVEPOINT hide_point')
  expect(await point()).toBeDefined()
  await db.query('UPDATE housing.listings SET deleted_at=now() WHERE id=$1',[listing])
  expect(await point()).toBeUndefined()
})

it('lets the app read the derived data but denies direct writes and calls to its privileged sync helpers', async () => {
  const config = getRuntimeConfig()
  const permissions = (await db.query(`SELECT
    has_table_privilege($1,'housing.map_points','SELECT') AS readable,
    has_table_privilege($1,'housing.map_points','INSERT') AS writable,
    has_function_privilege($1,'housing.sync_map_points(uuid[])','EXECUTE') AS sync_callable,
    has_function_privilege($1,'housing.sync_map_display()','EXECUTE') AS display_callable`,[config.postgresAppUser])).rows[0]
  expect(permissions).toEqual({readable:true,writable:false,sync_callable:false,display_callable:false})
})

it('syncs map data from a fresh connection that has not touched catalog.places yet', async () => {
  // The SECURITY DEFINER sync functions run with search_path=pg_catalog,pg_temp. Planning their
  // query loads the places expression indexes, so geo.normalize_search must not depend on search_path.
  const fresh = createDatabasePool(getRuntimeConfig().ingestDatabaseUrl, 1)
  try {
    const client = await fresh.connect()
    try {
      await client.query('SET search_path = pg_catalog, pg_temp')
      await client.query('EXPLAIN SELECT * FROM housing.map_point_source WHERE id = ANY($1::uuid[])', [[listing]])
      expect((await client.query("SELECT geo.normalize_search('Đường   Lê Lợi') AS value")).rows[0].value).toBe('duong le loi')
    } finally {
      client.release()
    }
  } finally {
    await fresh.end()
  }
})
