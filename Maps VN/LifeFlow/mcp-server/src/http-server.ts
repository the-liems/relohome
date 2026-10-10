import { authenticateMcpRequest, requireServiceToken } from '@lifeflow/mcp-core'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import {
  hostHeaderValidation,
  originValidation,
  toNodeHandler,
} from '@modelcontextprotocol/node'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { createLifeFlowMcpServer } from './create-server.js'
import { createLifeFlowMcpRuntime } from './runtime.js'

const host = process.env.MCP_HOST || '127.0.0.1'
const port = parsePort(process.env.MCP_PORT || '3000')
const allowedHosts = commaSeparated(
  process.env.MCP_ALLOWED_HOSTS || 'localhost,127.0.0.1,[::1],lifeflow-location-mcp',
)
const allowedOriginHosts = commaSeparated(
  process.env.MCP_ALLOWED_ORIGIN_HOSTS || 'localhost,127.0.0.1,[::1]',
)
const authToken = requireServiceToken(process.env.MCP_AUTH_TOKEN || '')

const validateHost = hostHeaderValidation(allowedHosts)
const validateOrigin = originValidation(allowedOriginHosts)
const { pool, dependencies } = createLifeFlowMcpRuntime()
const mcpHandler = createMcpHandler(() => createLifeFlowMcpServer(dependencies), {
  onerror(error) {
    console.error('LifeFlow MCP handler error:', error)
  },
})
const handleMcpRequest = toNodeHandler(mcpHandler, {
  onerror(error) {
    console.error('LifeFlow MCP HTTP transport error:', error)
  },
})

const httpServer = createServer((request, response) => {
  void routeRequest(request, response).catch((error) => {
    console.error('LifeFlow MCP HTTP request error:', error)
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
  console.log(`LifeFlow Location MCP listening on http://${host}:${port}/mcp`)
})

let closing = false
async function shutdown(signal: string) {
  if (closing) return
  closing = true
  console.log(`Received ${signal}; shutting down LifeFlow Location MCP.`)

  await mcpHandler.close()
  await new Promise<void>((resolve, reject) => {
    httpServer.close((error) => (error ? reject(error) : resolve()))
  })
  await pool.end()
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown(signal).catch((error) => {
      console.error('LifeFlow MCP shutdown error:', error)
      process.exitCode = 1
    })
  })
}
