import { EntityRouteRequestSchema, EntityRouteResponseSchema, RouteRequestSchema, RouteResultSchema } from '@relohome/contracts'
import { RouteEndpointService } from '@relohome/housing-query'
import type { McpServer } from '@modelcontextprotocol/server'
import { audited } from './audit.js'
import type { ReloHomeMcpDependencies } from './types.js'

export function registerRoutingTools(server: McpServer, dependencies: ReloHomeMcpDependencies) {
  const endpoints = new RouteEndpointService(dependencies.pool, dependencies.routeService)
  server.registerTool('calculate_route_between_entities', {
    title: 'Calculate route between entities',
    description: 'Calculate one OSRM route between explicit housing listing IDs, POI IDs or coordinates in hcm, hanoi or danang. Resolve names first; this tool never selects search candidates. Returns endpoint sources, location accuracy and warnings. Defaults to motorcycle and a 100 metre snapping radius; approximate locations can still return routes.',
    inputSchema: EntityRouteRequestSchema,
    outputSchema: EntityRouteResponseSchema,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  }, audited(dependencies.pool, 'calculate_route_between_entities', (input) => endpoints.calculate(input)))
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
