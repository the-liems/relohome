import { randomUUID } from 'node:crypto'
import { mkdtemp,readFile,rm,writeFile } from 'node:fs/promises'
import { basename,dirname,join,resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll,beforeAll,describe,expect,it } from 'vitest'
import { applyPoiDedup,createDatabasePool,getRuntimeConfig,PlaceService,previewPoiDedup } from '@relohome/housing-query'
import { exportPoiDataset,importPoiDataset } from '../src/poi-dataset.js'

describe.runIf(process.env.RUN_POI_DATASET_TESTS==='1')('portable clean POI dataset',()=>{
  let source:ReturnType<typeof createDatabasePool>, target:ReturnType<typeof createDatabasePool>, directory:string
  const old=randomUUID(), canonical=randomUUID(), identity=String(BigInt('0x'+randomUUID().replaceAll('-','').slice(0,10)))
  beforeAll(async()=>{
    const url=getRuntimeConfig().adminDatabaseUrl, destination=new URL(url)
    destination.pathname='/'+process.env.POI_ROUNDTRIP_DB
    source=createDatabasePool(url,2);target=createDatabasePool(destination.toString(),2)
    for (const db of [source,target]) expect((await db.query('SELECT current_database() name')).rows[0].name).toMatch(/^lifeflow_poi_test_/)
    directory=await mkdtemp(join(tmpdir(),'lifeflow-clean-dataset-test-'))
    const db=await source.connect()
    try {
      await db.query('BEGIN')
      for (const [id,x,raw] of [[old,105.84,`way/${identity}`],[canonical,105.8403,`area/${BigInt(identity)*2n}`]] as const) {
        await db.query(`INSERT INTO catalog.places(id,category_id,name,geom) SELECT $1,id,$2,
          ST_SetSRID(ST_MakePoint($3,21),4326) FROM catalog.place_categories WHERE slug='pharmacy'`,[id,'Portable fixture '+identity,x])
        await db.query("INSERT INTO catalog.place_sources(place_id,source_type,source_id,source_payload) VALUES($1,'osm',$2,'{}')",[id,raw])
      }
      const plan=await previewPoiDedup(db);await applyPoiDedup(db,plan.manifest_hash);await db.query('COMMIT')
    } catch(error) {await db.query('ROLLBACK');throw error}
    finally {db.release()}
  })
  afterAll(async()=>{
    await source?.end();await target?.end()
    if (directory) {
      if (dirname(resolve(directory))!==resolve(tmpdir()) || !basename(directory).startsWith('lifeflow-clean-dataset-test-')) throw new Error('Unsafe dataset test cleanup')
      await rm(directory,{recursive:true,force:true})
    }
  })
  it('exports one feature per physical POI with sources separate, and restores identical IDs twice',async()=>{
    const path=join(directory,'clean')
    const manifest=await exportPoiDataset(source,path)
    const data=JSON.parse(await readFile(join(path,'pois.geojson'),'utf8'))
    expect(data.features.some((f:{id:string})=>f.id===old)).toBe(false)
    expect(data.features.some((f:{id:string})=>f.id===canonical)).toBe(true)
    expect(manifest.unresolved_osm_groups).toBe(0)
    for (let i=0;i<2;i++) {
      const imported=await importPoiDataset(target,path)
      expect(imported.pois).toBe(data.features.length)
      expect((await target.query('SELECT count(*)::int n FROM catalog.places')).rows[0].n).toBe(data.features.length)
      expect(await new PlaceService(target).get(old)).toMatchObject({place_id:old,location:{lng:105.84,lat:21}})
    }
    const sources=(await target.query("SELECT place_id FROM catalog.place_sources WHERE source_id=ANY($1::text[])",[[`way/${identity}`,`area/${BigInt(identity)*2n}`]])).rows
    expect(sources).toHaveLength(2);expect(new Set(sources.map(s=>s.place_id))).toEqual(new Set([canonical]))
  },30000)
  it('rejects corrupted datasets before changing the target',async()=>{
    const path=join(directory,'clean')
    const before=(await target.query('SELECT count(*)::int n FROM catalog.places')).rows[0].n
    await writeFile(join(path,'pois.geojson'),'tampered fixture')
    await expect(importPoiDataset(target,path)).rejects.toThrow('checksum mismatch')
    expect((await target.query('SELECT count(*)::int n FROM catalog.places')).rows[0].n).toBe(before)
  })
})
