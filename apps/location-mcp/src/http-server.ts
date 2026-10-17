import { authenticateMcpRequest, logger, requireServiceToken } from '@relohome/mcp-core'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import {
  hostHeaderValidation,
  originValidation,
  toNodeHandler,
} from '@modelcontextprotocol/node'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { createReloHomeMcpServer } from './create-server.js'
import { createReloHomeMcpRuntime } from './runtime.js'

const host = process.env.MCP_HOST || '127.0.0.1'
const port = parsePort(process.env.MCP_PORT || '3000')
const allowedHosts = commaSeparated(
  process.env.MCP_ALLOWED_HOSTS || 'localhost,127.0.0.1,[::1],lifeflow-location-mcp',
)
const allowedOriginHosts = commaSeparated(
  process.env.MCP_ALLOWED_ORIGIN_HOSTS || 'localhost,127.0.0.1,[::1]',
)
const authToken = requireServiceToken(process.env.MCP_AUTH_TOKEN || process.env.LOCATION_MCP_AUTH_TOKEN || '')

const validateHost = hostHeaderValidation(allowedHosts)
const validateOrigin = originValidation(allowedOriginHosts)
const { pool, dependencies } = createReloHomeMcpRuntime()
const mcpHandler = createMcpHandler(() => createReloHomeMcpServer(dependencies), {
  onerror(error) {
    logger.error({ err: error }, 'location_mcp_handler_error')
  },
})
const handleMcpRequest = toNodeHandler(mcpHandler, {
  onerror(error) {
    logger.error({ err: error }, 'location_mcp_transport_error')
  },
})

const httpServer = createServer((request, response) => {
  void routeRequest(request, response).catch((error) => {
    logger.error({ err: error }, 'location_mcp_request_failed')
    if (!response.headersSent) {
      sendJson(response, 500, { status: 'error', code: 'INTERNAL_ERROR' })
    } else {
      response.end()
    }
  })
})

async function routeRequest(request: IncomingMessage, response: ServerResponse) {
  const path = (request.url || '/').split('?', 1)[0]

  if (path === '/healthz') {
    sendJson(response, 200, { status: 'ok', service: 'lifeflow-location-mcp' })
    return
  }

  if (path === '/readyz') {
    try {
      await pool.query('SELECT 1')
      sendJson(response, 200, { status: 'ready', database: 'connected' })
    } catch {
      sendJson(response, 503, { status: 'not_ready', database: 'unavailable' })
    }
    return
  }

  if (path !== '/mcp') {
    sendJson(response, 404, { status: 'error', code: 'NOT_FOUND' })
    return
  }

  if (!validateHost(request, response) || !validateOrigin(request, response)) return

  if (authenticateMcpRequest(request, response, [authToken]) === undefined) return

  await handleMcpRequest(request, response)
}

function commaSeparated(value: string) {
  const items = value.split(',').map((item) => item.trim()).filter(Boolean)
  if (items.length === 0) throw new Error('MCP allow lists cannot be empty.')
  return items
}

function parsePort(value: string) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error('MCP_PORT must be an integer between 1 and 65535.')
  }
  return parsed
}

function sendJson(response: ServerResponse, statusCode: number, body: Record<string, string>) {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

httpServer.listen(port, host, () => {
  logger.info({ host, port }, 'location_mcp_listening')
})

let closing = false
async function shutdown(signal: string) {
  if (closing) return
  closing = true
  logger.info({ signal }, 'location_mcp_shutting_down')

  await mcpHandler.close()
  await new Promise<void>((resolve, reject) => {
    httpServer.close((error) => (error ? reject(error) : resolve()))
  })
  await pool.end()
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown(signal).catch((error) => {
      logger.error({ err: error }, 'location_mcp_shutdown_failed')
      process.exitCode = 1
    })
  })
}
