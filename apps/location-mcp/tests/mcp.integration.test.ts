import { Client } from '@modelcontextprotocol/client'
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from '@modelcontextprotocol/client/stdio'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const rootDirectory = resolve(packageDirectory, '../..')

let client: Client

beforeAll(async () => {
  client = new Client({ name: 'lifeflow-mcp-integration-test', version: '0.1.0' })
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve(packageDirectory, 'dist/server.js')],
    cwd: rootDirectory,
    env: {
      ...getDefaultEnvironment(),
      ...Object.fromEntries(Object.entries(process.env).filter(([name, value]) =>
        value !== undefined && /^(LOCATION_|POSTGRES_|OSRM_|MCP_|COMMUTE_)/.test(name))) as Record<string, string>,
    },
    stderr: 'inherit',
  })
  await client.connect(transport)
})

afterAll(async () => {
  await client.close()
})

describe('ReloHome MCP stdio server', () => {
  it('publishes the nine factual read tools', async () => {
    const { tools } = await client.listTools()
    const names = tools.map((tool) => tool.name).sort()

    expect(names).toEqual([
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
    expect(names).not.toContain('recommend_housing')
    expect(tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true)

    const descriptions = Object.fromEntries(tools.map((tool) => [tool.name, tool.description || '']))
    expect(Object.values(descriptions).every((description) => description.length >= 100)).toBe(true)
    expect(descriptions.search_areas).toContain('Gò Vấp')
    expect(descriptions.resolve_location).toContain('prefer search_areas')
    expect(descriptions.search_places).toContain('do not treat an administrative area as a POI')
    expect(descriptions.search_housing).toContain('commute.profile defaults to motorcycle')
    expect(descriptions.calculate_route).toContain('motorcycle by default')
  })

  it('searches administrative areas through MCP stdio without accents', async () => {
    const result = await client.callTool({
      name: 'search_areas',
      arguments: { text: 'go vap', levels: ['6'], limit: 10 },
    })

    expect(result.isError).not.toBe(true)
    const output = result.structuredContent as {
      results: Array<{ area_id: string; name: string }>
    }
    expect(output.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          area_id: 'osm:relation:38522189',
          name: 'Phường Gò Vấp',
        }),
      ]),
    )
  })

  it('resolves location candidates through MCP stdio', async () => {
    const result = await client.callTool({
      name: 'resolve_location',
      arguments: { text: 'go vap', limit: 10 },
    })

    expect(result.isError).not.toBe(true)
    const output = result.structuredContent as {
      ambiguous: boolean
      results: Array<{ entity_type: string; canonical_id: string }>
    }
    expect(output.results.length).toBeGreaterThan(0)
    expect(output.results.some((item) => item.entity_type === 'administrative_area')).toBe(true)
  })

  it('returns imported HCM places as validated structured content', async () => {
    const result = await client.callTool({
      name: 'search_places',
      arguments: {
        bounding_box: {
          west: 106.34,
          south: 10.34,
          east: 107.05,
          north: 11.2,
        },
        pagination: { limit: 5, cursor: null },
      },
    })

    expect(result.isError).not.toBe(true)
    const output = result.structuredContent as {
      results: Array<{ place_id: string; source: { source_id: string } }>
    }
    expect(output.results.length).toBeGreaterThan(0)
    expect(output.results[0]?.place_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(output.results[0]?.source.source_id).toBeTruthy()
  })

  it('returns imported factual housing without recommendation fields', async () => {
    const result = await client.callTool({
      name: 'search_housing',
      arguments: {
        pagination: { limit: 10, cursor: null },
        sort: [{ field: 'price_amount', direction: 'asc' }],
      },
    })

    expect(result.isError).not.toBe(true)
    const output = result.structuredContent as {
      results: Array<{ listing_id: string; source: { type: string } }>
      page: { returned_count: number }
    }
    expect(output.page.returned_count).toBe(output.results.length)
    if (output.results[0]) expect(output.results[0].source.type).toBe('partner')
    expect(JSON.stringify(output)).not.toMatch(/recommend|score|best_choice/i)
  })
})
