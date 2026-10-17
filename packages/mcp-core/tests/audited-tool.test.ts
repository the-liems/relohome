import { afterEach, describe, expect, it, vi } from 'vitest'
import { auditedTool, logger, type ToolErrorShape } from '../src/index.js'

const db = { query: vi.fn(async () => undefined) }
const classify = (error: unknown): ToolErrorShape => error instanceof RangeError
  ? { code: 'VALIDATION_ERROR', message: 'Pickup is outside the service area.', retryable: false }
  : { code: 'INTERNAL_ERROR', message: 'Unexpected moving service error.', retryable: false }

describe('auditedTool failure logging', () => {
  afterEach(() => vi.restoreAllMocks())

  it('keeps the error and stack for unclassified failures', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined)
    const crash = new TypeError('quote.total is undefined')
    const result = await auditedTool(db, 'estimate_move', async () => { throw crash }, classify)({})
    expect(result).toMatchObject({ isError: true })
    expect(error).toHaveBeenCalledWith({ err: crash, tool: 'estimate_move', code: 'INTERNAL_ERROR' }, 'mcp_tool_failed')
  })

  it('logs classified failures by code without their caller-facing message', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined)
    await auditedTool(db, 'estimate_move', async () => { throw new RangeError('rider at 12 Private Street') }, classify)({})
    expect(warn).toHaveBeenCalledWith({ tool: 'estimate_move', code: 'VALIDATION_ERROR' }, 'mcp_tool_failed')
    expect(error).not.toHaveBeenCalled()
  })

  it('logs audit write failures instead of dropping them', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined)
    const outage = new Error('connection terminated')
    const failingDb = { query: vi.fn(async () => { throw outage }) }
    await auditedTool(failingDb, 'list_moving_services', async () => ({ services: [] }), classify)({})
    expect(error).toHaveBeenCalledWith({ err: outage, tool: 'list_moving_services' }, 'mcp_audit_write_failed')
  })
})
