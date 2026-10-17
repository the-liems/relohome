import { resourceRoot as root } from './runtime-paths.js'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createDatabasePool, getRuntimeConfig } from '@relohome/housing-query'

const migrationDirectory = resolve(root, 'database/migrations')
const config = getRuntimeConfig()
const pool = createDatabasePool(config.adminDatabaseUrl, 2)

function roleIdentifier(value: string) {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error(`Unsafe PostgreSQL role name: ${value}`)
  return `"${value}"`
}

function sqlLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`
}

async function ensureLoginRole(role: string, password: string) {
  const identifier = roleIdentifier(role)
  const exists = await pool.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role])
  if (!exists.rowCount) await pool.query(`CREATE ROLE ${identifier} LOGIN`)
  await pool.query(`ALTER ROLE ${identifier} PASSWORD ${sqlLiteral(password)}`)
}

async function applyMigrations() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.lifeflow_schema_migrations (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)

  const files = (await readdir(migrationDirectory)).filter(file => /^\d+.*\.sql$/.test(file)).sort()

  for (const file of files) {
    const sql = await readFile(resolve(migrationDirectory, file), 'utf8')
    // Git on Windows may check out CRLF while the Linux snapshot stored LF.
    // Compare only newline encodings, never ignore substantive SQL changes.
    const canonicalSql = sql.replace(/\r\n/g, '\n')
    const checksum = createHash('sha256').update(canonicalSql).digest('hex')
    const newlineChecksums = [checksum, createHash('sha256').update(canonicalSql.replace(/\n/g, '\r\n')).digest('hex')]
    const existing = await pool.query('SELECT checksum FROM public.lifeflow_schema_migrations WHERE name = $1', [file])
    if (existing.rowCount) {
      if (!newlineChecksums.includes(existing.rows[0].checksum)) {
        throw new Error(`Migration checksum changed after apply: ${file}`)
      }
      process.stderr.write(`Migration already applied: ${file}\n`)
      continue
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query('INSERT INTO public.lifeflow_schema_migrations (name, checksum) VALUES ($1, $2)', [
        file,
        checksum,
      ])
      await client.query('COMMIT')
      process.stderr.write(`Applied migration: ${file}\n`)
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
}

async function applyRoleGrants() {
  await ensureLoginRole(config.postgresAppUser, config.postgresAppPassword)
  await ensureLoginRole(config.postgresIngestUser, config.postgresIngestPassword)
  const app = roleIdentifier(config.postgresAppUser)
  const ingest = roleIdentifier(config.postgresIngestUser)

  await pool.query(
    `GRANT CONNECT ON DATABASE ${roleIdentifier(process.env.POSTGRES_DB || 'lifeflow')} TO ${app}, ${ingest}`,
  )
  await pool.query(`GRANT USAGE ON SCHEMA geo, catalog, housing, audit, moving TO ${app}`)
  await pool.query(`GRANT SELECT ON ALL TABLES IN SCHEMA geo, catalog, housing TO ${app}`)
  await pool.query(`GRANT INSERT, UPDATE ON housing.properties, housing.units, housing.listings, housing.offers,
    housing.listing_media, housing.management_members, housing.managed_listings, housing.listing_fees,
    housing.contact_requests, housing.listing_events, housing.host_profiles, housing.contact_messages,
    housing.reviews, housing.review_reports, housing.host_flags,
    housing.contact_archives, housing.rent_payment_reports, housing.rent_periods, housing.property_documents, housing.activity_events, housing.activity_reads TO ${app}`)
  await pool.query(`GRANT INSERT ON housing.listing_reviews TO ${app}`)
  await pool.query(`GRANT INSERT ON catalog.places TO ${app}`)
  // Owners edit the name, address and pin of their property's place; other columns stay read-only.
  await pool.query(`GRANT UPDATE (name, address, geom, updated_at) ON catalog.places TO ${app}`)
  await pool.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA catalog, housing TO ${app}`)
  await pool.query(`GRANT INSERT ON audit.tool_calls TO ${app}`)
  await pool.query(`GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA moving TO ${app}`)
  await pool.query(`GRANT USAGE ON SCHEMA geo, catalog, housing, integration TO ${ingest}`)
  await pool.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA geo, catalog, housing, integration TO ${ingest}`,
  )
  await pool.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA geo, catalog, housing, integration TO ${ingest}`)

  await pool.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA geo, catalog, housing GRANT SELECT ON TABLES TO ${app}`)
  await pool.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA audit GRANT INSERT ON TABLES TO ${app}`)
  await pool.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA moving GRANT SELECT, INSERT, UPDATE ON TABLES TO ${app}`)
  await pool.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA geo, catalog, housing, integration GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${ingest}`,
  )
  await pool.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA geo, catalog, housing, integration GRANT USAGE, SELECT ON SEQUENCES TO ${ingest}`,
  )
}

const migrationLock = await pool.connect()
try {
  // Serialize release jobs against the same database; one checksum history is authoritative.
  await migrationLock.query("SELECT pg_advisory_lock(hashtext('relohome_schema_migrations')::bigint)")
  await applyMigrations()
  await applyRoleGrants()
  process.stderr.write('Database migrations and grants completed.\n')
} finally {
  await migrationLock.query("SELECT pg_advisory_unlock(hashtext('relohome_schema_migrations')::bigint)")
  migrationLock.release()
  await pool.end()
}
