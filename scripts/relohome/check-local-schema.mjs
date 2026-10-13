/** Read-only compatibility check. Never migrates, cleans or imports data. */
import { createDatabasePool, getApplicationRuntimeConfig } from '@relohome/housing-query'

if (Number(process.versions.node.split('.')[0]) < 24) {
  console.error('Node.js 24+ is required by ReloHome.')
  process.exit(1)
}

let pool
try {
  pool = createDatabasePool(getApplicationRuntimeConfig().databaseUrl, 1)
  const required = [
    ['housing.listings', 'id'],
    ['housing.properties','location_confirmed_at'],
    ['housing.units','revision'],
    ['housing.managed_listings','approved_revision'],
    ['housing.listing_media','storage_key'],
    ['housing.managed_listing_visibility','is_public'],
    ['housing.listing_reviews','reviewed_revision'],
    ['catalog.places', 'id'],
    ['catalog.poi_aliases', 'canonical_place_id'],
    ['catalog.poi_aliases', 'legacy_name'],
    ['catalog.poi_aliases', 'legacy_geom'],
  ]
  const missing = []
  for (const [table, column] of required) {
    const found = await pool.query(`SELECT EXISTS(
      SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass($1)
        AND attname=$2 AND NOT attisdropped) AS present`, [table, column])
    if (!found.rows[0].present) missing.push(`${table}.${column}`)
  }
  if (missing.length) {
    console.error('Database schema is older than this checkout: ' + missing.join(', '))
    console.error('Run from the repository root: .venv/Scripts/python.exe scripts/local-integration.py migrate')
    process.exitCode = 1
  } else {
    console.log('Database reachable; Housing/Location schema (through 023) is compatible. No data changed.')
  }
} catch {
  // Never print a connection URL, environment or database exception containing credentials.
  console.error('Database compatibility check failed. Check Docker, .env.local and the database role.')
  process.exitCode = 1
} finally {
  await pool?.end()
}
