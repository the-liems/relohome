import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const rootDirectory = resolve(packageDirectory, '../..')
const authToken = 'lifeflow-mcp-integration-token-0123456789'

let child: ChildProcess
let endpoint: URL

beforeAll(async () => {
  const port = await getFreePort()
  endpoint = new URL(`http://127.0.0.1:${port}/mcp`)
  child = spawn(process.execPath, [resolve(packageDirectory, 'dist/http-server.js')], {
    cwd: rootDirectory,
    env: {
      ...process.env,
      LOCATION_DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused',
      POSTGRES_APP_USER: 'unused',
      POSTGRES_APP_PASSWORD: 'unused',
      POSTGRES_HOST: '127.0.0.1',
      POSTGRES_PORT: '1',
      POSTGRES_DB: 'unused',
      MCP_HOST: '127.0.0.1',
      MCP_PORT: String(port),
      MCP_ALLOWED_HOSTS: '127.0.0.1,localhost',
      MCP_ALLOWED_ORIGIN_HOSTS: '127.0.0.1,localhost',
      MCP_AUTH_TOKEN: '',
      LOCATION_MCP_AUTH_TOKEN: authToken,
    },
    stdio: 'inherit',
  })

  await waitForHealth(new URL('/healthz', endpoint))
}, 30_000)

afterAll(async () => {
  if (!child || child.exitCode !== null) return
  child.kill()
  await new Promise<void>((resolveExit) => child.once('exit', () => resolveExit()))
})

describe('ReloHome MCP Streamable HTTP server', () => {
  it('rejects MCP requests without the configured bearer token', async () => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })

    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toBe('Bearer')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ status: 'error', code: 'UNAUTHORIZED' })
  })

  it('publishes all nine tools to an authenticated remote client', async () => {
    const client = new Client({ name: 'lifeflow-http-integration-test', version: '0.1.0' })
    const transport = new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers: { Authorization: `Bearer ${authToken}` } },
    })

    try {
      await client.connect(transport)
      const { tools } = await client.listTools()
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        'calculate_route',
        'calculate_route_between_entities',
        'find_nearby_places',
        'get_housing',
        'get_place',
        'resolve_location',
        'search_areas',
        'search_housing',
        'search_places',
      ])
    } finally {
      await client.close()
    }
  })
})

async function getFreePort() {
  const server = createServer()
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Failed to allocate an HTTP test port.')
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()))
  })
  return address.port
}

async function waitForHealth(url: URL) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // The child process can need a moment to bind its socket.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error(`Timed out waiting for ${url.toString()}`)
}
