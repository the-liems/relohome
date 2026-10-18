import type { DatabasePool } from '@relohome/housing-query'
import type { PoolClient } from 'pg'

/**
 * Run work in one transaction on a dedicated client. If ROLLBACK itself fails, the original error
 * still propagates and the client is destroyed instead of returning to the pool
 * (https://node-postgres.com/apis/pool#releasing-clients).
 */
export async function withTransaction<T>(pool: DatabasePool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  let broken: Error | undefined
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch((rollbackError: Error) => {
      broken = rollbackError
    })
    throw error
  } finally {
    client.release(broken)
  }
}
