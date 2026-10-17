import { authenticateMcpRequest, logger, requireServiceToken, sendAuthError } from '@relohome/mcp-core'
import { createServer, type ServerResponse } from 'node:http'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { hostHeaderValidation, toNodeHandler } from '@modelcontextprotocol/node'
import { checkMovingReadiness, type MovingDatabasePool } from '@relohome/moving-service'
import { createMovingMcpServer } from './create-server.js'

export interface MovingHttpOptions {
  token: string
  writeToken?: string
  allowedHosts: string[]
  allowedOrigins: string[]
  release: string
}

export function getMovingHttpOptions(): MovingHttpOptions {
  const token = requireServiceToken(process.env.MCP_AUTH_TOKEN || process.env.MOVING_MCP_AUTH_TOKEN || '')
  const writeToken = process.env.MCP_WRITE_TOKEN || process.env.MOVING_MCP_WRITE_TOKEN || undefined
  validateTokens(token, writeToken)
  const list = (value: string) => value.split(',').map((entry) => entry.trim()).filter(Boolean)
  const allowedHosts = list(process.env.MOVING_MCP_ALLOWED_HOSTS || 'localhost,127.0.0.1,moving-mcp')
  const allowedOrigins = list(process.env.MOVING_MCP_ALLOWED_ORIGINS || '')
  if (allowedHosts.includes('*') || allowedOrigins.includes('*')) throw new Error('Wildcard MCP origins/hosts are not allowed.')
  for (const origin of allowedOrigins) {
    if (new URL(origin).origin !== origin) throw new Error('MCP origins must be exact URL origins, without a path.')
  }
  return { token, writeToken, allowedHosts, allowedOrigins, release: process.env.RELEASE_SHA || 'development' }
}

function validateTokens(read: string, write?: string) {
  requireServiceToken(read)
  if (write) {
    requireServiceToken(write, 'MCP_WRITE_TOKEN')
    if (write === read) throw new Error('Moving read and write tokens must be distinct.')
  }
}

export function buildMovingHttpServer(
  dependencies: Parameters<typeof createMovingMcpServer>[0] & { db: MovingDatabasePool },
  options: MovingHttpOptions,
) {
  validateTokens(options.token, options.writeToken)
  const handlerOptions = {
    legacy: 'stateless' as const,
    maxRequestBodySize: 1_000_000,
    onerror: (error: Error) => logger.error({ err: error }, 'moving_mcp_protocol_error'),
  }
  const handler = createMcpHandler(() => createMovingMcpServer({ ...dependencies, access: 'read' }), handlerOptions)
  const writeHandler = options.writeToken
    ? createMcpHandler(() => createMovingMcpServer({ ...dependencies, access: 'write' }), handlerOptions)
    : undefined
  const handleMcp = toNodeHandler(handler, { maxRequestBodySize: 1_000_000 })
  const handleWriteMcp = writeHandler ? toNodeHandler(writeHandler, { maxRequestBodySize: 1_000_000 }) : undefined
  const validateHost = hostHeaderValidation(options.allowedHosts)
  let stopping = false
  const json = (res: ServerResponse, status: number, body: object) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
  }
  const server = createServer(async (req, res) => {
    const started = performance.now()
    let path = ''
    res.once('finish', () => {
      // Health probes run every few seconds; their failures surface as container health.
      if (path === '/health' || path === '/ready') return
      logger.info({ method: req.method, path, status: res.statusCode,
        duration_ms: Math.round(performance.now() - started), release: options.release }, 'moving_mcp_http')
    })
    try {
      if (!validateHost(req, res)) return
      const origin = req.headers.origin
      if (origin && !options.allowedOrigins.includes(origin)) {
        sendAuthError(res, 403, 'ORIGIN_NOT_ALLOWED'); return
      }
      path = new URL(req.url || '/', 'http://localhost').pathname
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
      const credential = authenticateMcpRequest(req, res,
        options.writeToken ? [options.token, options.writeToken] : [options.token])
      if (credential === undefined) return
      const canWrite = credential === 1
      if (canWrite && handleWriteMcp) await handleWriteMcp(req, res)
      else await handleMcp(req, res)
    } catch (error) {
      logger.error({ err: error, path }, 'moving_mcp_request_failed')
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
    try { await drained; await handler.close(); await writeHandler?.close(); await dependencies.db.end() }
    finally { clearTimeout(deadline) }
  })() }
}
