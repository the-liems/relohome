import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDatabasePool, getRuntimeConfig } from '@lifeflow/housing-query'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
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

  const files = (await readdir(migrationDirectory))
    .filter((file) => /^\d+.*\.sql$/.test(file))
    .sort()

  for (const file of files) {
    const sql = await readFile(resolve(migrationDirectory, file), 'utf8')
    const checksum = createHash('sha256').update(sql).digest('hex')
    const existing = await pool.query(
      'SELECT checksum FROM public.lifeflow_schema_migrations WHERE name = $1',
      [file],
    )
    if (existing.rowCount) {
      if (existing.rows[0].checksum !== checksum) {
        throw new Error(`Migration checksum changed after apply: ${file}`)
      }
      process.stderr.write(`Migration already applied: ${file}\n`)
      continue
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query(
        'INSERT INTO public.lifeflow_schema_migrations (name, checksum) VALUES ($1, $2)',
        [file, checksum],
      )
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

  await pool.query(`GRANT CONNECT ON DATABASE ${roleIdentifier(process.env.POSTGRES_DB || 'lifeflow')} TO ${app}, ${ingest}`)
  await pool.query(`GRANT USAGE ON SCHEMA geo, catalog, housing, audit TO ${app}`)
  await pool.query(`GRANT SELECT ON ALL TABLES IN SCHEMA geo, catalog, housing TO ${app}`)
  await pool.query(`GRANT INSERT ON audit.tool_calls TO ${app}`)
  await pool.query(`GRANT USAGE ON SCHEMA geo, catalog, housing, integration TO ${ingest}`)
  await pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA geo, catalog, housing, integration TO ${ingest}`)
  await pool.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA geo, catalog, housing, integration TO ${ingest}`)

  await pool.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA geo, catalog, housing GRANT SELECT ON TABLES TO ${app}`)
  await pool.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA audit GRANT INSERT ON TABLES TO ${app}`)
  await pool.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA geo, catalog, housing, integration GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${ingest}`)
  await pool.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA geo, catalog, housing, integration GRANT USAGE, SELECT ON SEQUENCES TO ${ingest}`)
}

try {
  await applyMigrations()
  await applyRoleGrants()
  process.stderr.write('Database migrations and grants completed.\n')
} finally {
  await pool.end()
}
