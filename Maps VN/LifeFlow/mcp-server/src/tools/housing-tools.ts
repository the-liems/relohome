import {
  HousingDetailSchema,
  HousingSearchRequestSchema,
  HousingSearchResponseSchema,
} from '@lifeflow/contracts'
import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { audited } from './audit.js'
import type { LifeFlowMcpDependencies } from './types.js'

export function registerHousingTools(server: McpServer, dependencies: LifeFlowMcpDependencies) {
  server.registerTool(
    'search_housing',
    {
      title: 'Search housing',
      description:
        'Return factual housing listings that satisfy explicit hard constraints. This tool does not rank or recommend listings.',
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
      description: 'Get factual details for one canonical housing listing ID.',
      inputSchema: z.object({ listing_id: z.uuid() }),
      outputSchema: HousingDetailSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    audited(dependencies.pool, 'get_housing', async ({ listing_id }) =>
      dependencies.housingService.get(listing_id),
    ),
  )
}
