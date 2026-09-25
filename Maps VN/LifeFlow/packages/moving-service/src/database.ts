import pg from 'pg'

const { Pool } = pg

export function createMovingDatabasePool(connectionString: string, max = 10) {
  return new Pool({ connectionString, max, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 30_000 })
}

export type MovingDatabasePool = pg.Pool
export type QueryExecutor = Pick<pg.Pool, 'query'>
