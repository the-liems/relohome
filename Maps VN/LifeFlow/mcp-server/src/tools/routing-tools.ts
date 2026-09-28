import { RouteRequestSchema, RouteResultSchema } from '@lifeflow/contracts'
import type { McpServer } from '@modelcontextprotocol/server'
import { audited } from './audit.js'
import type { LifeFlowMcpDependencies } from './types.js'

export function registerRoutingTools(server: McpServer, dependencies: LifeFlowMcpDependencies) {
  server.registerTool(
    'calculate_route',
    {
      title: 'Calculate route',
      description:
        'Calculate one factual OSRM route, road distance and duration between two already resolved coordinates. Use resolve_location first when the user provides names. Supported profiles are driving, motorcycle and walking; omit profile to use motorcycle by default. This tool routes one origin-destination pair and does not search nearby POIs or housing.',
      inputSchema: RouteRequestSchema,
      outputSchema: RouteResultSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    audited(dependencies.pool, 'calculate_route', async (input) => dependencies.routeService.calculate(input)),
  )
}
