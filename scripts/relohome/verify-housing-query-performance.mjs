// Read-only parity and EXPLAIN audit. Run after build/migrate against a populated
// local/staging snapshot. Never prints connection strings or changes DB settings.
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { HousingQueryService, createDatabasePool, getRuntimeConfig } from '../../packages/housing-query/dist/index.js'

const root = fileURLToPath(new URL('../..', import.meta.url))
const reference = process.argv[2] || '9b2b2db'
if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(reference)) throw new Error('Invalid reference revision')
const require = createRequire(resolve(root, 'package.json')), ts = require('typescript')
const cache = resolve(root, 'node_modules/.cache/housing-performance', String(Date.now()))
mkdirSync(cache, { recursive: true })
cpSync(resolve(root, 'packages/housing-query/dist'), cache, { recursive: true })
writeFileSync(resolve(cache, 'package.json'), '{"type":"module"}')
const currentPath = 'packages/housing-query/src/housing-service.ts'
const sourcePath = spawnSync('git', ['cat-file', '-e', `${reference}:${currentPath}`], { cwd: root }).status === 0 ? currentPath : `Maps VN/LifeFlow/${currentPath}`
const original = execFileSync('git', ['show', `${reference}:${sourcePath}`], { cwd: root, encoding: 'utf8' })
writeFileSync(resolve(cache, 'housing-service.js'), ts.transpileModule(original.replaceAll('@lifeflow/', '@relohome/'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText)
const { HousingQueryService: ReferenceService } = await import(pathToFileURL(resolve(cache, 'housing-service.js')))
const config = getRuntimeConfig(), pool = createDatabasePool(config.databaseUrl, 1), db = await pool.connect()
const bbox = { west: 106.69, south: 10.77, east: 106.71, north: 10.79 }
const city = { west: 106.34, south: 10.34, east: 107.05, north: 11.2 }
const radius = { center: { lat: 10.78, lng: 106.7 }, radius_m: 2000 }
const queries = [{ bounding_box: bbox }, { bounding_box: city }, radius,
  { text: 'phòng trọ quận 1' }, { text: 'phòng' }, { district: 'Quận 1' },
  { bounding_box: bbox, max_price: { amount: 5000000, currency: 'VND', period: 'month' } },
  { bounding_box: bbox, min_area_m2: 20 }, { bounding_box: bbox, min_bedrooms: 1 },
  { bounding_box: bbox, amenities: ['parking'] }, { bounding_box: bbox, source_filters: ['partner'] },
  { bounding_box: bbox, verification_requirement: 'verified_only' },
  { bounding_box: bbox, availability_from: '2026-11-01', availability_to: '2026-12-01' },
  ...['price_amount', 'area_m2', 'bedrooms', 'created_at', 'verified_at'].flatMap(field =>
    ['asc', 'desc'].map(direction => ({ bounding_box: bbox, sort: [{ field, direction }] }))),
  { ...radius, sort: [{ field: 'distance_meters', direction: 'desc' }] },
]
const canonical = value => JSON.stringify(value, (_key, v) => typeof v === 'number' ? Math.round(v * 1e8) / 1e8 : v)
let comparisons = 0
const differences = [], measurements = []
try {
  await db.query('BEGIN READ ONLY')
  await db.query("SET LOCAL statement_timeout='20s'")
  const old = new ReferenceService(db, {}, config), fresh = new HousingQueryService(db, {}, config)
  for (const [index, input] of queries.entries()) {
    let cursor = null
    for (let page = 0; page < 2; page++) {
      const query = { ...input, pagination: { limit: 20, cursor } }
      const a = await old.search(query), b = await fresh.search(query)
      delete a.query_id; delete b.query_id
      if (canonical(a) !== canonical(b)) differences.push({ index, page, method: 'search' })
      comparisons++; cursor = a.page.next_cursor
      if (!cursor) break
    }
    if (input.bounding_box && !input.sort) for (const zoom of [11, 15]) {
      if (canonical(await old.map({ ...input, zoom })) !== canonical(await fresh.map({ ...input, zoom })))
        differences.push({ index, zoom, method: 'map' })
      comparisons++
    }
  }
  const benchmarks = [
    ['map-city', 'map', { bounding_box: city, zoom: 11 }],
    ['map-markers', 'map', { bounding_box: bbox, zoom: 15 }],
    ['search-bbox', 'search', { bounding_box: bbox }],
    ['search-text', 'search', { text: 'phòng trọ quận 1' }],
    ['search-radius', 'search', radius],
    ['search-district', 'search', { district: 'Quận 1' }],
    ['search-district-polygon', 'search', { district: 'Phường Tân Hưng' }],
  ]
  for (const [label, method, input] of benchmarks) {
    const statements = []
    for (const [name, Service] of [['reference', ReferenceService], ['current', HousingQueryService]]) {
      await new Service({ async query(text, values) { statements.push({ name, text, values }); return { rows: [] } } }, {}, config)[method](input)
    }
    const samples = []
    for (let iteration = 0; iteration < 3; iteration++) for (const query of iteration % 2 ? [...statements].reverse() : statements) {
      const data = (await db.query(`EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) ${query.text}`, query.values)).rows[0]['QUERY PLAN'][0]
      const plan = data.Plan
      samples.push({ variant: query.name, ms: data['Execution Time'],
        logicalMiB: ((plan['Shared Hit Blocks'] || 0) + (plan['Shared Read Blocks'] || 0)) / 128,
        readMiB: (plan['Shared Read Blocks'] || 0) / 128, tempBlocks: plan['Temp Written Blocks'] || 0 })
    }
    measurements.push({ label, samples })
  }
  console.log(JSON.stringify({ reference, cases: queries.length, comparisons, differences, measurements }, null, 2))
  if (differences.length) process.exitCode = 1
} finally { await db.query('ROLLBACK'); db.release(); await pool.end() }
