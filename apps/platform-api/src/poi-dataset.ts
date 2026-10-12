import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { once } from 'node:events'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import type { QueryResult } from 'pg'
import type { DatabasePool } from '@relohome/housing-query'

const scope = "p.status='active' AND p.deleted_at IS NULL AND COALESCE(p.attributes->>'entity_role','') <> 'housing_anchor' AND NOT EXISTS(SELECT 1 FROM housing.properties hp WHERE hp.place_id=p.id)"
const files = ['pois.geojson', 'poi-sources.ndjson', 'legacy-ids.ndjson', 'categories.json'] as const
interface Manifest {
  format: 'lifeflow-clean-poi'; version: 1; created_at: string
  counts: Record<string, number>; sha256: Record<string, string>
  semantics: string; unresolved_osm_groups: number
}

async function digest(path: string) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

/** One snapshot, streamed files, canonical rows only. Raw provenance is a separate sidecar. */
export async function exportPoiDataset(pool: DatabasePool, directory: string) {
  const output = resolve(directory)
  await mkdir(dirname(output), { recursive: true })
  // Never replace a reviewed dataset silently.
  await mkdir(output)
  const db = await pool.connect()
  const counts: Record<string, number> = {}
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const categories = (await db.query('SELECT slug,name,parent_slug,attributes FROM catalog.place_categories ORDER BY slug')).rows
    await writeFile(join(output,'categories.json'), JSON.stringify(categories,null,2)+'\n')
    const queries: Record<string,string> = {
      'pois.geojson': `SELECT p.id, jsonb_build_object('type','Feature','id',p.id,
        'geometry',ST_AsGeoJSON(p.geom)::jsonb,'properties',jsonb_build_object(
          'canonical_id',p.id,'name',p.name,'category',c.slug,'address',p.address,
          'phone',p.phone,'website',p.website,'opening_hours',p.opening_hours,
          'verification_status',p.verification_status,'verified_at',p.verified_at,
          'verified_by',p.verified_by,'attributes',p.attributes)) data
        FROM catalog.places p JOIN catalog.place_categories c ON c.id=p.category_id
        WHERE ${scope} AND ($1::uuid IS NULL OR p.id>$1) ORDER BY p.id LIMIT 500`,
      'poi-sources.ndjson': `SELECT s.id,to_jsonb(s)-'import_run_id' data FROM catalog.place_sources s
        JOIN catalog.places p ON p.id=s.place_id WHERE ${scope}
          AND ($1::uuid IS NULL OR s.id>$1) ORDER BY s.id LIMIT 500`,
      'legacy-ids.ndjson': `SELECT a.alias_place_id id,jsonb_build_object('alias_place_id',a.alias_place_id,
        'canonical_place_id',a.canonical_place_id,'osm_identity',a.osm_identity,
        'legacy_name',a.legacy_name,'legacy_location',ST_AsGeoJSON(a.legacy_geom)::jsonb) data
        FROM catalog.poi_aliases a JOIN catalog.places p ON p.id=a.canonical_place_id
        WHERE ${scope} AND ($1::uuid IS NULL OR a.alias_place_id>$1) ORDER BY a.alias_place_id LIMIT 500`,
    }
    for (const [name,sql] of Object.entries(queries)) {
      const stream = createWriteStream(join(output,name), { flags:'wx' })
      let streamError: Error | undefined
      stream.on('error',error => { streamError=error })
      const write = async (value:string) => {
        if (streamError) throw streamError
        if (!stream.write(value)) await once(stream,'drain')
      }
      let last: string | null=null, count=0
      try {
        if (name==='pois.geojson') await write('{"type":"FeatureCollection","features":[\n')
        while (true) {
          const page: QueryResult<{id:string;data:Record<string,unknown>}> = await db.query(sql,[last])
          if (!page.rowCount) break
          for (const row of page.rows) {
            await write((name==='pois.geojson' && count ? ',\n' : '')+JSON.stringify(row.data)+(name==='pois.geojson' ? '' : '\n'))
            last=row.id; count++
          }
        }
        if (name==='pois.geojson') await write('\n]}\n')
        stream.end(); await once(stream,'finish')
        if (streamError) throw streamError
        counts[name]=count
      } finally { stream.destroy() }
    }
    const unresolved = await db.query(`SELECT count(*)::int n FROM (
      SELECT catalog.osm_object_identity(s.source_id) FROM catalog.place_sources s
      JOIN catalog.places p ON p.id=s.place_id WHERE ${scope} AND s.source_type='osm'
        AND catalog.osm_object_identity(s.source_id) IS NOT NULL
      GROUP BY catalog.osm_object_identity(s.source_id) HAVING count(DISTINCT s.place_id)>1
    ) conflicts`)
    const hashes: Record<string,string> = {}
    for (const name of files) hashes[name]=await digest(join(output,name))
    const manifest:Manifest = { format:'lifeflow-clean-poi',version:1,created_at:new Date().toISOString(),
      counts,sha256:hashes,unresolved_osm_groups:unresolved.rows[0].n,
      semantics:'Physical named duplicate POIs merged only with shared OSM identity and compatible category/floor/unit. Unnamed, conflicting, distinct campuses/stops preserved. Housing excluded.' }
    await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n')
    await db.query('COMMIT')
    return {directory:output,...manifest}
  } catch(error) { await db.query('ROLLBACK'); throw error }
  finally { db.release() }
}

/** Restore the same canonical IDs on another configured database, or re-run idempotently. */
export async function importPoiDataset(pool: DatabasePool, directory: string) {
  const input=resolve(directory)
  const manifest=JSON.parse(await readFile(join(input,'manifest.json'),'utf8')) as Manifest
  if (manifest.format!=='lifeflow-clean-poi' || manifest.version!==1) throw new Error('Unsupported POI dataset format')
  for (const name of files) if (await digest(join(input,name))!==manifest.sha256[name]) throw new Error(`POI dataset checksum mismatch: ${name}`)
  const collection=JSON.parse(await readFile(join(input,'pois.geojson'),'utf8'))
  if (collection.type!=='FeatureCollection' || collection.features.length!==manifest.counts['pois.geojson']) throw new Error('Invalid POI feature count')
  const db=await pool.connect()
  try {
    await db.query('BEGIN')
    await db.query('SELECT pg_advisory_xact_lock(1042026,11)')
    await db.query('LOCK TABLE catalog.places,catalog.place_sources,catalog.poi_aliases IN SHARE ROW EXCLUSIVE MODE')
    const run=(await db.query(`INSERT INTO geo.import_runs(source_type,source_path,status,source_checksum)
      VALUES('clean_poi_dataset',$1,'running',$2) RETURNING id`,[input,manifest.sha256['pois.geojson']])).rows[0].id
    const categories=JSON.parse(await readFile(join(input,'categories.json'),'utf8'))
    for (const c of categories) await db.query(`INSERT INTO catalog.place_categories(slug,name,parent_slug,attributes)
      VALUES($1,$2,$3,$4) ON CONFLICT(slug) DO NOTHING`,[c.slug,c.name,c.parent_slug,c.attributes])
    const seen=new Set<string>()
    for (const f of collection.features) {
      const p=f.properties, point=f.geometry?.coordinates
      if (!p || f.id!==p.canonical_id || seen.has(f.id) || f.geometry.type!=='Point'
        || !point || point.length!==2 || !point.every(Number.isFinite)
        || Math.abs(point[0])>180 || Math.abs(point[1])>90 || p.attributes?.entity_role==='housing_anchor') {
        throw new Error('Invalid or duplicate canonical POI feature')
      }
      seen.add(f.id)
      const protectedRow=await db.query(`SELECT id FROM catalog.places p WHERE p.id=$1 AND
        (p.attributes->>'entity_role'='housing_anchor' OR EXISTS(SELECT 1 FROM housing.properties hp WHERE hp.place_id=p.id)
          OR EXISTS(SELECT 1 FROM catalog.poi_aliases a WHERE a.alias_place_id=p.id))`,[f.id])
      if (protectedRow.rowCount) throw new Error('Dataset ID conflicts with housing or a legacy ID')
      await db.query(`INSERT INTO catalog.places(id,category_id,name,geom,address,phone,website,opening_hours,
        verification_status,verified_at,verified_by,attributes)
        SELECT $1,id,$2,ST_SetSRID(ST_MakePoint($3,$4),4326),$5,$6,$7,$8,$9,$10,$11,$12
        FROM catalog.place_categories WHERE slug=$13
        ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,geom=EXCLUDED.geom,address=EXCLUDED.address,
          phone=EXCLUDED.phone,website=EXCLUDED.website,opening_hours=EXCLUDED.opening_hours,
          attributes=EXCLUDED.attributes,category_id=EXCLUDED.category_id
        WHERE catalog.places.verification_status<>'lifeflow_verified'`,
      [f.id,p.name,point[0],point[1],p.address,p.phone,p.website,p.opening_hours,
        p.verification_status,p.verified_at,p.verified_by,p.attributes,p.category])
    }
    let sourceCount=0,aliasCount=0
    for await (const line of createInterface({input:createReadStream(join(input,'poi-sources.ndjson')),crlfDelay:Infinity})) {
      if (!line.trim()) continue
      const s=JSON.parse(line)
      if (!seen.has(s.place_id)) throw new Error('Source points outside the canonical dataset')
      const conflict=await db.query('SELECT place_id FROM catalog.place_sources WHERE source_type=$1 AND source_id=$2 AND place_id<>$3',[s.source_type,s.source_id,s.place_id])
      if (conflict.rowCount) throw new Error('Source identity already belongs to another POI; clean the target first')
      await db.query(`INSERT INTO catalog.place_sources(id,place_id,import_run_id,source_type,source_id,source_url,source_payload,observed_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(source_type,source_id) DO UPDATE SET
        source_url=EXCLUDED.source_url,source_payload=EXCLUDED.source_payload,observed_at=EXCLUDED.observed_at`,
      [s.id,s.place_id,run,s.source_type,s.source_id,s.source_url,s.source_payload,s.observed_at]);sourceCount++
    }
    for await (const line of createInterface({input:createReadStream(join(input,'legacy-ids.ndjson')),crlfDelay:Infinity})) {
      if (!line.trim()) continue
      const a=JSON.parse(line)
      if (!seen.has(a.canonical_place_id) || seen.has(a.alias_place_id)) throw new Error('Invalid legacy ID mapping')
      if ((await db.query('SELECT id FROM catalog.places WHERE id=$1',[a.alias_place_id])).rowCount) throw new Error('Legacy ID is still a physical POI')
      await db.query(`INSERT INTO catalog.poi_aliases(alias_place_id,canonical_place_id,run_id,osm_identity,reason,legacy_name,legacy_geom)
        VALUES($1,$2,$3,$4,'same_osm_identity',$5,ST_SetSRID(ST_GeomFromGeoJSON($6),4326))
        ON CONFLICT(alias_place_id) DO UPDATE SET canonical_place_id=EXCLUDED.canonical_place_id`,
      [a.alias_place_id,a.canonical_place_id,run,a.osm_identity,a.legacy_name,JSON.stringify(a.legacy_location)]);aliasCount++
    }
    if (sourceCount!==manifest.counts['poi-sources.ndjson'] || aliasCount!==manifest.counts['legacy-ids.ndjson']) throw new Error('POI sidecar count mismatch')
    await db.query(`UPDATE geo.import_runs SET status='completed',completed_at=now(),input_count=$2,
      accepted_count=$2,published_count=$2,diagnostics=$3 WHERE id=$1`,[run,seen.size,JSON.stringify({sources:sourceCount,aliases:aliasCount})])
    await db.query('COMMIT')
    return {run_id:run,pois:seen.size,sources:sourceCount,aliases:aliasCount}
  } catch(error) { await db.query('ROLLBACK'); throw error }
  finally { db.release() }
}
