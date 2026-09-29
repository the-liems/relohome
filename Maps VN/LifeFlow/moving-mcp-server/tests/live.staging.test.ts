import { Client } from '@modelcontextprotocol/client'
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const live = process.env.RUN_AHAMOVE_STAGING_INTEGRATION === '1'
const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const rootDirectory = resolve(packageDirectory, '..')
let client: Client | undefined

describe.runIf(live)('Moving MCP against AhaMove staging without mocks', () => {
  beforeAll(async () => {
    client = new Client({ name: 'lifeflow-moving-live-test', version: '0.1.0' })
    await client.connect(new StdioClientTransport({
      command: process.execPath,
      args: [resolve(packageDirectory, 'dist/server.js')],
      cwd: rootDirectory,
      env: {
        ...getDefaultEnvironment(),
        LIFEFLOW_ENV_FILE: process.env.LIFEFLOW_ENV_FILE || resolve(rootDirectory, '.env'),
      },
      stderr: 'inherit',
    }))
  })

  afterAll(async () => {
    await client?.close()
  })

  it('publishes the independent Moving tool catalog with safe annotations', async () => {
    const result = await client!.listTools()
    const names = result.tools.map((tool) => tool.name).sort()
    expect(names).toEqual([
      'estimate_move',
      'find_move_orders_by_tracking_number',
      'get_move_order',
      'get_move_order_events',
      'get_move_orders',
      'get_move_tracking_link',
      'get_moving_service',
      'list_moving_services',
      'list_service_areas',
    ])
    expect(result.tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true)
  })

  it('reads real service areas through MCP', async () => {
    const result = await client!.callTool({ name: 'list_service_areas', arguments: { country_id: 'VN' } })
    expect(result.isError).not.toBe(true)
    const output = result.structuredContent as { cities: unknown[] }
    expect(output.cities.length).toBeGreaterThan(0)
  })
})
