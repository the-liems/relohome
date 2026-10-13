import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { createMovingDatabasePool, type MovingService } from '@relohome/moving-service'
import { expect, it } from 'vitest'
import { buildMovingHttpServer } from '../src/http-app.js'

it('uses the shared auth errors and retains read/write tool access without provider calls', async () => {
  const token = 'moving-auth-test-token-0123456789'
  const writeToken = `${token}-write`
  const movingService = new Proxy({} as MovingService, {
    get() { throw new Error('Authentication tests must not call the provider') },
  })
  const app = buildMovingHttpServer({
    db: createMovingDatabasePool('postgresql://unused:unused@127.0.0.1:1/unused'),
    movingService, environment: 'staging',
  }, { token, writeToken, allowedHosts: ['127.0.0.1'], allowedOrigins: [], release: 'auth-test' })
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve))
  const address = app.server.address()
  if (!address || typeof address === 'string') throw new Error('Missing test address')
  const url = new URL(`http://127.0.0.1:${address.port}/mcp`)
  try {
    const response = await fetch(url)
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ status: 'error', code: 'UNAUTHORIZED' })
    expect(response.headers.get('www-authenticate')).toBe('Bearer')
    expect(response.headers.get('cache-control')).toBe('no-store')
    for (const [credential, canWrite] of [[token, false], [writeToken, true]] as const) {
      const client = new Client({ name: 'auth-test', version: '1.0.0' })
      try {
        await client.connect(new StreamableHTTPClientTransport(url, {
          requestInit: { headers: { Authorization: `Bearer ${credential}` } },
        }))
        const { tools } = await client.listTools()
        expect(tools.some(tool => tool.name === 'create_move_order')).toBe(canWrite)
        expect(tools.some(tool => tool.name === 'list_service_areas')).toBe(true)
      } finally { await client.close() }
    }
  } finally { await app.close() }
})
