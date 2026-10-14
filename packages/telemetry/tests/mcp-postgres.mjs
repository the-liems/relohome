// Used only by scripts/validate-observability.py with its disposable PostgreSQL.
import { createServer } from 'node:http'
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server'
import { toNodeHandler } from '@modelcontextprotocol/node'
import { auditedTool, authenticateMcpRequest } from '@relohome/mcp-core'
import pg from 'pg'
import { z } from 'zod'

const pool = new pg.Pool({ connectionString: process.env.SMOKE_DATABASE_URL })
const handler = createMcpHandler(() => {
  const server = new McpServer({ name: 'smoke-node', version: '1.0.0' })
  server.registerTool('smoke_query', { inputSchema: z.object({ email: z.string() }) },
    auditedTool({ query: async () => undefined }, 'smoke_query', async input => {
      const result = await pool.query('SELECT $1::text AS email', [input.email])
      return result.rows[0]
    }, () => ({ code: 'SMOKE_FAILURE', message: 'Smoke query failed', retryable: false })))
  return server
})
const handle = toNodeHandler(handler)
const server = createServer((req, res) => {
  if (authenticateMcpRequest(req, res, [process.env.SMOKE_MCP_TOKEN]) === undefined) return
  void handle(req, res)
})
server.listen(0, '127.0.0.1', () => console.log(`http://127.0.0.1:${server.address().port}/mcp`))
process.once('SIGTERM', async () => {
  await handler.close()
  await new Promise(resolve => server.close(resolve))
  await pool.end()
})
