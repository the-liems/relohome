import pg from 'pg'

const { Pool } = pg

export function createMovingDatabasePool(connectionString: string, max = 10) {
  const pool = new Pool({ connectionString, max, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 30_000,
    statement_timeout: 5_000, query_timeout: 6_000 })
  pool.on('error', () => console.error(JSON.stringify({ event: 'moving_database_connection_error' })))
  return pool
}

/** Check the actual schema and permissions without creating rows or contacting AhaMove. */
export async function checkMovingReadiness(db: QueryExecutor) {
  await db.query(`SELECT id FROM moving.quotes LIMIT 0`)
  await db.query(`SELECT id FROM moving.approvals LIMIT 0`)
  await db.query(`SELECT idempotency_key FROM moving.order_actions LIMIT 0`)
  await db.query(`SELECT provider_order_id FROM moving.orders LIMIT 0`)
  await db.query(`SELECT event_hash FROM moving.webhook_events LIMIT 0`)
  // PostgreSQL interprets a comma-separated privilege list as ANY, not ALL.
  const result = await db.query<{ ready: boolean }>(`SELECT
    has_table_privilege(current_user, 'audit.tool_calls', 'INSERT') AND
    bool_and(has_table_privilege(current_user, t.name, p.name)) AS ready
    FROM (VALUES ('moving.quotes'), ('moving.approvals'), ('moving.order_actions'),
      ('moving.orders'), ('moving.webhook_events')) AS t(name)
    CROSS JOIN (VALUES ('INSERT'), ('UPDATE')) AS p(name)`)
  if (!result.rows[0]?.ready) throw new Error('Moving database permissions are incomplete.')
}

export type MovingDatabasePool = pg.Pool
export type QueryExecutor = Pick<pg.Pool, 'query'>
