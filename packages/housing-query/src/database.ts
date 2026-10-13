import pg from 'pg'
import { checkOperation, operationContext } from './execution.js'
import { OperationError } from './errors.js'

const { Pool } = pg

export function createDatabasePool(connectionString: string, max = 10) {
  return new Pool({
    connectionString,
    max,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  })
}

export type DatabasePool = pg.Pool
export type QueryExecutor = Pick<pg.Pool, 'query'>

/** App queries run with a server-side timeout; ingestion connections remain independently configurable. */
export function boundedQueries(pool: DatabasePool): QueryExecutor {
  const query = async (text: string, values?: unknown[]) => {
    checkOperation()
    const client = await pool.connect()
    try {
      checkOperation()
      const context = operationContext()
      const remaining = context ? context.deadline - Date.now() : 8_000
      if (remaining <= 0) throw new OperationError('TIMEOUT', 'Database deadline exceeded.')
      await client.query('BEGIN')
      await client.query("SELECT set_config('statement_timeout', $1, true)", [String(Math.max(1, Math.min(8_000, remaining)))])
      checkOperation()
      const result = await client.query(text, values)
      checkOperation()
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      if ((error as { code?: string }).code === '57014') throw new OperationError('TIMEOUT', 'Database query timed out.')
      throw error
    } finally { client.release() }
  }
  return { query: query as QueryExecutor['query'] }
}
