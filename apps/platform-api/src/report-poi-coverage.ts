import { reportRoot } from './runtime-paths.js'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createDatabasePool, getRuntimeConfig } from '@relohome/housing-query'

const reportPath = resolve(reportRoot, 'poi-coverage-v2.json')
const pool = createDatabasePool(getRuntimeConfig().databaseUrl, 2)

async function main() {
  const latestRun = await pool.query(
    `SELECT id, source_path, source_checksum, source_version, status, started_at, completed_at,
            input_count, staged_count, accepted_count, rejected_count, duplicate_count,
            published_count, unchanged_count, diagnostics
     FROM geo.import_runs WHERE source_type = 'osm' AND source_version IS NOT NULL
     ORDER BY started_at DESC LIMIT 1`,
  )
  const totals = await pool.query(
    `SELECT count(*)::integer AS canonical_total,
            count(*) FILTER (WHERE status = 'active' AND deleted_at IS NULL)::integer AS active_total
     FROM catalog.places`,
  )
  const coverage = await pool.query(
    `WITH cities(city, west, south, east, north) AS (
       VALUES
         ('hcm', 106.34, 10.34, 107.05, 11.2),
         ('hanoi', 105.28, 20.55, 106.04, 21.4),
         ('danang', 107.78, 15.88, 108.42, 16.3)
     )
     SELECT cities.city, c.slug AS category,
       count(*)::integer AS total,
       count(*) FILTER (WHERE nullif(btrim(p.name), '') IS NOT NULL)::integer AS with_name,
       count(*) FILTER (WHERE p.address <> '{}'::jsonb)::integer AS with_address,
       count(*) FILTER (WHERE nullif(btrim(p.phone), '') IS NOT NULL)::integer AS with_phone,
       count(*) FILTER (WHERE nullif(btrim(p.website), '') IS NOT NULL)::integer AS with_website,
       count(*) FILTER (WHERE nullif(btrim(p.opening_hours), '') IS NOT NULL)::integer AS with_opening_hours
     FROM cities
     JOIN catalog.places p ON p.status = 'active' AND p.deleted_at IS NULL
       AND ST_Intersects(p.geom, ST_MakeEnvelope(cities.west, cities.south, cities.east, cities.north, 4326))
     JOIN catalog.place_categories c ON c.id = p.category_id
     GROUP BY cities.city, c.slug
     ORDER BY cities.city, c.slug`,
  )
  const staging = latestRun.rowCount
    ? await pool.query(
        `SELECT validation_status, publish_action, count(*)::integer AS total
         FROM geo.poi_staging WHERE import_run_id = $1
         GROUP BY validation_status, publish_action ORDER BY validation_status, publish_action`,
        [latestRun.rows[0].id],
      )
    : { rows: [] }

  const report = {
    generated_at: new Date().toISOString(),
    city_scope: 'Map city bounding boxes, not administrative boundaries',
    latest_import: latestRun.rows[0] || null,
    staging: staging.rows,
    canonical: totals.rows[0],
    coverage: coverage.rows,
  }
  await mkdir(reportRoot, { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  process.stdout.write(`POI coverage report: ${reportPath}\n`)
  process.stdout.write(`Canonical places: ${totals.rows[0].canonical_total}\n`)
  process.stdout.write(`City/category rows: ${coverage.rowCount}\n`)
}

try {
  await main()
} finally {
  await pool.end()
}
