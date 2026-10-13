import {
  CoordinateSchema,
  NearbyPlaceConstraintSchema,
  NearbyPlaceMatchSchema,
  PlaceSchema,
  PlaceSearchRequestSchema,
} from '@relohome/contracts'
import { NotFoundError } from '@relohome/housing-query'
import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { audited } from './audit.js'
import type { ReloHomeMcpDependencies } from './types.js'

export function registerPlaceTools(server: McpServer, dependencies: ReloHomeMcpDependencies) {
  server.registerTool(
    'search_places',
    {
      title: 'Search places',
      description:
        'Search canonical POIs and named places such as hotels, hospitals, schools, shops or bus stops using text, category and spatial filters. For a province, city, district or ward such as Gò Vấp, first use search_areas and pass its administrative_area_id; do not treat an administrative area as a POI name. Use search_housing instead for rental or sale listings.',
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
      description:
        'Get full factual details for exactly one canonical POI using a place_id returned by search_places, resolve_location or find_nearby_places. Do not use this tool to search by free-form name or administrative area.',
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
      description:
        'From one already resolved coordinate, return the nearest factual POI matching each requested category and maximum straight-line distance. Resolve a landmark name with resolve_location before calling this tool. Use search_areas for administrative names such as Gò Vấp. This tool finds nearby amenities; it does not search housing or calculate road routes.',
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
