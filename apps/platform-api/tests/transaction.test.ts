import { describe, expect, it, vi } from 'vitest'
import type { DatabasePool } from '@relohome/housing-query'
import { withTransaction } from '../src/transaction.js'

function fakePool(failing: Record<string, Error> = {}) {
  const statements: string[] = []
  const client = {
    query: vi.fn(async (sql: string) => {
      statements.push(sql)
      if (failing[sql]) throw failing[sql]
      return { rows: [] }
    }),
    release: vi.fn(),
  }
  return { pool: { connect: async () => client } as unknown as DatabasePool, client, statements }
}

describe('withTransaction', () => {
  it('commits and returns the work result', async () => {
    const { pool, client, statements } = fakePool()
    await expect(withTransaction(pool, async db => { await db.query('UPDATE t'); return 7 })).resolves.toBe(7)
    expect(statements).toEqual(['BEGIN', 'UPDATE t', 'COMMIT'])
    expect(client.release).toHaveBeenCalledWith(undefined)
  })

  it('keeps the original error and destroys the client when ROLLBACK fails', async () => {
    const rollbackFailure = new Error('connection terminated')
    const { pool, client } = fakePool({ ROLLBACK: rollbackFailure })
    const failure = new Error('constraint violated')
    await expect(withTransaction(pool, async () => { throw failure })).rejects.toBe(failure)
    expect(client.release).toHaveBeenCalledWith(rollbackFailure)
  })
})
