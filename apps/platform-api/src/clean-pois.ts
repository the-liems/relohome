import { resourceRoot as root } from './runtime-paths.js'
/** Physical POI cleanup/export. Existing housing is checked and never rewritten. */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { applyPoiDedup, createDatabasePool, getRuntimeConfig, previewPoiDedup } from '@relohome/housing-query'
import { exportPoiDataset, importPoiDataset } from './poi-dataset.js'

const args=process.argv.slice(2)
function option(key:string) { const index=args.indexOf(key); return index<0 ? undefined : args[index+1] }
const apply=args.includes('--apply'), reportPath=option('--report'), expected=option('--expect-hash')
const output=option('--export'), input=option('--import-clean')
const allowed=new Set(['--apply','--install-schema','--report','--expect-hash','--export','--import-clean'])
for (let i=0;i<args.length;i++) {
  if (!allowed.has(args[i]!)) throw new Error('Unknown POI option. Physical rollback uses the database backup.')
  if (['--report','--expect-hash','--export','--import-clean'].includes(args[i]!)) {
    if (!args[i+1] || args[i+1]!.startsWith('--')) throw new Error('Missing POI option value')
    i++
  }
}
if (apply && (!expected || !/^[a-f0-9]{64}$/.test(expected) || !reportPath || input)) {
  throw new Error('Apply requires --report and the hash from the reviewed physical cleanup dry-run')
}
if (input && (output || reportPath)) throw new Error('Import-clean runs separately from export/dry-run')
const config=getRuntimeConfig(), pool=createDatabasePool(config.adminDatabaseUrl,1)
function role(value:string) {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error('Unsafe database role')
  return `"${value}"`
}
async function protectedData(db:{query:(sql:string)=>Promise<{rows:unknown[]}>}) {
  const result:Record<string,unknown>={}
  for (const table of ['properties','units','listings','offers','listing_media']) {
    result[table]=(await db.query(`SELECT count(*) count,
      md5(COALESCE(string_agg(md5(row_to_json(t)::text),'' ORDER BY id),'')) fingerprint FROM housing.${table} t`)).rows[0]
  }
  result.anchors=(await db.query(`SELECT count(*) count,
    md5(COALESCE(string_agg(md5(row_to_json(t)::text),'' ORDER BY id),'')) fingerprint FROM catalog.places t
    WHERE attributes->>'entity_role'='housing_anchor'`)).rows[0]
  result.housingStaging=(await db.query(`SELECT count(*) count,
    md5(COALESCE(string_agg(md5(row_to_json(t)::text),'' ORDER BY id),'')) fingerprint FROM integration.housing_staging t`)).rows[0]
  for (const [table,reference] of [['catalog.place_sources','place_id'],['catalog.place_media','place_id'],['integration.source_records','entity_id']] as const) {
    result[table]=(await db.query(`SELECT count(*) count,
      md5(COALESCE(string_agg(md5((to_jsonb(t)-'${reference}')::text),'' ORDER BY id),'')) fingerprint FROM ${table} t`)).rows[0]
  }
  return result
}
try {
  const db=await pool.connect()
  try {
    await db.query('BEGIN')
    await db.query("SET LOCAL lock_timeout='10s'")
    await db.query("SET LOCAL statement_timeout='180s'")
    await db.query('SELECT pg_advisory_xact_lock(1042026,11)')
    if (args.includes('--install-schema')) {
      for (const name of ['011_poi_canonical_identity.sql','012_poi_physical_cleanup.sql']) {
        const sql=(await readFile(resolve(root,'database/migrations',name),'utf8')).replace(/\r\n/g,'\n')
        const checksum=createHash('sha256').update(sql).digest('hex')
        const previous=await db.query('SELECT checksum FROM public.lifeflow_schema_migrations WHERE name=$1',[name])
        if (previous.rowCount && previous.rows[0].checksum!==checksum) throw new Error('POI migration checksum mismatch')
        if (!previous.rowCount) {
          await db.query(sql)
          await db.query('INSERT INTO public.lifeflow_schema_migrations(name,checksum) VALUES($1,$2)',[name,checksum])
        }
      }
      await db.query(`GRANT SELECT ON catalog.poi_aliases TO ${role(config.postgresAppUser)}`)
      await db.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON catalog.poi_aliases TO ${role(config.postgresIngestUser)}`)
    }
    if (input) { await db.query('COMMIT') }
    else {
      if (apply) await db.query(`LOCK TABLE catalog.places,catalog.place_sources,catalog.place_media,
        catalog.poi_aliases,geo.poi_staging,integration.source_records IN SHARE ROW EXCLUSIVE MODE`)
      const before=await protectedData(db), preview=await previewPoiDedup(db)
      const applied=apply ? await applyPoiDedup(db,expected!) : null
      const after=await protectedData(db)
      if (JSON.stringify(before)!==JSON.stringify(after)) throw new Error('Protected housing/source payload changed; rolling back POI cleanup')
      const report={measured_at:new Date().toISOString(),mode:apply?'physical-apply':'physical-dry-run',
        ...preview,applied,protected_housing:before,housing_unchanged:true}
      if (reportPath) {
        await mkdir(dirname(resolve(reportPath)),{recursive:true})
        await writeFile(resolve(reportPath),JSON.stringify(report,null,2)+'\n','utf8')
      }
      await db.query('COMMIT')
      console.log(JSON.stringify({mode:report.mode,duplicate_groups:preview.duplicate_groups,
        rows_to_delete:preview.aliases.length,review_groups:preview.review.length,
        manifest_hash:preview.manifest_hash,...applied,housing_unchanged:true}))
    }
  } catch(error) { await db.query('ROLLBACK'); throw error }
  finally { db.release() }
  if (input) console.log(JSON.stringify(await importPoiDataset(pool,input)))
  if (output) console.log(JSON.stringify(await exportPoiDataset(pool,output)))
} catch(error) {
  console.error(JSON.stringify({error:error instanceof Error && !('code' in error)?error.message:'POI database operation failed',
    code:(error as {code?:string}).code || null}))
  process.exitCode=1
} finally { await pool.end() }
