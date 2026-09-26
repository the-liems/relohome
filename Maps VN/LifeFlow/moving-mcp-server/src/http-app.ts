import { timingSafeEqual } from 'node:crypto'
import { createServer, type ServerResponse } from 'node:http'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { hostHeaderValidation, toNodeHandler } from '@modelcontextprotocol/node'
import { checkMovingReadiness, type MovingDatabasePool } from '@lifeflow/moving-service'
import { createMovingMcpServer } from './create-server.js'

export interface MovingHttpOptions {
  token: string
  allowedHosts: string[]
  allowedOrigins: string[]
  release: string
}

export function getMovingHttpOptions(): MovingHttpOptions {
  const token = process.env.MOVING_MCP_AUTH_TOKEN?.trim() || ''
  if (token.length < 32) throw new Error('MOVING_MCP_AUTH_TOKEN must contain at least 32 characters.')
  const list = (value: string) => value.split(',').map((entry) => entry.trim()).filter(Boolean)
  const allowedHosts = list(process.env.MOVING_MCP_ALLOWED_HOSTS || 'localhost,127.0.0.1,moving-mcp')
  const allowedOrigins = list(process.env.MOVING_MCP_ALLOWED_ORIGINS || '')
  if (allowedHosts.includes('*') || allowedOrigins.includes('*')) throw new Error('Wildcard MCP origins/hosts are not allowed.')
  for (const origin of allowedOrigins) {
    if (new URL(origin).origin !== origin) throw new Error('MCP origins must be exact URL origins, without a path.')
  }
  return { token, allowedHosts, allowedOrigins, release: process.env.RELEASE_SHA || 'development' }
}

export function buildMovingHttpServer(
  dependencies: Parameters<typeof createMovingMcpServer>[0] & { db: MovingDatabasePool },
  options: MovingHttpOptions,
) {
  const handler = createMcpHandler(() => createMovingMcpServer(dependencies), {
    legacy: 'stateless',
    maxRequestBodySize: 1_000_000,
    onerror: () => console.error(JSON.stringify({ event: 'moving_mcp_protocol_error' })),
  })
  const handleMcp = toNodeHandler(handler, { maxRequestBodySize: 1_000_000 })
  const validateHost = hostHeaderValidation(options.allowedHosts)
  const expected = Buffer.from(`Bearer ${options.token}`)
  let stopping = false
  const json = (res: ServerResponse, status: number, body: object) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
  }
  const server = createServer(async (req, res) => {
    const started = performance.now()
    res.once('finish', () => console.error(JSON.stringify({ event: 'moving_mcp_http',
      method: req.method, status: res.statusCode, duration_ms: Math.round(performance.now() - started),
      release: options.release })))
    try {
      if (!validateHost(req, res)) return
      const origin = req.headers.origin
      if (origin && !options.allowedOrigins.includes(origin)) {
        json(res, 403, { code: 'ORIGIN_NOT_ALLOWED' }); return
      }
      const path = new URL(req.url || '/', 'http://localhost').pathname
      if (req.method === 'GET' && (path === '/health' || path === '/ready')) {
        if (stopping) { json(res, 503, { status: 'stopping' }); return }
        if (path === '/ready') {
          try { await checkMovingReadiness(dependencies.db) }
          catch { json(res, 503, { status: 'not_ready', dependency: 'database' }); return }
        }
        json(res, 200, { status: 'ok', service: 'lifeflow-moving-mcp',
          environment: dependencies.environment, release: options.release }); return
      }
      if (path !== '/mcp') { json(res, 404, { code: 'NOT_FOUND' }); return }
      if (stopping) { json(res, 503, { code: 'STOPPING' }); return }
      const provided = Buffer.from(req.headers.authorization || '')
      if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
        res.setHeader('www-authenticate', 'Bearer realm="lifeflow-moving"')
        json(res, 401, { code: 'NOT_AUTHORIZED' }); return
      }
      await handleMcp(req, res)
    } catch {
      if (!res.headersSent) json(res, 500, { code: 'INTERNAL_ERROR' })
      else res.destroy()
    }
  })
  server.requestTimeout = 30_000
  server.headersTimeout = 10_000
  server.keepAliveTimeout = 5_000
  let closing: Promise<void> | undefined
  return { server, close: () => closing ??= (async () => {
    stopping = true
    const drained = new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()))
    const deadline = setTimeout(() => server.closeAllConnections(), 25_000).unref()
    try { await drained; await handler.close(); await dependencies.db.end() }
    finally { clearTimeout(deadline) }
  })() }
}
