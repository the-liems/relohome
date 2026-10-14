import pg from 'pg'
import { trace } from '@opentelemetry/api'

const pool = new pg.Pool({ connectionString: process.env.ROOMMATE_TEST_DATABASE_URL, max: 1 })
try {
  await trace.getTracer('fixture').startActiveSpan('database.request', async span => {
    try {
      const result = await pool.query('SELECT $1::text AS value', ['SYNTHETIC_PRIVATE_PG_VALUE'])
      if (result.rows[0].value !== 'SYNTHETIC_PRIVATE_PG_VALUE') throw new Error('query result changed')
      try {
        await pool.query('SELECT * FROM SYNTHETIC_PRIVATE_MISSING_TABLE')
        throw new Error('missing table query unexpectedly succeeded')
      } catch (error) {
        if (error.code !== '42P01') throw error
      }
    } finally {
      span.end()
    }
  })
} finally {
  await pool.end()
}
