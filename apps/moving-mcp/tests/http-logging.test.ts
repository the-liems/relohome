import { logger } from '@relohome/mcp-core'
import { createMovingDatabasePool, type MovingService } from '@relohome/moving-service'
import { afterEach, expect, it, vi } from 'vitest'
import { buildMovingHttpServer } from '../src/http-app.js'

afterEach(() => vi.restoreAllMocks())

it('logs MCP requests but not health probes', async () => {
  const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined)
  const app = buildMovingHttpServer({
    db: createMovingDatabasePool('postgresql://unused:unused@127.0.0.1:1/unused'),
    movingService: {} as MovingService, environment: 'staging',
  }, { token: 'moving-logging-test-token-0123456789', allowedHosts: ['127.0.0.1'], allowedOrigins: [],
    release: 'logging-test' })
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve))
  const address = app.server.address()
  if (!address || typeof address === 'string') throw new Error('Missing test address')
  try {
    await (await fetch(`http://127.0.0.1:${address.port}/health`)).text()
    await (await fetch(`http://127.0.0.1:${address.port}/mcp`)).text()
    await vi.waitFor(() => expect(info).toHaveBeenCalledTimes(1))
    expect(info).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET', path: '/mcp', status: 401,
      release: 'logging-test' }), 'moving_mcp_http')
  } finally { await app.close() }
})
