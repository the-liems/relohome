import {
  CoordinateSchema,
  NearbyPlaceConstraintSchema,
  NearbyPlaceMatchSchema,
  PlaceSchema,
  PlaceSearchRequestSchema,
} from '@lifeflow/contracts'
import { NotFoundError } from '@lifeflow/housing-query'
import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { audited } from './audit.js'
import type { LifeFlowMcpDependencies } from './types.js'

export function registerPlaceTools(server: McpServer, dependencies: LifeFlowMcpDependencies) {
  server.registerTool(
    'search_places',
    {
      title: 'Search places',
      description: 'Search canonical places using text, category and spatial constraints.',
      inputSchema: PlaceSearchRequestSchema,
      outputSchema: z.object({
        results: z.array(PlaceSchema),
        next_cursor: z.string().nullable(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    audited(dependencies.pool, 'search_places', async (input) => dependencies.placeService.search(input)),
  )

  server.registerTool(
    'get_place',
    {
      title: 'Get place',
      description: 'Get one canonical place by ID.',
      inputSchema: z.object({ place_id: z.uuid() }),
      outputSchema: PlaceSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    audited(dependencies.pool, 'get_place', async ({ place_id }) => {
      const place = await dependencies.placeService.get(place_id)
      if (!place) throw new NotFoundError(`Place not found: ${place_id}`)
      return place
    }),
  )

  server.registerTool(
    'find_nearby_places',
    {
      title: 'Find nearby places',
      description: 'Return the nearest factual place matching each category and distance constraint.',
      inputSchema: z.object({
        origin: CoordinateSchema,
        constraints: z.array(NearbyPlaceConstraintSchema).min(1).max(10),
      }),
      outputSchema: z.object({ results: z.array(NearbyPlaceMatchSchema) }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    audited(dependencies.pool, 'find_nearby_places', async ({ origin, constraints }) => ({
      results: await dependencies.placeService.findNearby(origin, constraints),
    })),
  )
}
