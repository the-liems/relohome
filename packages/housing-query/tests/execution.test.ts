import { describe, expect, it, vi } from 'vitest'
import { withinOperation, operationContext } from '../src/execution.js'
import { boundedQueries, type DatabasePool } from '../src/database.js'

describe('request budgets', () => {
  it('cancels before starting work', async () => {
    const task = vi.fn()
    await expect(withinOperation(task, AbortSignal.abort())).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(task).not.toHaveBeenCalled()
  })
  it('shares a deadline across nested work and aborts pending dependencies', async () => {
    let signal: AbortSignal | undefined
    await expect(withinOperation(async () => {
      const context = operationContext()
      return withinOperation(async () => {
        expect(operationContext()).toBe(context)
        signal = context?.signal
        return new Promise(() => {})
      })
    }, undefined, 15)).rejects.toMatchObject({ code: 'TIMEOUT' })
    expect(signal?.aborted).toBe(true)
  })
  it('rolls back and releases a timed-out query', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === 'SELECT slow') throw Object.assign(new Error('canceling statement'), { code: '57014' })
      return { rows: [] }
    })
    const release = vi.fn()
    const pool = { connect: vi.fn(async () => ({ query, release })) } as unknown as DatabasePool
    await expect(boundedQueries(pool).query('SELECT slow')).rejects.toMatchObject({ code: 'TIMEOUT' })
    expect(query).toHaveBeenCalledWith("SELECT set_config('statement_timeout', $1, true)", ['8000'])
    expect(query).toHaveBeenCalledWith('ROLLBACK')
    expect(release).toHaveBeenCalledTimes(1)
  })
})
