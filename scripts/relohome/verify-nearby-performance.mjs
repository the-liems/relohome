// Read-only parity / round-trip audit against an explicitly selected local or staging DB.
// Build TypeScript first. Never prints coordinates, POI names, SQL parameters or credentials.
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'
import { isDeepStrictEqual } from 'node:util'
import { HousingQueryService, PlaceService, createDatabasePool, getRuntimeConfig } from '../../packages/housing-query/dist/index.js'

const root = fileURLToPath(new URL('../..', import.meta.url))
const reference = process.argv[2] || '91148e6'
if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(reference)) throw new Error('Invalid reference revision')
const require = createRequire(resolve(root, 'package.json')), ts = require('typescript')
mkdirSync(resolve(root, 'node_modules/.cache'), { recursive: true })
const cache = mkdtempSync(resolve(root, 'node_modules/.cache/nearby-performance-'))
cpSync(resolve(root, 'packages/housing-query/dist'), cache, { recursive: true })
writeFileSync(resolve(cache, 'package.json'), '{"type":"module"}')
for (const file of ['place-service', 'housing-service']) {
  const source = execFileSync('git', ['show', `${reference}:packages/housing-query/src/${file}.ts`], { cwd: root, encoding: 'utf8' })
  writeFileSync(resolve(cache, `${file}.js`), ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText)
}
const { PlaceService: ReferencePlaces } = await import(pathToFileURL(resolve(cache, 'place-service.js')))
const { HousingQueryService: ReferenceHousing } = await import(pathToFileURL(resolve(cache, 'housing-service.js')))
const config = getRuntimeConfig(), pool = createDatabasePool(config.databaseUrl, 1), db = await pool.connect()
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const walk = plan => [plan, ...(plan.Plans || []).flatMap(walk)]
const normalize = result => { const { query_id, ...rest } = result; return rest }
let comparisons = 0
const measurements = [], plans = []
try {
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
  await db.query("SET LOCAL statement_timeout='20s'")
  const cities = [
    ['hanoi', { west: 105.27, south: 20.7, east: 106.1, north: 21.6 }],
    ['hcm', { west: 106.34, south: 10.34, east: 107.05, north: 11.2 }],
    ['danang', { west: 107.8, south: 15.8, east: 108.4, north: 16.3 }],
  ]
  for (const [city, box] of cities) {
    const origins = (await db.query(`SELECT ST_X(geom) AS lng,ST_Y(geom) AS lat FROM housing.map_points
      WHERE ST_Intersects(geom,ST_MakeEnvelope($1,$2,$3,$4,4326)) ORDER BY id LIMIT 20`,
    [box.west, box.south, box.east, box.north])).rows
    if (!origins.length) throw new Error(`No housing origins for ${city}; use a populated snapshot`)
    for (const [scenario, constraints] of [
      ['one-category', [{ category: 'hospital', max_distance_m: 1_000 }]],
      ['two-categories', [{ category: 'hospital', max_distance_m: 1_000 }, { category: 'supermarket', max_distance_m: 1_000 }]],
      ['duplicate-and-missing', [{ category: 'hospital', max_distance_m: 10 }, { category: 'hospital', max_distance_m: 2_000 }, { category: 'not-a-category', max_distance_m: 1_000 }]],
    ]) {
      const records = { reference: [], current: [] }
      const counted = variant => ({ async query(text, values) {
        records[variant].push({ text, values }); return db.query(text, values)
      } })
      const old = new ReferencePlaces(counted('reference')), fresh = new PlaceService(counted('current'))
      const run = async variant => {
        const result = []
        // Match HousingQueryService's existing four-candidate concurrency / stop boundary.
        for (let start = 0; start < origins.length; start += 4) {
          const batch = origins.slice(start, start + 4)
          result.push(...(variant === 'reference'
            ? await Promise.all(batch.map(origin => old.findNearby(origin, constraints)))
            : await fresh.findNearbyBatch(batch, constraints)))
        }
        return result
      }
      const baseline = await run('reference'), current = await run('current')
      console.error(`Checked nearby parity ${city}/${scenario}`)
      if (!isDeepStrictEqual(baseline, current)) throw new Error(`Nearby parity failure: ${city}/${scenario}`)
      comparisons += origins.length
      const queryCounts = Object.fromEntries(Object.entries(records).map(([key, queries]) => [key, queries.length]))
      const statements = { reference: [...records.reference], current: [...records.current] }
      const samples = { reference: [], current: [] }
      for (let iteration = 0; iteration < 7; iteration++) {
        for (const variant of iteration % 2 ? ['current', 'reference'] : ['reference', 'current']) {
          const start = performance.now(); await run(variant); samples[variant].push(performance.now() - start)
        }
      }
      measurements.push({ city, scenario, origins: origins.length, queryCounts,
        medianMs: Object.fromEntries(Object.entries(samples).map(([key, times]) => [key, median(times)])) })
      console.error(`Measured nearby ${city}/${scenario}`)
      if (scenario === 'two-categories') for (const variant of ['reference', 'current']) {
        let executionMs = 0, sharedBlocks = 0, tempBlocks = 0
        const indexes = new Set()
        for (const query of statements[variant]) {
          const plan = (await db.query(`EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) ${query.text}`, query.values)).rows[0]['QUERY PLAN'][0]
          executionMs += plan['Execution Time']
          sharedBlocks += (plan.Plan['Shared Hit Blocks'] || 0) + (plan.Plan['Shared Read Blocks'] || 0)
          tempBlocks += plan.Plan['Temp Written Blocks'] || 0
          for (const node of walk(plan.Plan)) if (node['Index Name']) indexes.add(node['Index Name'])
        }
        plans.push({ city, variant, executionMs, sharedBlocks, tempBlocks, indexes: [...indexes].sort() })
      }
    }
    const old = new ReferenceHousing(db, {}, config), fresh = new HousingQueryService(db, {}, config)
    for (const nearby of [undefined, [{ category: 'hospital', max_distance_m: 2_000 }],
      [{ category: 'hospital', max_distance_m: 2_000 }, { category: 'supermarket', max_distance_m: 2_000 }]]) {
      for (const amenities of [undefined, ['air_conditioning']]) {
        let cursor = null
        for (let page = 0; page < 2; page++) {
          const input = { bounding_box: box, nearby, amenities, pagination: { limit: 20, cursor } }
          console.error(`Checking housing parity ${city}/${nearby?.length || 0} nearby/${amenities?.length || 0} amenities/page ${page}`)
          const a = normalize(await old.search(input)), b = normalize(await fresh.search(input))
          if (!isDeepStrictEqual(a, b)) throw new Error(`Housing parity failure: ${city}/${page}`)
          comparisons++; cursor = a.page.next_cursor
          if (!cursor) break
        }
      }
    }
  }
  console.log(JSON.stringify({ reference, comparisons, parity: 'passed', measurements, plans }, null, 2))
} finally { await db.query('ROLLBACK'); db.release(); await pool.end() }
