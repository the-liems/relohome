/** Actual SDK/HTTP envelopes with fixture service/DB; never contacts AhaMove or Postgres. */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { MovingServiceError, type MovingDatabasePool, type MovingService } from '@relohome/moving-service'
import { expect, it, vi } from 'vitest'
import { buildMovingHttpServer } from '../src/http-app.js'

it('distinguishes SDK input/output failures from structured provider errors over HTTP', async () => {
  const estimate = vi.fn()
  const audit = vi.fn(async () => ({ rows: [] }))
  const app = buildMovingHttpServer({
    db: { query: audit, end: async () => {} } as unknown as MovingDatabasePool,
    movingService: { estimate } as unknown as MovingService,
    environment: 'staging',
  }, {
    token: 'offline-diagnostic-fixture-token-0123456789',
    allowedHosts: ['127.0.0.1'], allowedOrigins: [], release: 'offline-fixture',
  })
  const client = new Client({ name: 'offline-validation-fixture', version: '1.0.0' })
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve))
  const address = app.server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture server address')
  const statuses: number[] = []
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), {
      requestInit: { headers: { Authorization: 'Bearer offline-diagnostic-fixture-token-0123456789' } },
      fetch: async (input, init) => {
        const response = await fetch(input, init)
        statuses.push(response.status)
        return response
      },
    }))
    const point = {
      address: 'Fixture address', coordinate: { lat: 21, lng: 105.8 },
      name: 'Fixture contact', mobile: '19001234',
    }
    const draft = { pickup: point, destinations: [point], payment_method: 'CASH', order_time: 0 }
    const services = [{ service_id: 'HAN-VAN-1000' }]
    const invalidInput = await client.callTool({ name: 'estimate_move', arguments: { draft, services } })
    expect(invalidInput.isError).toBe(true)
    expect(JSON.stringify(invalidInput.content)).toContain('Input validation error:')
    expect(JSON.stringify(invalidInput.content)).toContain('draft.pickup.mobile:')
    expect(JSON.stringify(invalidInput.content)).toContain('draft.destinations.0.mobile:')
    expect(estimate).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
    expect(statuses.at(-1)).toBe(200)

    point.mobile = '0900000000' // Explicitly fictitious and schema-valid, never sent to a provider.
    estimate.mockRejectedValueOnce(new MovingServiceError('PROVIDER_REJECTED', 'Fixture rejection'))
    const rejected = await client.callTool({ name: 'estimate_move', arguments: { draft, services } })
    expect(rejected.isError).toBe(true)
    expect(JSON.stringify(rejected.content)).toContain('PROVIDER_REJECTED')
    expect(estimate).toHaveBeenCalledTimes(1)
    expect(statuses.at(-1)).toBe(200)

    estimate.mockResolvedValueOnce({}) // Deliberately violates MoveQuoteSchema after handler completion.
    const invalidOutput = await client.callTool({ name: 'estimate_move', arguments: { draft, services } })
    expect(invalidOutput.isError).toBe(true)
    expect(JSON.stringify(invalidOutput.content)).toContain('Output validation error:')
    expect(estimate).toHaveBeenCalledTimes(2)
    expect(statuses.at(-1)).toBe(200)
  } finally {
    await client.close()
    await app.close()
  }
})
