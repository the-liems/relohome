import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createMovingDatabasePool } from './database.js'

const checkoutDatabase = new URL('../../../deploy/database/', import.meta.url)
const database = existsSync(checkoutDatabase) ? checkoutDatabase : new URL('../../../database/', import.meta.url)

const url = process.env.MOVING_DATABASE_ADMIN_URL
if (!url) throw new Error('MOVING_DATABASE_ADMIN_URL is required for the one-off migration process.')
const role = process.env.MOVING_DB_APP_USER || 'moving_app'
const password = process.env.MOVING_DB_APP_PASSWORD
if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role) || !password || password.length < 16) {
  throw new Error('Set MOVING_DB_APP_USER and a MOVING_DB_APP_PASSWORD of at least 16 characters.')
}
const adminUser = decodeURIComponent(new URL(url).username)
if (role === adminUser) throw new Error('The runtime role must differ from the migration administrator.')
const pool = createMovingDatabasePool(url, 1)
const client = await pool.connect()
try {
  // Serialize all Moving deploy migrations using a dedicated session lock.
  await client.query("SELECT pg_advisory_lock(hashtext('lifeflow-moving-migrations'))")
  await client.query('BEGIN')
  await client.query(`CREATE SCHEMA IF NOT EXISTS moving;
    CREATE TABLE IF NOT EXISTS moving.schema_migrations (
      name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    )`)
  const files = ['moving/001_audit.sql', 'migrations/008_moving_service.sql']
  for (const name of files) {
    const sql = (await readFile(new URL(name, database), 'utf8')).replaceAll('\r\n', '\n')
    const checksum = createHash('sha256').update(sql).digest('hex')
    const existing = await client.query('SELECT checksum FROM moving.schema_migrations WHERE name=$1', [name])
    if (existing.rowCount) {
      if (existing.rows[0].checksum !== checksum) throw new Error(`Migration checksum mismatch: ${name}`)
      continue
    }
    await client.query(sql)
    await client.query('INSERT INTO moving.schema_migrations(name, checksum) VALUES ($1,$2)', [name, checksum])
    console.error(`Applied Moving migration: ${name}`)
  }
  const identifier = `"${role}"`
  const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])
  if (!exists.rowCount) await client.query(`CREATE ROLE ${identifier} LOGIN`)
  await client.query(`ALTER ROLE ${identifier} PASSWORD '${password.replaceAll("'", "''")}'`)
  await client.query(`GRANT USAGE ON SCHEMA moving, audit TO ${identifier}`)
  // Explicit table list: runtime cannot modify migration history.
  await client.query(`GRANT SELECT, INSERT, UPDATE ON
    moving.quotes, moving.approvals, moving.order_actions, moving.orders, moving.webhook_events TO ${identifier}`)
  await client.query(`GRANT INSERT ON audit.tool_calls TO ${identifier}`)
  await client.query('COMMIT')
  console.error('Moving migrations and runtime grants completed.')
} catch (error) {
  await client.query('ROLLBACK')
  // Do not include PostgreSQL details or connection strings in deploy logs.
  console.error('Moving migration failed; transaction rolled back. Check configuration and migration checksums.')
  process.exitCode = 1
} finally {
  await client.query("SELECT pg_advisory_unlock(hashtext('lifeflow-moving-migrations'))")
  client.release()
  await pool.end()
}
