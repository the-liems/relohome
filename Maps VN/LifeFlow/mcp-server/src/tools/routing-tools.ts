import { RouteRequestSchema, RouteResultSchema } from '@lifeflow/contracts'
import type { McpServer } from '@modelcontextprotocol/server'
import { audited } from './audit.js'
import type { LifeFlowMcpDependencies } from './types.js'

export function registerRoutingTools(server: McpServer, dependencies: LifeFlowMcpDependencies) {
  server.registerTool(
    'calculate_route',
    {
      title: 'Calculate route',
      description: 'Calculate a factual OSRM driving, motorcycle or walking route, distance and duration.',
      inputSchema: RouteRequestSchema,
      outputSchema: RouteResultSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    audited(dependencies.pool, 'calculate_route', async (input) => dependencies.routeService.calculate(input)),
  )
}
