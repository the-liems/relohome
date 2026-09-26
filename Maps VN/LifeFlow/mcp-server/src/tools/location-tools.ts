import {
  ResolveLocationRequestSchema,
  ResolveLocationResponseSchema,
  SearchAreasRequestSchema,
  SearchAreasResponseSchema,
} from '@lifeflow/contracts'
import type { McpServer } from '@modelcontextprotocol/server'
import { audited } from './audit.js'
import type { LifeFlowMcpDependencies } from './types.js'

export function registerLocationTools(server: McpServer, dependencies: LifeFlowMcpDependencies) {
  server.registerTool(
    'search_areas',
    {
      title: 'Search administrative areas',
      description:
        'Search locally owned administrative boundaries by accent-insensitive name and return canonical area IDs, parents, centers and bounding boxes.',
      inputSchema: SearchAreasRequestSchema,
      outputSchema: SearchAreasResponseSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    audited(dependencies.pool, 'search_areas', async (input) =>
      dependencies.locationService.searchAreas(input),
    ),
  )

  server.registerTool(
    'resolve_location',
    {
      title: 'Resolve location',
      description:
        'Resolve a location name against local canonical places and administrative areas, returning multiple factual candidates when the name is ambiguous.',
      inputSchema: ResolveLocationRequestSchema,
      outputSchema: ResolveLocationResponseSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    audited(dependencies.pool, 'resolve_location', async (input) =>
      dependencies.locationService.resolve(input),
    ),
  )
}
