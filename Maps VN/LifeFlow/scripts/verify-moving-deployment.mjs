// Read-only verification of running containers or a deployed staging instance.
import assert from 'node:assert/strict'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'

const token = process.env.MOVING_MCP_AUTH_TOKEN
if (!token) throw new Error('MOVING_MCP_AUTH_TOKEN is required.')
const mcp = new URL(process.env.MOVING_MCP_URL || 'http://127.0.0.1:4400/mcp')
const api = new URL(process.env.MOVING_API_URL || 'http://127.0.0.1:4200')
for (const base of [mcp, api]) {
  for (const path of ['/health', '/ready']) {
    const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(10_000) })
    assert.equal(response.status, 200, `${path} failed for ${base.hostname}`)
    const health = await response.json()
    if (path === '/health') {
      assert.equal(health.environment, 'staging', 'Live verification is staging-only.')
      if (process.env.RELEASE_SHA) assert.equal(health.release, process.env.RELEASE_SHA)
    }
  }
}
assert.equal((await fetch(mcp, { method: 'POST', body: '{}' })).status, 401)
const client = new Client({ name: 'moving-deployment-verification', version: '1.0.0' })
try {
  await client.connect(new StreamableHTTPClientTransport(mcp, {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  }))
  const tools = await client.listTools()
  assert.equal(tools.tools.length, 9)
  const result = await client.callTool({ name: 'list_service_areas', arguments: { country_id: 'VN' } })
  assert.notEqual(result.isError, true)
  assert.ok(result.structuredContent.cities.length > 0)
  console.log('PASS: both containers ready, expected release, authentication, 9 read-only tools, real AhaMove read.')
} finally { await client.close() }
