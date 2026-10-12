import {
  HousingDetailSchema,
  HousingSearchRequestSchema,
  HousingSearchResponseSchema,
} from '@relohome/contracts'
import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { audited } from './audit.js'
import type { ReloHomeMcpDependencies } from './types.js'

export function registerHousingTools(server: McpServer, dependencies: ReloHomeMcpDependencies) {
  server.registerTool(
    'search_housing',
    {
      title: 'Search housing',
      description:
        'Search factual housing listings such as rooms, houses, apartments, studios and homestays. Use administrative_area_ids from search_areas for a province, city, district or ward. For housing near a named landmark such as a university, first call resolve_location, then pass its coordinates to commute.destination; commute.profile defaults to motorcycle when omitted. Use nearby only for required POI categories around each listing. This tool applies hard filters and pagination only; it does not rank, recommend or choose the best listing.',
      inputSchema: HousingSearchRequestSchema,
      outputSchema: HousingSearchResponseSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    audited(dependencies.pool, 'search_housing', async (input) => dependencies.housingService.search(input)),
  )

  server.registerTool(
    'get_housing',
    {
      title: 'Get housing listing',
      description:
        'Get full factual details for exactly one housing result using the canonical listing_id returned by search_housing. Do not use this tool to search by name, address, area or coordinates.',
      inputSchema: z.object({ listing_id: z.uuid() }),
      outputSchema: HousingDetailSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    audited(dependencies.pool, 'get_housing', async ({ listing_id }) =>
      dependencies.housingService.get(listing_id),
    ),
  )
}
