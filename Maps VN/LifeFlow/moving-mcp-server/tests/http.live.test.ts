import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { AhaMoveClient, createMovingDatabasePool, getMovingRuntimeConfig, loadMovingEnvironment,
  MovingRepository, MovingService } from '@lifeflow/moving-service'
import { randomBytes } from 'node:crypto'
import { request } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildMovingHttpServer } from '../src/http-app.js'
import { buildMovingApp } from '../../moving-api/src/app.js'

loadMovingEnvironment()
const live = process.env.RUN_AHAMOVE_STAGING_INTEGRATION === '1'
const token = randomBytes(32).toString('hex')
let baseUrl: string
let closeServer: (() => Promise<void>) | undefined
let api: ReturnType<typeof buildMovingApp> | undefined
let client: Client | undefined

describe.runIf(live)('Moving HTTP with real AhaMove and real database connections', () => {
  beforeAll(async () => {
    const config = getMovingRuntimeConfig()
    expect(config.environment).toBe('staging')
    expect(config.writeEnabled).toBe(false)
    const db = createMovingDatabasePool(config.databaseUrl)
    const movingService = new MovingService(AhaMoveClient.fromConfig(config), new MovingRepository(db), config)
    const app = buildMovingHttpServer({ db, movingService, environment: config.environment }, {
      token, allowedHosts: ['127.0.0.1'], allowedOrigins: [], release: 'live-verification',
    })
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
    const address = app.server.address()
    if (!address || typeof address === 'string') throw new Error('HTTP listener did not start.')
    baseUrl = `http://127.0.0.1:${address.port}`
    closeServer = app.close
    const apiDb = createMovingDatabasePool(config.databaseUrl)
    api = buildMovingApp(apiDb, new MovingService(AhaMoveClient.fromConfig(config), new MovingRepository(apiDb), config), config)
    await api.listen({ host: '127.0.0.1', port: 0 })
  })
  afterAll(async () => {
    await client?.close()
    await closeServer?.()
    await api?.close()
  })
  it('reports liveness for both HTTP processes', async () => {
    expect((await fetch(`${baseUrl}/health`)).status).toBe(200)
    const health = await api!.inject({ url: '/health' })
    expect(health.statusCode).toBe(200)
  })
  it('rejects missing and incorrect authentication, browser origins and unrelated hosts', async () => {
    expect((await fetch(`${baseUrl}/mcp`, { method: 'POST', body: '{}' })).status).toBe(401)
    expect((await fetch(`${baseUrl}/mcp`, { headers: { authorization: 'Bearer invalid' } })).status).toBe(401)
    expect((await fetch(`${baseUrl}/mcp`, { headers: { authorization: `Bearer ${token}`, origin: 'https://example.com' } })).status).toBe(403)
    const hostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(`${baseUrl}/mcp`, { headers: { host: 'untrusted.invalid' } }, (res) => {
        res.resume(); resolve(res.statusCode)
      })
      req.on('error', reject); req.end()
    })
    expect(hostStatus).toBe(403)
  })
  it('connects through the real HTTP MCP SDK and reads cities/services/detail from staging', async () => {
    client = new Client({ name: 'moving-http-live-check', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }))
    expect((await client.listTools()).tools).toHaveLength(13)
    const cities = await client.callTool({ name: 'list_service_areas', arguments: { country_id: 'VN' } })
    expect(cities.isError).not.toBe(true)
    const city = (cities.structuredContent as { cities: Array<{ city_id: string }> }).cities[0]!
    const services = await client.callTool({ name: 'list_moving_services', arguments: { city_id: city.city_id } })
    expect(services.isError).not.toBe(true)
    const first = (services.structuredContent as { services: Array<{ service_id: string }> }).services[0]!
    expect(first.service_id).toBeTruthy()
    const detail = await client.callTool({ name: 'get_moving_service', arguments: { service_id: first.service_id } })
    expect(detail.isError).not.toBe(true)
  }, 60_000)
  it('rejects unauthenticated webhook callbacks', async () => {
    const response = await api!.inject({ method: 'POST', url: '/v1/integrations/ahamove/webhooks/order-status', payload: {} })
    expect(response.statusCode).toBe(401)
  })
  it.runIf(process.env.MOVING_TEST_REQUIRE_READY === '1')('is ready after the actual migration and has persisted audit events', async () => {
    expect((await fetch(`${baseUrl}/ready`)).status).toBe(200)
    expect((await api!.inject({ url: '/ready' })).statusCode).toBe(200)
    const admin = createMovingDatabasePool(process.env.MOVING_DATABASE_ADMIN_URL!)
    try {
      const result = await admin.query("SELECT COUNT(*)::int AS count FROM audit.tool_calls WHERE result_status='success'")
      expect(result.rows[0].count).toBeGreaterThanOrEqual(3)
      const orders = await admin.query('SELECT COUNT(*)::int AS count FROM moving.orders')
      expect(orders.rows[0].count).toBe(0)
    } finally { await admin.end() }
  })
  it.runIf(process.env.MOVING_TEST_ISOLATED_DB === '1')('fails readiness without UPDATE permission while liveness remains healthy', async () => {
    const admin = createMovingDatabasePool(process.env.MOVING_DATABASE_ADMIN_URL!)
    try {
      await admin.query('REVOKE UPDATE ON moving.orders FROM moving_app')
      expect((await fetch(`${baseUrl}/ready`)).status).toBe(503)
      expect((await api!.inject({ url: '/ready' })).statusCode).toBe(503)
      expect((await fetch(`${baseUrl}/health`)).status).toBe(200)
      expect((await api!.inject({ url: '/health' })).statusCode).toBe(200)
    } finally {
      await admin.query('GRANT UPDATE ON moving.orders TO moving_app')
      await admin.end()
    }
    expect((await fetch(`${baseUrl}/ready`)).status).toBe(200)
  })
})
