import {
  ResolveLocationRequestSchema,
  ResolveLocationResponseSchema,
  SearchAreasRequestSchema,
  SearchAreasResponseSchema,
} from '@relohome/contracts'
import type { McpServer } from '@modelcontextprotocol/server'
import { audited } from './audit.js'
import type { ReloHomeMcpDependencies } from './types.js'

export function registerLocationTools(server: McpServer, dependencies: ReloHomeMcpDependencies) {
  server.registerTool(
    'search_areas',
    {
      title: 'Search administrative areas',
      description:
        'Use only for administrative boundaries: province, municipality, district, county, city, commune or ward. Examples include Hà Nội, Gò Vấp and Phường Bến Thành. Search is accent-insensitive and returns canonical area IDs, parents, centers and bounding boxes for downstream filtering. Pass within_area_id from an already resolved city to restrict candidates to its actual boundary before ranking and limit; bounding_box alone is only a rectangular filter. Do not use for landmarks, universities, buildings, hotels, POIs or housing listings.',
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
        'Resolve a free-form named landmark or place such as a university, lake, airport, building or station into canonical coordinates. It can also recover ambiguous input when the entity type is unknown. If the input is clearly a province, city, district or ward such as Gò Vấp, prefer search_areas. Results may be ambiguous: use category, parent area or bounding_box to disambiguate instead of silently selecting the first candidate.',
      inputSchema: ResolveLocationRequestSchema,
      outputSchema: ResolveLocationResponseSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    audited(dependencies.pool, 'resolve_location', async (input) =>
      dependencies.locationService.resolve(input),
    ),
  )
}
